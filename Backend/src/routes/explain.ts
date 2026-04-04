import { Hono } from "hono";
import { z } from "zod";
import { getDB, findPattern } from "../lib/mongo";
import { getUserToken, getCurrentUser } from "../middleware/auth";
import {
  GEMINI_CLIENT_FRIENDLY_MESSAGE,
  explainComment,
  isLikelyGeminiRelatedError,
  matchAntiPattern,
} from "../lib/gemini";
import {
  githubRepoApiRoot,
  getRepoFileContent,
  githubRestJson,
} from "../lib/githubRest";

export const explainRouter = new Hono();

const explainRequestSchema = z.object({
  comment: z.string().describe("The review comment to explain"),
  diff_hunk: z
    .string()
    .describe("The diff context around the comment"),
  file_path: z.string().describe("Path to the file being reviewed"),
  line: z.number().describe("Line number"),
  repo: z.string().describe("Repository in format owner/name"),
  pr_number: z.number().describe("Pull request number"),
});

const DEMO_MODE = process.env.DEMO_MODE === "true";
/** Wall-clock cap for Gemini explain call; 5s was too tight and caused 504 + truncated JSON. */
const GEMINI_MS = (() => {
  const raw = process.env.GEMINI_EXPLAIN_TIMEOUT_MS?.trim();
  const n = raw ? parseInt(raw, 10) : 25_000;
  if (!Number.isFinite(n)) return 25_000;
  return Math.min(Math.max(n, 5000), 120_000);
})();

