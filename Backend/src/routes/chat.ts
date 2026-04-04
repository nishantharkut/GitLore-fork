import { Hono } from "hono";
import { z } from "zod";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getDB } from "../lib/mongo";
import { getCurrentUser } from "../middleware/auth";
import {
  getEmbedding,
  GEMINI_GENERATION_MODEL,
  isGeminiApiKeyError,
  isGeminiRateLimitError,
  withGemini429Retry,
} from "../lib/gemini";
import { cosineSimilarity } from "../lib/vectorUtils";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

/** Model for knowledge-graph Q&A (override via GEMINI_CHAT_MODEL; else GEMINI_GENERATION_MODEL / default). */
const GEMINI_CHAT_MODEL =
  process.env.GEMINI_CHAT_MODEL?.trim() || GEMINI_GENERATION_MODEL;

function parseCommaModels(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

/** Tried in order after the primary chat model when that model returns 429 (separate free-tier quotas). */
const DEFAULT_CHAT_MODEL_FALLBACKS = ["gemini-2.5-flash", "gemini-2.0-flash"];

export const chatRouter = new Hono();

export type ChatSynthesis = "none" | "gemini" | "fallback_no_key" | "fallback_error";

chatRouter.get("/repo/:owner/:name/chat/status", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) return c.json({ error: "Not authenticated" }, 401);
    const geminiConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());
    return c.json({
      geminiConfigured,
      model: GEMINI_CHAT_MODEL,
    });
  } catch (error) {
    console.error("Chat status error:", error);
    return c.json({ error: "Failed to read chat status" }, 500);
  }
});

/** Dynamic starter questions from ingested node types and topic frequencies (Prompt 5 / PROMPTS_KG_ENHANCEMENTS). */
chatRouter.get("/repo/:owner/:name/chat/suggestions", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) return c.json({ error: "Not authenticated" }, 401);
    const owner = c.req.param("owner");
    const name = c.req.param("name");
    const repoFull = normalizeRepo(owner, name);
    const db = getDB();
    const nodes = await db
      .collection("knowledge_nodes")
      .find({ repo: repoFull })
      .project({ type: 1, topics: 1 })
      .limit(280)
      .toArray();
    if (nodes.length === 0) {
      return c.json({ suggestions: [] as string[] });
    }

    const typeCounts: Record<string, number> = {};
    const topicFreq = new Map<string, number>();
    for (const n of nodes) {
      const doc = n as Record<string, unknown>;
      const ty = String(doc.type || "other");
      typeCounts[ty] = (typeCounts[ty] || 0) + 1;
      for (const topic of (doc.topics as string[]) || []) {
        const k = String(topic).trim();
        if (k) topicFreq.set(k, (topicFreq.get(k) || 0) + 1);
      }
    }

    const topTopics = [...topicFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([t]) => t);

    const out: string[] = [];
    const push = (s: string) => {
      const t = s.trim();
      if (t.length >= 12 && !out.includes(t)) out.push(t);
    };

    push("What are the main themes in recent merged work, and how do they connect?");
    if (topTopics[0]) {
      push(`What decisions were made around "${topTopics[0]}" and which PRs support them?`);
    }
    if ((typeCounts.security || 0) > 0) {
      push("What security-related changes were merged, and what problems did they address?");
    }
    if ((typeCounts.architecture || 0) > 0) {
      push("Summarize architecture decisions from the graph and their tradeoffs.");
    }
    push("Which PRs share the same closing issue, and how does the work line up?");
    if (topTopics[1]) {
      push(`How does work on "${topTopics[1]}" relate to other topics in the graph?`);
    }

    return c.json({ suggestions: out.slice(0, 4) });
  } catch (error) {
    console.error("Chat suggestions error:", error);
    return c.json({ error: "Failed to load suggestions" }, 500);
  }
});

function filePathMatchScore(filePath: string, changedFiles: string[]): number {
  const norm = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!norm) return 0;
  const base = norm.split("/").pop() || norm;
  let best = 0;
  for (const raw of changedFiles) {
    const f = String(raw).replace(/\\/g, "/");
    if (!f) continue;
    if (f === norm) best = Math.max(best, 1);
    else if (f.endsWith(norm) || norm.endsWith(f)) best = Math.max(best, 0.92);
    else if (base.length >= 4 && (f.includes(norm) || norm.includes(f))) best = Math.max(best, 0.82);
    else if (base.length >= 4 && f.split("/").pop() === base) best = Math.max(best, 0.78);
  }
  return best;
}

