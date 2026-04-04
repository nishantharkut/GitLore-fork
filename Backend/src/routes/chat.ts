import { Hono } from "hono";
import { z } from "zod";
import { getDB } from "../lib/mongo";
import { getCurrentUser } from "../middleware/auth";
import {
  GEMINI_GENERATION_MODEL,
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

const chatRequestSchema = z.object({
  question: z.string().min(5).max(2000),
});

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
    let usedNodes = dedupeByPr(scored).slice(0, 14);

    const CONTEXT_CHAR_CAP = 34000;
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

    const systemPreamble = `You are GitLore, a senior staff engineer explaining this repository's history to a teammate. You write from the knowledge nodes only—no speculation, no outside knowledge.

Voice and quality:
- Write polished, readable prose: varied sentence length, smooth transitions ("Separately…", "Earlier…", "In the same area…"), and one main idea per paragraph.
- Open with a short, direct takeaway (2–4 sentences) that answers the question. Then add depth: context, tradeoffs, who was involved, and how PRs relate.
- Prefer concrete nouns and verbs from the nodes over vague phrases like "the team improved things." Tie claims to PR numbers, issue numbers, file paths, or quotes.
- When several PRs matter, organize logically (e.g. by theme or by merged_at order) and make the thread easy to follow.
- Do not pad with generic disclaimers. If evidence is thin, say exactly what the nodes show and what they omit, in one clear sentence.

Grounding (non-negotiable):
- Use ONLY facts in the nodes (title, summary, problem, decision, impact, alternatives, key_quotes, linked_issues, merge_commit, topics, full_narrative excerpt, pr_author, merged_at, type, changed_files). If the answer is not in the graph, say so and point to the closest PRs by title/summary.
- Never invent PR numbers, issues, URLs, dates, or quotes. When you quote discussion, use the exact wording from key_quotes and attribute the author from the node.
- "GitHub author (merge)" is the merger/author on the PR; reviewers in key_quotes may differ—state that distinction when it matters.

By question type:
- Why / tradeoffs: problem → alternatives → decision → impact; fold in quotes where they illuminate disagreement or consensus.
- What changed: summarize the change, mention type (feature/bugfix/refactor…), files or areas if listed, and outcomes from impact.
- Who: only people named as pr_author or in key_quotes (or clearly in node text). Otherwise say the graph does not name them.
- When / order: use merged_at to sequence; do not infer dates beyond what is given.
- Issues: report linked_issues and merge_commit as stored; if missing, say ingest may need a refresh.

Formatting:
- Plain paragraphs. Use bullet lists only if the user asks for a list or many parallel items would be clearer that way.
- Naturally weave in PR references (e.g. "In PR #42, …").`;

    const userMsg = `Below are knowledge nodes retrieved for this question. Read them carefully, then answer.

Knowledge nodes:
${context}

User question:
${question}

Instructions: Answer using only the nodes above. Be specific and well structured. If the question is narrow, stay focused; if it is broad, synthesize without losing accuracy.`;

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
            const run = () =>
              ai.models.generateContent({
                model: modelName,
                contents: userMsg,
                config: {
                  systemInstruction: systemPreamble,
                  maxOutputTokens: 4096,
                  temperature: 0.42,
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
