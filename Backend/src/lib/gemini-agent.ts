/**
 * Reasoning layer: Gemini builds a tool plan; ArmorClaw enforces; tools execute.
 */
import type { Db } from "mongodb";
import {
  createEnforcementLayer,
  type EnforcementContext,
  type IntentPlan,
  type IntentPlanStep,
  markIngestExecuted,
  previewEnforcement,
} from "./armorclaw";
import {
  buildContextBlock,
  dedupeByPr,
  runKnowledgeSearch,
  type ScoredNode,
  type SearchTier,
} from "./knowledgeSearch";
import { createGithubClient, getBlameForLine, getIssue, getPullRequest, getRepositoryInfo } from "./github";
import { enrichRepositoryOverview, getRepoFileContent } from "./githubRest";
import {
  getEmbedding,
  GEMINI_GENERATION_MODEL,
  getGoogleGenAI,
  withGemini429Retry,
} from "./gemini";
import { ingestRepo } from "./ingest";

const TOOL_MANUAL = `
Available tools (use exact names):
- search_knowledge_graph: params { query: string, repo?: string } — search ingested PR knowledge for this repo.
- fetch_pr_details: params { pr_number: number, repo?: string } — PR title, body, reviews, comments.
- fetch_issue: params { number: number, repo?: string } — issue body and comments.
- fetch_blame: params { path: string, line: number, ref?: string, repo?: string } — git blame for a line.
- fetch_repo_stats: params { repo?: string } — contributor/file overview signals.
- fetch_file_content: params { path: string, ref?: string, repo?: string } — read file text from repo.
- generate_embedding: params { text: string } — vector embedding for similarity (metadata only).
- generate_narrative: params { context: string, question: string } — internal synthesis helper (already grounded).
- generate_voice: params { text: string } — not executed server-side in chat; noop with message.
- ingest_repo: params { limit?: number } — heavy; rate-limited; re-indexes merged PRs for current repo.

NEVER plan: access_credentials, modify_code, post_comment, delete_data, access_private_repo, access_other_user, external_upload, execute_code.
Always set repo to "${"{owner}/{name}"}" when omitted (the active repository).
`.trim();

function defaultPlan(question: string, owner: string, name: string): IntentPlan {
  return {
    intent: "answer_user_question",
    steps: [
      {
        step: 1,
        tool: "search_knowledge_graph",
        params: { query: question, repo: `${owner}/${name}` },
        justification: "Retrieve relevant knowledge nodes for the question",
      },
      {
        step: 2,
        tool: "generate_narrative",
        params: { context: "", question },
        justification: "Synthesize answer from tool results",
      },
    ],
  };
}

async function generatePlanJson(
  owner: string,
  name: string,
  question: string,
  modelName: string
): Promise<IntentPlan> {
  const sys = `You are a planning component for GitLore (code archaeology). Output ONLY valid JSON, no markdown.
Schema:
{ "intent": string, "steps": [ { "step": number, "tool": string, "params": object, "justification": string } ] }

${TOOL_MANUAL}

Rules:
- Use 2–6 steps typically. Start with search_knowledge_graph when answering about repo history.
- End with generate_narrative to synthesize from prior tool outputs (context will be filled by the runtime from results).
- PR/issue numbers must be integers if you include fetch_pr_details / fetch_issue.`;

  const user = `Repository: ${owner}/${name}
User question:
${question}

Return the JSON plan now.`;

  const ai = getGoogleGenAI();

  const res = await withGemini429Retry(() =>
    ai.models.generateContent({
      model: modelName,
      contents: user,
      config: {
        systemInstruction: sys,
        temperature: 0.2,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
    })
  );

  const text = res.text || "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return defaultPlan(question, owner, name);
  }
  const p = parsed as { steps?: IntentPlanStep[]; intent?: string };
  if (!Array.isArray(p.steps) || p.steps.length === 0) {
    return defaultPlan(question, owner, name);
  }
  return { intent: p.intent, steps: p.steps };
}

export type AgenticChatArgs = {
  db: Db;
  userId: string;
  githubLogin: string;
  accessToken: string;
  owner: string;
  name: string;
  repoFull: string;
  question: string;
  ingestNote: string;
  geminiModel: string;
};