const fileRelatedSchema = z.object({
  path: z.string().min(1).max(600),
});

/** Related merged PRs for the current file: changed_files overlap + semantic embedding (Prompt 1). */
chatRouter.post("/repo/:owner/:name/kg/file-related", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) return c.json({ error: "Not authenticated" }, 401);
    const owner = c.req.param("owner");
    const name = c.req.param("name");
    const repoFull = normalizeRepo(owner, name);
    const body = await c.req.json();
    const { path: rawPath } = fileRelatedSchema.parse(body);
    const path = rawPath.replace(/\\/g, "/").trim();
    if (!path) {
      return c.json({ items: [] as unknown[] });
    }

    const db = getDB();
    const count = await db.collection("knowledge_nodes").countDocuments({ repo: repoFull });
    if (count === 0) {
      return c.json({ items: [] });
    }

    const docs = await db
      .collection("knowledge_nodes")
      .find({ repo: repoFull })
      .project({ embedding: 0 })
      .limit(450)
      .toArray();

    const fromFile: ScoredNode[] = [];
    for (const doc of docs) {
      const files = (doc.changed_files as string[]) || [];
      const s = filePathMatchScore(path, files);
      if (s > 0) {
        fromFile.push({ doc: doc as Record<string, unknown>, score: s });
      }
    }

    let fromSemantic: ScoredNode[] = [];
    const base = path.split("/").pop() || path;
    const embedQ = `Repository file path "${path}" (file ${base}). Pull requests and code changes touching this file or module.`;
    try {
      const queryVector = await getEmbedding(embedQ, "query");
      let sem: ScoredNode[] = [];
      if (queryVector?.length) {
        sem = await tryVectorSearchAtlas(db, repoFull, queryVector);
        if (!sem.length) {
          sem = await tryInMemoryVector(db, repoFull, queryVector);
        }
      }
      if (!sem.length) {
        sem = await tryTextSearch(db, repoFull, `${base} ${path}`);
      }
      fromSemantic = dedupeByPr(sem).slice(0, 10);
    } catch {
      /* optional path */
    }

    const merged = dedupeByPr([...fromFile, ...fromSemantic]).slice(0, 3);
    const filePrs = new Set(fromFile.map((x) => x.doc.pr_number as number));
    const semPrs = new Set(fromSemantic.map((x) => x.doc.pr_number as number));

    const items = merged.map((x) => {
      const pr = x.doc.pr_number as number;
      const inF = filePrs.has(pr);
      const inS = semPrs.has(pr);
      const match_kind = inF && inS ? "both" : inF ? "file" : "semantic";
      return {
        pr_number: pr,
        pr_url: String(x.doc.pr_url || ""),
        title: String(x.doc.title || ""),
        summary: String(x.doc.summary || "").slice(0, 240),
        score: Math.round(Math.min(1, x.score) * 1000) / 1000,
        match_kind,
      };
    });

    return c.json({ items });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: "Invalid path", details: error.errors }, 400);
    }
    console.error("kg/file-related error:", error);
    return c.json({ error: "Failed to load related decisions" }, 500);
  }
});

const chatHistoryTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(12000),
});

const chatRequestSchema = z.object({
  question: z.string().min(5).max(2000),
  /** Prior user/assistant turns for follow-ups; retrieval still keys off `question` only. */
  history: z.array(chatHistoryTurnSchema).max(24).optional(),
});

const MAX_HISTORY_TURNS = 14;
const MAX_HISTORY_CHARS = 28000;

function normalizeChatHistory(
  raw: { role: "user" | "assistant"; content: string }[] | undefined
): { role: "user" | "assistant"; content: string }[] {
  if (!raw?.length) return [];
  const trimmed = raw
    .map((t) => ({
      role: t.role,
      content: String(t.content || "").trim().slice(0, 12000),
    }))
    .filter((t) => t.content.length > 0);
  let slice = trimmed.slice(-MAX_HISTORY_TURNS);
  let total = slice.reduce((a, t) => a + t.content.length, 0);
  while (slice.length > 2 && total > MAX_HISTORY_CHARS) {
    slice = slice.slice(1);
    total = slice.reduce((a, t) => a + t.content.length, 0);
  }
  while (slice.length > 0 && slice[0].role !== "user") {
    slice = slice.slice(1);
  }
  return slice;
}

