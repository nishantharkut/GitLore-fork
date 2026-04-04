import { Hono } from "hono";
import { z } from "zod";
import { getDB } from "../lib/mongo";
import { getUserToken, getCurrentUser } from "../middleware/auth";
import { explainComment, matchAntiPattern } from "../lib/gemini";

export const explainRouter = new Hono();

// Schema for explain request
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

type ExplainRequest = z.infer<typeof explainRequestSchema>;

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

    // Parse and validate request
    const body = await c.req.json();
    const request = explainRequestSchema.parse(body);
    const repoNorm = request.repo.trim().replace(/^\/+|\/+$/g, "").toLowerCase();

    const cacheKey = `pr:${request.pr_number}:comment:${request.comment}:file:${request.file_path}:line:${request.line}`;

    // Check cache
    const db = getDB();
    const cached = await db
      .collection("explanations_cache")
      .findOne({ _id: cacheKey } as any);

    if (cached) {
      return c.json(cached.explanation);
    }

    // Try to match against known patterns
    let patternMatch = matchAntiPattern(request.diff_hunk, "");

    // Try to extract language from file extension
    const ext = request.file_path.split(".").pop() || "";
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
    const language = languageMap[ext] || ext;

    // If no pattern matched, try with language context
    if (!patternMatch) {
      // Extract just the code from diff
      const codeLines = request.diff_hunk
        .split("\n")
        .filter((line) => line.startsWith("+") || line.startsWith("-"))
        .map((line) => line.substring(1))
        .join("\n");

      if (codeLines) {
        patternMatch = matchAntiPattern(codeLines, language);
      }
    }

    // Generate explanation using Gemini
    const explanation = await explainComment(
      request.comment,
      request.diff_hunk,
      request.file_path,
      patternMatch
        ? `Detected pattern: ${patternMatch.pattern} (${Math.round(patternMatch.confidence * 100)}% confidence)`
        : ""
    );

    // Cache the result
    await db.collection("explanations_cache").updateOne(
      { _id: cacheKey } as any,
      {
        $set: {
          repo: repoNorm,
          explanation,
          pattern_matched: patternMatch?.pattern ?? null,
          created_at: new Date(),
          ttl: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        },
      },
      { upsert: true }
    );

    // Add source information to response
    const responseWithSource = {
      ...explanation,
      source: {
        comment_by: user.username,
        comment_url: `https://github.com/${repoNorm}/pull/${request.pr_number}`,
        pattern_matched: patternMatch?.pattern || null,
      },
      docs_links: [],
    };

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
          message: "Not enough diff context to explain this comment",
        },
        400
      );
    }

    return c.json(
      {
        error: "Failed to generate explanation",
        message:
          process.env.NODE_ENV === "development"
            ? error instanceof Error
              ? error.message
              : "Unknown error"
            : undefined,
      },
      500
    );
  }
});