/** Words, 2-word combos, and common phrases like n+1 */
export function extractCommentKeywords(comment: string): string[] {
  const lower = comment.toLowerCase().trim();
  const out = new Set<string>();
  if (lower.includes("n+1")) {
    out.add("n+1");
    out.add("n plus one");
  }
  const tokens = lower.split(/[^a-z0-9+]+/).filter(Boolean);
  for (const t of tokens) out.add(t);
  for (let i = 0; i < tokens.length - 1; i++) {
    out.add(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return [...out];
}

function sliceAroundLine(text: string, line: number, pad: number): string {
  const lines = text.split("\n");
  const idx = Math.max(0, line - 1);
  const start = Math.max(0, idx - pad);
  const end = Math.min(lines.length, idx + pad + 1);
  return lines.slice(start, end).join("\n");
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("GEMINI_TIMEOUT")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

function languageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop() || "";
  const languageMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    java: "java",
    go: "go",
    rb: "ruby",
    rs: "rust",
    cs: "csharp",
  };
  return languageMap[ext] || ext || "unknown";
}

/**
 * POST /api/explain
 * Explain a review comment in the context of the code
 */
explainRouter.post("/explain", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    const body = await c.req.json();
    const request = explainRequestSchema.parse(body);
    const repoNorm = request.repo.trim().replace(/^\/+|\/+$/g, "").toLowerCase();

    const parts = repoNorm.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return c.json({ error: "Validation error", details: "repo must be owner/name" }, 400);
    }
    const [owner, repoName] = parts;

    const cacheKey = `pr:${request.pr_number}:comment:${request.comment}:file:${request.file_path}:line:${request.line}`;

    const db = getDB();
    const cached = await db
      .collection("explanations_cache")
      .findOne({ _id: cacheKey } as any);

    if (cached?.response) {
      return c.json(cached.response);
    }
    if (cached?.explanation) {
      const merged = {
        ...cached.explanation,
        source: {
          comment_by: user.username,
          comment_url: `https://github.com/${repoNorm}/pull/${request.pr_number}`,
          pattern_matched: cached.pattern_matched ?? null,
        },
        docs_links: Array.isArray(cached.docs_links) ? cached.docs_links : [],
      };
      return c.json(merged);
    }

    if (DEMO_MODE) {
      return c.json(
        {
          error: "insufficient_context",
          message: "Demo mode: no cached explanation for this request",
        },
        400
      );
    }

    const dh = (request.diff_hunk || "").trim();
    if (!dh) {
      return c.json(
        {
          error: "insufficient_context",
          message: "Not enough context to explain this comment",
        },
        400
      );
    }

    const token = getUserToken(c);
    if (!token) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    let surroundingContext = "";
    try {
      const root = githubRepoApiRoot(owner, repoName);
      const meta = await githubRestJson<{ default_branch: string }>(token, root);
      const ref = meta.default_branch;
      const file = await getRepoFileContent(
        token,
        owner,
        repoName,
        request.file_path,
        ref
      );
      if (file.text && !file.isBinary) {
        surroundingContext = sliceAroundLine(file.text, request.line, 30);
      }
    } catch (e) {
      console.warn("[explain] file context fetch failed:", e);
    }

    const keywords = extractCommentKeywords(request.comment);
    const mongoPattern = await findPattern(keywords);

    let patternMatch = matchAntiPattern(request.diff_hunk, "");
    const language = languageFromPath(request.file_path);
    if (!patternMatch) {
      const codeLines = request.diff_hunk
        .split("\n")
        .filter((line) => line.startsWith("+") || line.startsWith("-"))
        .map((line) => line.substring(1))
        .join("\n");
      if (codeLines) {
        patternMatch = matchAntiPattern(codeLines, language);
      }
    }

    const patternTemplate = mongoPattern
      ? `Pattern: ${(mongoPattern as { pattern_name?: string }).pattern_name ?? ""}\nKeywords matched from MongoDB.\nDocs: ${JSON.stringify((mongoPattern as { docs_links?: string[] }).docs_links ?? [])}`
      : patternMatch
        ? `Detected pattern: ${patternMatch.pattern} (${Math.round(patternMatch.confidence * 100)}% confidence)`
        : null;

    let explanation;
    try {
      explanation = await withTimeout(
        explainComment({
          comment: request.comment,
          diffHunk: request.diff_hunk,
          filePath: request.file_path,
          language,
          surroundingContext,
          patternTemplate,
        }),
        GEMINI_MS
      );
    } catch (err) {
      if (err instanceof Error && err.message === "GEMINI_TIMEOUT") {
        const again = await db
          .collection("explanations_cache")
          .findOne({ _id: cacheKey } as any);
        if (again?.response) {
          return c.json(again.response);
        }
        if (again?.explanation) {
          return c.json({
            ...again.explanation,
            source: {
              comment_by: user.username,
              comment_url: `https://github.com/${repoNorm}/pull/${request.pr_number}`,
              pattern_matched: again.pattern_matched ?? null,
            },
            docs_links: Array.isArray(again.docs_links) ? again.docs_links : [],
          });
        }
        return c.json(
          { error: "timeout", message: "Taking longer than usual" },
          504
        );
      }
      throw err;
    }

    const patternNameFromMongo = mongoPattern
      ? String((mongoPattern as { pattern_name?: string }).pattern_name ?? "")
      : null;
    const docsFromPattern = Array.isArray(
      (mongoPattern as { docs_links?: string[] })?.docs_links
    )
      ? (mongoPattern as { docs_links: string[] }).docs_links
      : [];

    const docsLinks = [
      ...(explanation.docs_links ?? []),
      ...docsFromPattern,
    ].filter((u, i, a) => u && a.indexOf(u) === i);

    const responseWithSource = {
      ...explanation,
      docs_links: docsLinks,
      source: {
        comment_by: user.username,
        comment_url: `https://github.com/${repoNorm}/pull/${request.pr_number}`,
        pattern_matched: patternNameFromMongo || patternMatch?.pattern || null,
      },
    };

    await db.collection("explanations_cache").updateOne(
      { _id: cacheKey } as any,
      {
        $set: {
          repo: repoNorm,
          file_path: request.file_path,
          line: request.line,
          pr_number: request.pr_number,
          response: responseWithSource,
          explanation,
          pattern_matched: patternNameFromMongo || patternMatch?.pattern || null,
          docs_links: docsLinks,
          created_at: new Date(),
          ttl: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      },
      { upsert: true }
    );

    return c.json(responseWithSource);
  } catch (error) {
    console.error("Explain error:", error);

    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: "Validation error",
          details: error.errors,
        },
        400
      );
    }

    if (
      error instanceof Error &&
      error.message.includes("insufficient context")
    ) {
      return c.json(
        {
          error: "insufficient_context",
          message: "Not enough context to explain this comment",
        },
        400
      );
    }

    const raw =
      error instanceof Error ? error.message : String(error);
    const message = isLikelyGeminiRelatedError(raw)
      ? GEMINI_CLIENT_FRIENDLY_MESSAGE
      : process.env.NODE_ENV === "development"
        ? raw.slice(0, 400)
        : "Something went wrong. Please try again.";

    return c.json(
      {
        error: "Failed to generate explanation",
        message,
      },
      500
    );
  }
});