/** Gemini chat roles: user | model (assistant → model). */
function buildGeminiContents(
  history: { role: "user" | "assistant"; content: string }[],
  finalUserText: string
): { role: "user" | "model"; parts: { text: string }[] }[] {
  const out: { role: "user" | "model"; parts: { text: string }[] }[] = [];
  for (const h of history) {
    const role: "user" | "model" = h.role === "user" ? "user" : "model";
    out.push({ role, parts: [{ text: h.content }] });
  }
  out.push({ role: "user", parts: [{ text: finalUserText }] });
  return out;
}

const STOP = new Set([
  "the",
  "what",
  "why",
  "how",
  "did",
  "does",
  "was",
  "were",
  "this",
  "that",
  "from",
  "with",
  "and",
  "for",
  "are",
  "you",
  "your",
]);

function normalizeRepo(owner: string, name: string) {
  return `${owner}/${name}`.toLowerCase().replace(/^\/+|\/+$/g, "");
}

type Tier = "vector" | "text" | "regex" | "none";

type ScoredNode = { doc: Record<string, unknown>; score: number };

function dedupeByPr(nodes: ScoredNode[]): ScoredNode[] {
  const best = new Map<number, ScoredNode>();
  for (const n of nodes) {
    const pr = n.doc.pr_number as number;
    const cur = best.get(pr);
    if (!cur || n.score > cur.score) best.set(pr, n);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

type LinkedIssueDoc = {
  number: number;
  title?: string;
  url?: string;
  body_excerpt?: string;
};

/**
 * Pull in additional PRs that share closing issues, ingest themes, or authors with the best matches
 * so answers can connect "who / why / related work" without relying on a single embedding hit.
 */
async function expandRelatedNodes(
  db: ReturnType<typeof getDB>,
  repoFull: string,
  seeds: ScoredNode[],
  maxExtra: number
): Promise<ScoredNode[]> {
  if (!seeds.length || maxExtra <= 0) return [];

  const prNums = new Set<number>();
  const issueNums = new Set<number>();
  const topicSet = new Set<string>();
  const authors = new Set<string>();

  for (const s of seeds) {
    prNums.add(s.doc.pr_number as number);
    const li = (s.doc.linked_issues as LinkedIssueDoc[]) || [];
    for (const i of li) {
      if (Number.isFinite(i.number)) issueNums.add(i.number);
    }
    for (const t of (s.doc.topics as string[]) || []) {
      const x = t.trim();
      if (x) topicSet.add(x);
    }
    const a = String(s.doc.pr_author || "").trim();
    if (a && a.toLowerCase() !== "unknown") authors.add(a);
  }

  const orClauses: Record<string, unknown>[] = [];
  if (issueNums.size) orClauses.push({ "linked_issues.number": { $in: [...issueNums] } });
  if (topicSet.size) orClauses.push({ topics: { $in: [...topicSet] } });
  if (authors.size) orClauses.push({ pr_author: { $in: [...authors] } });
  if (!orClauses.length) return [];

  const candidates = await db
    .collection("knowledge_nodes")
    .find({
      repo: repoFull,
      pr_number: { $nin: [...prNums] },
      $or: orClauses,
    })
    .project({ embedding: 0 })
    .limit(140)
    .toArray();

  const seedTopicLower = [...topicSet].map((t) => t.toLowerCase());
  const scoredExtra: ScoredNode[] = [];

  for (const doc of candidates) {
    const d = doc as Record<string, unknown>;
    let bonus = 0;
    const li = (d.linked_issues as LinkedIssueDoc[]) || [];
    const liNums = new Set(li.map((x) => x.number));
    for (const n of issueNums) {
      if (liNums.has(n)) bonus += 2.5;
    }
    const tops = ((d.topics as string[]) || []).map((t) => t.toLowerCase());
    for (const st of seedTopicLower) {
      if (tops.some((t) => t === st || t.includes(st) || st.includes(t))) bonus += 1.2;
    }
    if (authors.has(String(d.pr_author || "").trim())) bonus += 0.85;
    if (bonus <= 0) continue;
    const synthetic = 0.28 + Math.min(bonus * 0.07, 0.55);
    scoredExtra.push({ doc: d, score: synthetic });
  }

  return dedupeByPr(scoredExtra).slice(0, maxExtra);
}

const QUOTE_MAX = 450;

function truncQuote(s: string, max: number): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function buildContextBlock(n: Record<string, unknown>): string {
  const quotes = (n.key_quotes as Array<{ author: string; text: string }>) || [];
  const alts = (n.alternatives as string[]) || [];
  const files = (n.changed_files as string[]) || [];
  const linked = (n.linked_issues as LinkedIssueDoc[]) || [];
  const linkedLines =
    linked.length > 0
      ? linked
          .map((i) => {
            const ex = i.body_excerpt?.trim()
              ? `\n    Issue context (excerpt): ${truncQuote(i.body_excerpt, 420)}`
              : "";
            return `  - Issue #${i.number}: ${i.title || ""} → ${i.url || ""}${ex}`;
          })
          .join("\n")
      : "  (none in index — re-run Build Knowledge Graph to refresh issue links)";
  const mc = n.merge_commit as { short?: string; url?: string } | null | undefined;
  const mergeLine = mc?.url
    ? `Merge commit: ${mc.short || ""} → ${mc.url}`
    : "(merge commit not stored for this PR — re-run ingest to link commits)";
  const narrative = String(n.full_narrative || "").slice(0, 4000);
  const topics = (n.topics as string[]) || [];
  const topicLine = topics.length ? topics.join(", ") : "(none)";
  const prUrl = String(n.pr_url || "");
  const add = typeof n.additions === "number" ? n.additions : null;
  const del = typeof n.deletions === "number" ? n.deletions : null;
  const sizeLine =
    add != null && del != null ? `Approx. diff size: +${add} / -${del} lines (from GitHub)` : "";
  const quoteBlock =
    quotes.length > 0
      ? quotes
          .map((q) => `  - ${q.author || "unknown"}: "${truncQuote(q.text, QUOTE_MAX)}"`)
          .join("\n")
      : "  (none)";
  return `--- Knowledge Node (PR #${n.pr_number}, type: ${n.type}) ---
PR URL: ${prUrl || "(unknown)"}
Title: ${n.title}
GitHub author (merge): ${n.pr_author || "unknown"}
Topics: ${topicLine}
Summary: ${n.summary}
Problem: ${n.problem}
Decision: ${n.decision}
Linked issues (from GitHub GraphQL):
${linkedLines}
${mergeLine}
Alternatives considered: ${alts.length ? alts.join("; ") : "(none)"}
Key quotes (exact text from reviews/discussion — use verbatim when citing):
${quoteBlock}
Impact: ${n.impact}
Files changed: ${files.join(", ") || "unknown"}
Merged at: ${n.merged_at || "unknown"}
${sizeLine ? `${sizeLine}\n` : ""}Consolidated narrative (excerpt): ${narrative || "(none)"}
---`;
}

async function tryVectorSearchAtlas(
  db: ReturnType<typeof getDB>,
  repoFull: string,
  queryVector: number[]
): Promise<ScoredNode[]> {
  const coll = db.collection("knowledge_nodes");
  const pipeline = [
    {
      $vectorSearch: {
        index: "knowledge_vector_index",
        path: "embedding",
        queryVector,
        numCandidates: 150,
        limit: 24,
        filter: { repo: repoFull },
      },
    },
    {
      $set: { vectorScore: { $meta: "vectorSearchScore" } },
    },
    {
      $project: {
        embedding: 0,
        vectorScore: 1,
        repo: 1,
        pr_number: 1,
        pr_url: 1,
        type: 1,
        title: 1,
        summary: 1,
        problem: 1,
        decision: 1,
        alternatives: 1,
        key_quotes: 1,
        impact: 1,
        changed_files: 1,
        merged_at: 1,
        topics: 1,
        full_narrative: 1,
        linked_issues: 1,
        merge_commit: 1,
        pr_author: 1,
        additions: 1,
        deletions: 1,
      },
    },
  ];
  const raw = await coll.aggregate(pipeline as any).toArray();
  return raw
    .map((doc: any) => ({
      doc,
      score: typeof doc.vectorScore === "number" ? doc.vectorScore : 0,
    }))
    .filter((x) => x.score >= 0.45)
    .map(({ doc, score }) => {
      const { vectorScore: _v, ...rest } = doc;
      return { doc: rest, score };
    });
}

async function tryInMemoryVector(
  db: ReturnType<typeof getDB>,
  repoFull: string,
  queryVector: number[]
): Promise<ScoredNode[]> {
  const docs = await db
    .collection("knowledge_nodes")
    .find({ repo: repoFull })
    .project({
      embedding: 1,
      repo: 1,
      pr_number: 1,
      pr_url: 1,
      type: 1,
      title: 1,
      summary: 1,
      problem: 1,
      decision: 1,
      alternatives: 1,
      key_quotes: 1,
      impact: 1,
      changed_files: 1,
      merged_at: 1,
      topics: 1,
      full_narrative: 1,
      linked_issues: 1,
      merge_commit: 1,
      pr_author: 1,
      additions: 1,
      deletions: 1,
    })
    .limit(200)
    .toArray();

  const scored: ScoredNode[] = [];
  for (const doc of docs) {
    const emb = doc.embedding as number[] | undefined;
    if (!Array.isArray(emb) || emb.length !== queryVector.length) continue;
    const score = cosineSimilarity(queryVector, emb);
    if (score >= 0.45) {
      const { embedding: _e, ...rest } = doc;
      scored.push({ doc: rest as Record<string, unknown>, score });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 24);
}

async function tryTextSearch(
  db: ReturnType<typeof getDB>,
  repoFull: string,
  question: string
): Promise<ScoredNode[]> {
  try {
    const arr = await db
      .collection("knowledge_nodes")
      .find({ repo: repoFull, $text: { $search: question } })
      .project({ score: { $meta: "textScore" }, embedding: 0 })
      .sort({ score: { $meta: "textScore" } })
      .limit(20)
      .toArray();
    return arr
      .map((doc: any) => {
        const { score, ...rest } = doc;
        return {
          doc: rest as Record<string, unknown>,
          score: typeof score === "number" ? score : 0,
        };
      })
      .filter((x) => x.score >= 1.0);
  } catch {
    return [];
  }
}

function keywordsFromQuestion(q: string): string[] {
  const handles = [...q.matchAll(/@([\w-]{2,39})/g)].map((m) => m[1].toLowerCase());
  const words = q
    .split(/\s+/)
    .map((w) => w.replace(/[^\w-]/g, "").toLowerCase())
    .filter((w) => w.length >= 3 && !STOP.has(w));
  const merged = [...handles, ...words];
  return [...new Set(merged)].slice(0, 12);
}

async function tryRegexFallback(
  db: ReturnType<typeof getDB>,
  repoFull: string,
  question: string
): Promise<ScoredNode[]> {
  const keywords = keywordsFromQuestion(question);
  if (!keywords.length) return [];

  const docs = await db
    .collection("knowledge_nodes")
    .find({ repo: repoFull })
    .project({ embedding: 0 })
    .limit(400)
    .toArray();

  const scored: ScoredNode[] = [];
  const fields = [
    "title",
    "summary",
    "decision",
    "problem",
    "full_narrative",
    "pr_author",
    "impact",
  ] as const;

  const linkedText = (doc: Record<string, unknown>) => {
    const arr = (doc.linked_issues as Array<{ title?: string; number?: number }>) || [];
    return arr.map((i) => `${i.number} ${i.title || ""}`).join(" ");
  };

  const quotesText = (doc: Record<string, unknown>) => {
    const arr = (doc.key_quotes as Array<{ author?: string; text?: string }>) || [];
    return arr.map((q) => `${q.author || ""} ${q.text || ""}`).join(" ");
  };

  const topicsText = (doc: Record<string, unknown>) =>
    ((doc.topics as string[]) || []).join(" ");
  const filesText = (doc: Record<string, unknown>) =>
    ((doc.changed_files as string[]) || []).join(" ");
  const altsText = (doc: Record<string, unknown>) =>
    ((doc.alternatives as string[]) || []).join(" ");

  for (const doc of docs) {
    let matches = 0;
    for (const kw of keywords) {
      const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const d = doc as Record<string, unknown>;
      if (
        fields.some((f) => re.test(String(d[f] || ""))) ||
        re.test(linkedText(d)) ||
        re.test(quotesText(d)) ||
        re.test(topicsText(d)) ||
        re.test(filesText(d)) ||
        re.test(altsText(d))
      ) {
        matches++;
      }
    }
    if (matches > 0) {
      const score = matches / keywords.length;
      scored.push({ doc: doc as Record<string, unknown>, score });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, 20);
}

chatRouter.post("/repo/:owner/:name/chat", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) return c.json({ error: "Not authenticated" }, 401);

    const owner = c.req.param("owner");
    const name = c.req.param("name");
    const repoFull = normalizeRepo(owner, name);

    const body = await c.req.json();
    const parsed = chatRequestSchema.parse(body);
    const question = parsed.question.trim();
    const chatHistory = normalizeChatHistory(parsed.history);

    const db = getDB();

    const nodeCount = await db.collection("knowledge_nodes").countDocuments({ repo: repoFull });
    const geminiConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());

    if (nodeCount === 0) {
      return c.json({
        answer:
          "No knowledge graph exists for this repo yet. Use **Build Knowledge Graph** on the Overview page to ingest merged PRs, then ask again.",
        sources: [],
        searchTier: "none" as Tier,
        nodesSearched: 0,
        nodesUsed: 0,
        geminiConfigured,
        synthesis: "none" as ChatSynthesis,
        model: GEMINI_CHAT_MODEL,
      });
    }

    const progress = await db.collection("knowledge_progress").findOne({ repo: repoFull });
    const ingestNote =
      progress && (progress as any).status === "running"
        ? "\n\n_Note: Knowledge graph ingestion is still running — some PRs may not be indexed yet._\n"
        : "";

    let tier: Tier = "none";
    let scored: ScoredNode[] = [];
    let embeddingFailed = false;

    let queryVector: number[] | null = null;
    try {
      queryVector = await getEmbedding(question, "query");
    } catch {
      embeddingFailed = true;
    }
    if (!queryVector) embeddingFailed = true;

    if (queryVector && !embeddingFailed) {
      try {
        scored = await tryVectorSearchAtlas(db, repoFull, queryVector);
        if (scored.length) tier = "vector";
      } catch {
        /* Atlas vector index missing or error */
      }
      if (!scored.length) {
        scored = await tryInMemoryVector(db, repoFull, queryVector);
        if (scored.length) tier = "vector";
      }
    }

    if (!scored.length) {
      scored = await tryTextSearch(db, repoFull, question);
      if (scored.length) tier = "text";
    }

    if (!scored.length) {
      scored = await tryRegexFallback(db, repoFull, question);
      if (scored.length) tier = "regex";
    }

    if (!scored.length) {
      return c.json({
        answer:
          "I don't have enough indexed decisions that match that question. Try different keywords, or run **Build Knowledge Graph** if you haven't yet.",
        sources: [],
        searchTier: "none",
        nodesSearched: 0,
        nodesUsed: 0,
        geminiConfigured,
        synthesis: "none" as ChatSynthesis,
        model: GEMINI_CHAT_MODEL,
      });
    }

    const nodesSearched = scored.length;
    const primaryRanked = dedupeByPr(scored);
    const seeds = primaryRanked.slice(0, 14);
    const expanded = await expandRelatedNodes(db, repoFull, seeds, 8);
    let usedNodes = dedupeByPr([...scored, ...expanded]).slice(0, 20);

    const CONTEXT_CHAR_CAP = 42000;
    const buildContext = (nodes: ScoredNode[]) => {
      const parts = nodes.map((x) => buildContextBlock(x.doc));
      return { parts, text: parts.join("\n\n") };
    };
    let { text: context } = buildContext(usedNodes);
    if (context.length > CONTEXT_CHAR_CAP) {
      usedNodes = usedNodes.slice(0, 14);
      ({ text: context } = buildContext(usedNodes));
    }
    if (context.length > CONTEXT_CHAR_CAP) {
      usedNodes = usedNodes.slice(0, 10);
      ({ text: context } = buildContext(usedNodes));
    }
    if (context.length > CONTEXT_CHAR_CAP) {
      usedNodes = usedNodes.slice(0, 7);
      ({ text: context } = buildContext(usedNodes));
    }

    const systemPreamble = `You are GitLore, a senior staff engineer helping someone understand this repository through its merged-PR knowledge graph. You write ONLY from the knowledge nodes provided—no speculation, no outside GitHub browsing, no general knowledge that is not implied by the nodes.

Goals (make this a one-stop answer):
- Give a clear, fast read: start with **TL;DR** (2–4 short bullets or one tight paragraph) that directly answers the question.
- Then a **Details** section: narrative prose with smooth transitions ("Earlier…", "Related PRs…", "Same theme…"). Connect PRs via shared issues, topics, authors, and time (merged_at) when the nodes support it.
- Call out **who** did work: pr_author (merge author on GitHub) vs people named in key_quotes (reviewers/commenters)—do not conflate them.
- Call out **why** when the nodes contain problem, decision, alternatives, and impact—walk problem → options → decision → outcome when relevant.
- Call out **issues**: use linked_issues titles, URLs, and any issue excerpt text exactly as given. If issue links are missing, say the graph may need a refresh.

Grounding (non-negotiable):
- Use ONLY fields present in the nodes: title, summary, problem, decision, impact, alternatives, key_quotes, linked_issues (including body_excerpt when present), merge_commit, topics, full_narrative excerpt, pr_author, merged_at, type, changed_files, additions/deletions line, pr_url.
- Never invent PR numbers, issue numbers, URLs, dates, or quotes. Quotes must match key_quotes verbatim with author from the node.
- If the question is not answered by the nodes, say what IS known from the closest PRs and what is missing.

Diagrams (optional, when they genuinely help):
- You MAY add at most one or two **Mermaid** diagrams in fenced code blocks: \`\`\`mermaid ... \`\`\`
- Use only flowchart, sequenceDiagram, or graph TD/LR. Node labels must use PR titles or issue titles **as they appear in the nodes** (shorten in the label if needed) and PR numbers exactly as given (e.g. PR #42).
- Do NOT invent nodes, actors, or relationships that are not supported by the nodes. If a diagram would be speculative, skip it and use prose instead.
- Do not use HTML img or external image URLs—there are no hosted screenshots in this pipeline.

Formatting:
- Use Markdown: ## for TL;DR and Details, ### for subsections when helpful.
- Bullet lists are fine for parallel PRs or checklists when it improves scanability.
- End with a **Sources to open** line only if not redundant: point readers to the highest-signal PR URLs from the nodes (pr_url).

Multi-turn conversation:
- Earlier turns are for phrasing and follow-ups only. The **Knowledge nodes** block in this (latest) message is the sole source of truth for facts, PR/issue numbers, quotes, and URLs. If a prior answer was wrong or incomplete, correct it using the nodes here.`;

    const userMsg = `Repository context: ${repoFull}

Below are knowledge nodes retrieved for this question (vector/text search plus related PRs that share issues, themes, or authors). Read them carefully, then answer.

Knowledge nodes:
${context}

User question:
${question}

Instructions: Answer using only the nodes above. Prefer clarity over length. If the user asks something broad, synthesize across PRs; if narrow, stay focused. Use a Mermaid diagram only when it adds real structure (e.g. decision flow or PR/issue relationships) and only with grounded labels.`;

    const configuredFallbacks = parseCommaModels(process.env.GEMINI_CHAT_MODEL_FALLBACKS);
    const chatFallbacks = configuredFallbacks.length
      ? configuredFallbacks
      : DEFAULT_CHAT_MODEL_FALLBACKS;
    const chatModelChain = [
      GEMINI_CHAT_MODEL,
      ...chatFallbacks.filter((m) => m !== GEMINI_CHAT_MODEL),
    ];

    let answer: string;
    let synthesis: ChatSynthesis = "none";
    let modelForResponse = GEMINI_CHAT_MODEL;
    if (!geminiConfigured) {
      synthesis = "fallback_no_key";
      answer =
        "GEMINI_API_KEY is not set in the GitLore **Backend** environment, so answers are not synthesized by Gemini. Add `GEMINI_API_KEY` to `GitLore/Backend/.env`, restart the API server, then ask again.\n\nClosest matching PR decisions from the index:\n\n" +
        usedNodes
          .map(
            (x) =>
              `• PR #${x.doc.pr_number} [${x.doc.type}]: ${x.doc.title}\n  ${String(x.doc.summary).slice(0, 280)}${String(x.doc.summary).length > 280 ? "…" : ""}`
          )
          .join("\n\n");
    } else {
      try {
        let lastErr: unknown;
        let geminiResult: { text: string; model: string } | null = null;
        for (let i = 0; i < chatModelChain.length; i++) {
          const modelName = chatModelChain[i];
          const isLast = i === chatModelChain.length - 1;
          try {
            const mdl = genAI.getGenerativeModel({
              model: modelName,
              systemInstruction: systemPreamble,
            } as Parameters<typeof genAI.getGenerativeModel>[0]);
            const contents = buildGeminiContents(chatHistory, userMsg);
            const run = () =>
              mdl.generateContent({
                contents,
                generationConfig: {
                  maxOutputTokens: 6144,
                  temperature: 0.38,
                  topP: 0.92,
                  topK: 40,
                },
              });
            const result = isLast
              ? await withGemini429Retry(run, { maxRetries: 2 })
              : await run();
            const text =
              result.response.candidates?.[0]?.content?.parts?.[0]?.text ||
              "Unable to generate a synthesized answer.";
            geminiResult = { text, model: modelName };
            break;
          } catch (e) {
            lastErr = e;
            if (isGeminiRateLimitError(e) && !isLast) {
              console.warn(
                `[chat] Model ${modelName} rate limited; trying ${chatModelChain[i + 1]}…`
              );
              continue;
            }
            throw e;
          }
        }
        if (!geminiResult) {
          throw lastErr instanceof Error
            ? lastErr
            : new Error("Gemini chat: no model succeeded");
        }
        answer = geminiResult.text;
        synthesis = "gemini";
        modelForResponse = geminiResult.model;
      } catch (err) {
        console.error("Gemini chat synthesis error:", err);
        synthesis = "fallback_error";
        const rateLimited = isGeminiRateLimitError(err);
        const keyInvalid = isGeminiApiKeyError(err);
        const quotaNote = rateLimited
          ? "Google returned HTTP 429 (rate limit or free-tier quota). Wait about a minute and try again, or review billing and limits: https://ai.google.dev/gemini-api/docs/rate-limits\n\n"
          : "";
        const keyNote = keyInvalid
          ? "Your Gemini API key was rejected (expired, revoked, or invalid). Create a new key in Google AI Studio (https://aistudio.google.com/apikey), set GEMINI_API_KEY in GitLore/Backend/.env, and restart the backend. Retrying will not help until the key is updated.\n\n"
          : "";
        answer =
          (keyInvalid
            ? "Gemini could not run because the API key is not valid.\n\n"
            : "Gemini synthesis failed (check API key, quota, and model name). Showing raw matches from the graph:\n\n") +
          keyNote +
          quotaNote +
          usedNodes
            .map(
              (x) =>
                `• PR #${x.doc.pr_number}: ${x.doc.title} — ${String(x.doc.summary).slice(0, 200)}…`
            )
            .join("\n");
      }
    }

    answer = answer + ingestNote;

    const sources = usedNodes.map((x) => ({
      pr_number: x.doc.pr_number as number,
      pr_url: String(x.doc.pr_url || ""),
      title: String(x.doc.title || ""),
      type: String(x.doc.type || "other"),
      score: Math.round(x.score * 1000) / 1000,
    }));

    return c.json({
      answer,
      sources,
      searchTier: tier,
      nodesSearched,
      nodesUsed: usedNodes.length,
      geminiConfigured,
      synthesis,
      model: modelForResponse,
    });
  } catch (error) {
    console.error("Chat error:", error);
    if (error instanceof z.ZodError) {
      return c.json(
        { error: "Invalid question (use 5–2000 characters)", details: error.errors },
        400
      );
    }
    return c.json({ error: "Failed to process question" }, 500);
  }
});
