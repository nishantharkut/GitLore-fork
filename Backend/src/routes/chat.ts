import { Hono } from "hono";
import { z } from "zod";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getDB } from "../lib/mongo";
import { getCurrentUser } from "../middleware/auth";
import { getEmbedding } from "../lib/gemini";
import { cosineSimilarity } from "../lib/vectorUtils";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

/** Model for knowledge-graph Q&A (override via GEMINI_CHAT_MODEL). */
const GEMINI_CHAT_MODEL = process.env.GEMINI_CHAT_MODEL?.trim() || "gemini-2.5-flash";

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

const chatRequestSchema = z.object({
  question: z.string().min(5).max(2000),
});

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

function buildContextBlock(n: Record<string, unknown>): string {
  const quotes = (n.key_quotes as Array<{ author: string; text: string }>) || [];
  const alts = (n.alternatives as string[]) || [];
  const files = (n.changed_files as string[]) || [];
  const linked =
    (n.linked_issues as Array<{ number: number; title?: string; url?: string }>) || [];
  const linkedLines =
    linked.length > 0
      ? linked.map((i) => `  - Issue #${i.number}: ${i.title || ""} → ${i.url || ""}`).join("\n")
      : "  (none in index — re-run Build Knowledge Graph to refresh issue links)";
  const mc = n.merge_commit as { short?: string; url?: string } | null | undefined;
  const mergeLine = mc?.url
    ? `Merge commit: ${mc.short || ""} → ${mc.url}`
    : "(merge commit not stored for this PR — re-run ingest to link commits)";
  const narrative = String(n.full_narrative || "").slice(0, 1500);
  const topics = (n.topics as string[]) || [];
  const topicLine = topics.length ? topics.join(", ") : "(none)";
  return `--- Knowledge Node (PR #${n.pr_number}, type: ${n.type}) ---
Title: ${n.title}
Author: ${n.pr_author || "unknown"}
Topics: ${topicLine}
Summary: ${n.summary}
Problem: ${n.problem}
Decision: ${n.decision}
Linked issues (from GitHub GraphQL):
${linkedLines}
${mergeLine}
Alternatives considered: ${alts.length ? alts.join(", ") : "(none)"}
Key quotes:
${quotes.length ? quotes.map((q) => `  - ${q.author}: "${q.text}"`).join("\n") : "  (none)"}
Impact: ${n.impact}
Files changed: ${files.join(", ") || "unknown"}
Merged: ${n.merged_at || "unknown"}
Full narrative (excerpt): ${narrative || "(none)"}
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
        numCandidates: 100,
        limit: 10,
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
    })
    .limit(150)
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
  return scored.sort((a, b) => b.score - a.score).slice(0, 10);
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
      .limit(8)
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
  return q
    .split(/\s+/)
    .map((w) => w.replace(/[^\w-]/g, "").toLowerCase())
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .slice(0, 5);
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
    .limit(250)
    .toArray();

  const scored: ScoredNode[] = [];
  const fields = ["title", "summary", "decision", "problem", "full_narrative"] as const;

  const linkedText = (doc: Record<string, unknown>) => {
    const arr = (doc.linked_issues as Array<{ title?: string; number?: number }>) || [];
    return arr.map((i) => `${i.number} ${i.title || ""}`).join(" ");
  };

  for (const doc of docs) {
    let matches = 0;
    for (const kw of keywords) {
      const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      if (
        fields.some((f) => re.test(String((doc as Record<string, unknown>)[f] || ""))) ||
        re.test(linkedText(doc as Record<string, unknown>))
      ) {
        matches++;
      }
    }
    if (matches > 0) {
      const score = matches / keywords.length;
      scored.push({ doc: doc as Record<string, unknown>, score });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, 8);
}

chatRouter.post("/repo/:owner/:name/chat", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) return c.json({ error: "Not authenticated" }, 401);

    const owner = c.req.param("owner");
    const name = c.req.param("name");
    const repoFull = normalizeRepo(owner, name);

    const body = await c.req.json();
    const { question: rawQ } = chatRequestSchema.parse(body);
    const question = rawQ.trim();

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
      queryVector = await getEmbedding(question);
    } catch {
      embeddingFailed = true;
    }

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
    const deduped = dedupeByPr(scored).slice(0, 10);

    let contextParts = deduped.map((x) => buildContextBlock(x.doc));
    let context = contextParts.join("\n\n");
    if (context.length > 22000) {
      contextParts = contextParts.slice(0, 7);
      context = contextParts.join("\n\n");
    }

    const systemPreamble = `You are GitLore, a knowledge graph assistant for the repository ${repoFull}.
You answer questions about engineering decisions, architecture, PR history, linked issues, and contributors using ONLY the knowledge nodes provided below.

Rules:
1. ONLY use information from the provided knowledge nodes. Never invent PR numbers, issues, or quotes.
2. Always cite specific PR numbers (e.g. "In PR #42…"). When linked issues are listed for a PR, mention them by issue number.
3. Use exact wording from key_quotes when citing discussion; attribute the author.
4. If the nodes do not contain enough information, say what is missing and which PRs came closest.
5. For broad questions ("what changed in the API?"), synthesize across multiple PRs and compare timelines using merged dates when helpful.
6. Mention change type (feature/bugfix/refactor/etc.) and author when it clarifies the story.
7. Prefer accuracy and depth over brevity: use several short paragraphs when the user asks for history or "everything relevant".`;

    const userMsg = `Knowledge nodes:\n${context}\n\nUser question:\n${question}`;

    const model = genAI.getGenerativeModel({
      model: GEMINI_CHAT_MODEL,
      systemInstruction: systemPreamble,
    } as Parameters<typeof genAI.getGenerativeModel>[0]);

    let answer: string;
    let synthesis: ChatSynthesis = "none";
    if (!geminiConfigured) {
      synthesis = "fallback_no_key";
      answer =
        "GEMINI_API_KEY is not set in the GitLore **Backend** environment, so answers are not synthesized by Gemini. Add `GEMINI_API_KEY` to `GitLore/Backend/.env`, restart the API server, then ask again.\n\nClosest matching PR decisions from the index:\n\n" +
        deduped
          .map(
            (x) =>
              `• PR #${x.doc.pr_number} [${x.doc.type}]: ${x.doc.title}\n  ${String(x.doc.summary).slice(0, 280)}${String(x.doc.summary).length > 280 ? "…" : ""}`
          )
          .join("\n\n");
    } else {
      try {
        const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: userMsg }] }],
          generationConfig: {
            maxOutputTokens: 2048,
            temperature: 0.3,
            topP: 0.9,
          },
        });
        answer =
          result.response.candidates?.[0]?.content?.parts?.[0]?.text ||
          "Unable to generate a synthesized answer.";
        synthesis = "gemini";
      } catch (err) {
        console.error("Gemini chat synthesis error:", err);
        synthesis = "fallback_error";
        answer =
          "Gemini synthesis failed (check API key, quota, and model name). Showing raw matches from the graph:\n\n" +
          deduped
            .map(
              (x) =>
                `• PR #${x.doc.pr_number}: ${x.doc.title} — ${String(x.doc.summary).slice(0, 200)}…`
            )
            .join("\n");
      }
    }

    answer = answer + ingestNote;

    const sources = deduped.map((x) => ({
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
      nodesUsed: deduped.length,
      geminiConfigured,
      synthesis,
      model: GEMINI_CHAT_MODEL,
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