export async function agenticKnowledgeChat(
  args: AgenticChatArgs
): Promise<Record<string, unknown>> {
  const {
    db,
    userId,
    githubLogin,
    accessToken,
    owner,
    name,
    repoFull,
    question,
    ingestNote,
    geminiModel,
  } = args;

  const gql = createGithubClient(accessToken);
  const repoMeta = await getRepositoryInfo(gql, owner, name);
  const repoIsPrivate = Boolean(repoMeta?.isPrivate);
  const repoOwnerLogin = String(repoMeta?.owner?.login || owner);

  const ctx: EnforcementContext = {
    userId,
    githubLogin,
    repoScope: repoFull,
    scopedOwner: owner,
    scopedRepo: name,
    accessToken,
    repoIsPrivate,
    repoOwnerLogin,
  };

  const layer = createEnforcementLayer(ctx);
  let plan = await generatePlanJson(owner, name, question, geminiModel);
  await layer.submitPlan(plan);

  const toolResults: Array<{ step: number; tool: string; ok: boolean; data: unknown }> = [];
  const enforcementSummary: Array<{
    tool: string;
    action: "allow" | "deny";
    reason: string;
    policy_rule?: string;
    risk_level?: string;
  }> = [];

  let searchTier: SearchTier = "none";
  let usedNodes: ScoredNode[] = [];

  for (const s of plan.steps) {
    const ex = await layer.enforceTool(s.tool, s.params || {}, s.step);
    enforcementSummary.push({
      tool: s.tool,
      action: ex.allowed ? "allow" : "deny",
      reason: ex.reason,
      policy_rule: ex.policy_rule,
      risk_level: ex.risk_level,
    });

    if (!ex.allowed) {
      toolResults.push({ step: s.step, tool: s.tool, ok: false, data: { blocked: true, reason: ex.reason } });
      continue;
    }

    const p = s.params || {};
    const o = owner;
    const n = name;
    const ref = typeof p.ref === "string" ? p.ref : "HEAD";

    try {
      let data: unknown = null;
      switch (s.tool) {
        case "search_knowledge_graph": {
          const q = String(p.query || question);
          const { tier, scored } = await runKnowledgeSearch(db, repoFull, q);
          searchTier = tier;
          usedNodes = dedupeByPr(scored).slice(0, 14);
          data = {
            tier,
            count: usedNodes.length,
            snippets: usedNodes.map((x) => ({
              pr: x.doc.pr_number,
              title: x.doc.title,
              score: x.score,
            })),
          };
          break;
        }
        case "fetch_pr_details": {
          const num = Number(p.pr_number ?? p.number);
          if (!Number.isFinite(num)) throw new Error("pr_number required");
          data = await getPullRequest(gql, o, n, num);
          break;
        }
        case "fetch_issue": {
          const num = Number(p.number);
          if (!Number.isFinite(num)) throw new Error("number required");
          data = await getIssue(gql, o, n, num);
          break;
        }
        case "fetch_blame": {
          const path = String(p.path || "");
          const line = Number(p.line);
          if (!path || !Number.isFinite(line)) throw new Error("path and line required");
          const branch = typeof p.ref === "string" ? p.ref : undefined;
          data = await getBlameForLine(gql, o, n, branch || "HEAD", path, line);
          break;
        }
        case "fetch_repo_stats": {
          data = await enrichRepositoryOverview(accessToken, o, n);
          break;
        }
        case "fetch_file_content": {
          const path = String(p.path || p.file || "");
          const r = typeof p.ref === "string" ? p.ref : "";
          if (!path) throw new Error("path required");
          data = await getRepoFileContent(accessToken, o, n, path, r || "HEAD");
          break;
        }
        case "generate_embedding": {
          const t = String(p.text || "").slice(0, 8000);
          const emb = await getEmbedding(t, "query");
          data = { dimensions: emb?.length || 0, preview: t.slice(0, 120) };
          break;
        }
        case "generate_narrative": {
          data = { deferred: true };
          break;
        }
        case "generate_voice": {
          data = { message: "Voice narration is available from the Story Voice control in the UI." };
          break;
        }
        case "ingest_repo": {
          const limit = Math.min(50, Math.max(5, Number(p.limit) || 15));
          const progress = await ingestRepo(accessToken, o, n, limit);
          markIngestExecuted(userId);
          data = { status: progress.status, processed: progress.processed, total: progress.total };
          break;
        }
        default:
          data = { error: `Unhandled tool ${s.tool}` };
      }
      toolResults.push({ step: s.step, tool: s.tool, ok: true, data });
    } catch (err) {
      toolResults.push({
        step: s.step,
        tool: s.tool,
        ok: false,
        data: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  const CONTEXT_CHAR_CAP = 34000;
  const buildCtx = (nodes: ScoredNode[]) =>
    nodes.map((x) => buildContextBlock(x.doc)).join("\n\n");
  let context = buildCtx(usedNodes);
  if (context.length > CONTEXT_CHAR_CAP) {
    usedNodes = usedNodes.slice(0, 8);
    context = buildCtx(usedNodes);
  }

  const toolJson = JSON.stringify(toolResults, null, 2).slice(0, 12000);

  const synthPrompt = `You are GitLore. Answer the user's question using ONLY:
(1) Knowledge node excerpts below, and/or
(2) The tool execution JSON (PR/issue/blame/file reads) below.

Do not invent URLs or PR numbers. If a tool was blocked, mention that GitLore refused unsafe actions (ArmorClaw).

Knowledge nodes (may be empty if search returned nothing):
${context || "(none)"}

Tool results JSON:
${toolJson}

User question:
${question}

Write a clear, structured answer in markdown-friendly plain text.`;

  const ai = getGoogleGenAI();
  const synthRes = await withGemini429Retry(() =>
    ai.models.generateContent({
      model: GEMINI_GENERATION_MODEL,
      contents: synthPrompt,
      config: { temperature: 0.35, maxOutputTokens: 4096 },
    })
  );
  let answer = synthRes.text || "Unable to synthesize an answer.";
  answer += ingestNote;

  const sources = usedNodes.map((x) => ({
    pr_number: x.doc.pr_number as number,
    pr_url: String(x.doc.pr_url || ""),
    title: String(x.doc.title || ""),
    type: String(x.doc.type || "other"),
    score: Math.round(x.score * 1000) / 1000,
  }));

  return {
    answer,
    sources,
    searchTier: searchTier,
    nodesSearched: usedNodes.length,
    nodesUsed: usedNodes.length,
    geminiConfigured: true,
    synthesis: "gemini" as const,
    model: geminiModel,
    armorAgent: true,
    enforcementLog: enforcementSummary,
    planIntent: plan.intent || "answer_user_question",
  };
}
