import { Hono } from "hono";
import { z } from "zod";
import { getDB } from "../lib/mongo";
import { getCurrentUser } from "../middleware/auth";
import {
  GEMINI_GENERATION_MODEL,
  getEmbedding,
  getGoogleGenAI,
  isGeminiApiKeyError,
  isGeminiRateLimitError,
  withGemini429Retry,
} from "../lib/gemini";
import {
  normalizeRepoKey,
  type SearchTier,
  dedupeByPr,
  buildContextBlock,
  runKnowledgeSearch,
  expandRelatedNodes,
  tryVectorSearchAtlas,
  tryInMemoryVector,
  tryTextSearch,
} from "../lib/knowledgeSearch";
import { agenticKnowledgeChat } from "../lib/gemini-agent";

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
    const repoFull = normalizeRepoKey(owner, name);
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
    const repoFull = normalizeRepoKey(owner, name);
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

type Tier = SearchTier;
type ScoredNode = import("../lib/knowledgeSearch").ScoredNode;

chatRouter.post("/repo/:owner/:name/chat", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) return c.json({ error: "Not authenticated" }, 401);

    const owner = c.req.param("owner");
    const name = c.req.param("name");
    const repoFull = normalizeRepoKey(owner, name);

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

    const useArmorAgent =
      geminiConfigured && process.env.GITLORE_ARMOR_AGENT_CHAT !== "0";

    if (useArmorAgent) {
      try {
        const agentRes = await agenticKnowledgeChat({
          db,
          userId: `github:${user.username}`,
          githubLogin: user.username,
          accessToken: user.access_token,
          owner,
          name,
          repoFull,
          question,
          ingestNote,
          geminiModel: GEMINI_CHAT_MODEL,
        });
        return c.json(agentRes);
      } catch (e) {
        console.warn("Armor agent chat failed, falling back to legacy pipeline:", e);
      }
    }

    const { tier, scored } = await runKnowledgeSearch(db, repoFull, question);

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
            const ai = getGoogleGenAI();
            const contentsForModel =
              chatHistory.length > 0 ? buildGeminiContents(chatHistory, userMsg) : userMsg;
            const run = () =>
              ai.models.generateContent({
                model: modelName,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                contents: contentsForModel as any,
                config: {
                  systemInstruction: systemPreamble,
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
              result.text || "Unable to generate a synthesized answer.";
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
