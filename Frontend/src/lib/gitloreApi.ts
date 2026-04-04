/**
 * GitLore backend — same-origin in dev via Vite proxy (/api, /auth).
 */

export interface MeResponse {
  username: string;
  avatar_url: string;
  github_id: string;
}

export interface InsightNarrative {
  oneLiner: string;
  context: string;
  timeline: Array<{ color: string; label: string; sublabel: string; date: string }>;
  debate: string;
  debateQuotes: Array<{
    author: string;
    text: string;
    sourceType: string;
    url: string;
  }>;
  decision: string;
  impact: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  confidenceReason: string;
  sources: {
    prUrl?: string;
    issueUrls: string[];
    dataSignals: string[];
  };
}

export interface InsightExplanation {
  header: string;
  buggyCode: string;
  fixedCode: string;
  why: string;
  principle: string;
  link: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

const TIMELINE_COLORS = ["#E74C3C", "#C9A84C", "#F39C12", "#2ECC71"];

function confUpper(s: string | undefined): "HIGH" | "MEDIUM" | "LOW" {
  const c = (s || "low").toLowerCase();
  if (c === "high") return "HIGH";
  if (c === "medium") return "MEDIUM";
  return "LOW";
}

function trunc(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

export function narrativeFromAnalyzeApi(raw: Record<string, unknown>): InsightNarrative {
  const one =
    (raw.one_liner as string) ||
    (raw.oneLiner as string) ||
    "No summary available.";
  const context = (raw.context as string) || "";
  const debate = (raw.debate as string) || "";
  const decision = (raw.decision as string) || "";
  const impact = (raw.impact as string) || "";
  const confidenceReason = (raw.confidence_reason as string) || "";

  // ── Parse debate_quotes ────────────────────────────────────────────────
  const rawQuotes = raw.debate_quotes as Array<Record<string, unknown>> | undefined;
  const debateQuotes = (rawQuotes || [])
    .filter((q) => q.text && typeof q.text === "string" && (q.text as string).trim())
    .map((q) => ({
      author: (q.author as string) || "unknown",
      text: (q.text as string),
      sourceType: (q.source_type as string) || "unknown",
      url: (q.url as string) || "",
    }));

  // ── Parse sources ──────────────────────────────────────────────────────
  const rawSources = raw.sources as Record<string, unknown> | undefined;
  const sources = {
    prUrl: (rawSources?.pr_url as string) || undefined,
    issueUrls: (rawSources?.issue_urls as string[]) || [],
    dataSignals: (rawSources?.data_signals as string[]) || [],
  };

  // ── Parse timeline ─────────────────────────────────────────────────────
  const rawTimeline = raw.timeline as Array<Record<string, unknown>> | undefined;
  const timeline =
    rawTimeline?.map((item, i) => {
      const type = item.type as string;
      const color = TIMELINE_COLORS[i % TIMELINE_COLORS.length];
      if (type === "commit") {
        const msg = (item.message as string) || "";
        const author = (item.author as string) || "";
        const date = (item.date as string) || "";
        return {
          color,
          label: trunc(msg, 28) || "Commit",
          sublabel: author || (item.sha as string)?.slice(0, 7) || "",
          date: date ? new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "",
        };
      }
      if (type === "pr") {
        const num = item.number as number;
        const title = (item.title as string) || "";
        const date = (item.date as string) || "";
        return {
          color,
          label: `PR #${num}`,
          sublabel: trunc(title, 36),
          date: typeof date === "string" && date !== "open" ? new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : (date === "open" ? "open" : ""),
        };
      }
      if (type === "issue") {
        const num = item.number as number;
        const title = (item.title as string) || "Issue";
        const date = (item.date as string) || "";
        return {
          color,
          label: num ? `Issue #${num}` : trunc(title, 28),
          sublabel: num ? trunc(title, 36) : "Issue",
          date: date ? new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "",
        };
      }
      return {
        color,
        label: "Event",
        sublabel: type || "",
        date: "",
      };
    }) ?? [];

  if (!timeline.length) {
    timeline.push({
      color: TIMELINE_COLORS[0],
      label: "Blame / commit",
      sublabel: "Open Git history for details",
      date: "",
    });
  }

  return {
    oneLiner: one,
    context,
    timeline,
    debate,
    debateQuotes,
    decision,
    impact,
    confidence: confUpper(raw.confidence as string),
    confidenceReason,
    sources,
  };
}

export function explanationFromApi(raw: Record<string, unknown>): InsightExplanation {
  const pattern = (raw.pattern_name as string) || "Review note";
  const whatsWrong = (raw.whats_wrong as string) || "";
  const fix = (raw.fix as string) || "";
  const why = (raw.why_it_matters as string) || "";
  const principle = (raw.principle as string) || "";
  const docs = raw.docs_links as string[] | undefined;
  const linkFromDocs = Array.isArray(docs) && docs[0] ? String(docs[0]).replace(/^https?:\/\//, "") : "";

  return {
    header: pattern,
    buggyCode: whatsWrong || "(no snippet)",
    fixedCode: fix || "(no fix suggested)",
    why,
    principle: principle || "Code review",
    link: linkFromDocs || "developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch",
    confidence: confUpper(raw.confidence as string),
  };
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers as Record<string, string>),
    },
  });
}

export async function getMe(): Promise<MeResponse | null> {
  const res = await apiFetch("/auth/me");
  if (res.status === 401) return null;
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json() as Promise<MeResponse>;
}

export async function logout(): Promise<void> {
  const res = await apiFetch("/auth/logout", { method: "POST" });
  if (!res.ok) throw new Error("Logout failed");
}

export async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, { method: "POST", body: JSON.stringify(body) });
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    // Prefer `message` when both exist (e.g. analyze 500: error title + actionable message).
    const msg =
      (data.message as string) || (data.error as string) || res.statusText;
    throw new Error(msg);
  }
  return data as T;
}

export async function analyzeLine(body: {
  repo: string;
  file_path: string;
  line_number: number;
  branch: string;
}): Promise<InsightNarrative> {
  const raw = await postJSON<Record<string, unknown>>("/api/analyze", body);
  return narrativeFromAnalyzeApi(raw);
}

export async function explainComment(body: {
  comment: string;
  diff_hunk: string;
  file_path: string;
  line: number;
  repo: string;
  pr_number: number;
}): Promise<InsightExplanation> {
  const raw = await postJSON<Record<string, unknown>>("/api/explain", body);
  return explanationFromApi(raw);
}

export interface SearchResultItem {
  text: string;
  score: number;
  source?: string;
  /** Present when returned from commit_cache (line analyze). */
  filePath?: string;
  line?: number;
}

export async function searchDecisions(repo: string, query: string, limit = 5): Promise<SearchResultItem[]> {
  const raw = await postJSON<{
    results: Array<{
      one_liner: string;
      score: number;
      source: string;
      file_path?: string;
      line_number?: number;
    }>;
  }>("/api/search", { repo, query, limit });
  return (raw.results || []).map((r) => ({
    text: r.one_liner || "",
    score: Math.round((r.score || 0) * 100),
    source: r.source,
    filePath: r.file_path,
    line: r.line_number,
  }));
}

export async function validateRepo(owner: string, name: string): Promise<{ found: boolean; url?: string }> {
  const raw = await postJSON<{ found: boolean; repository?: { url: string } }>("/api/repo/search", {
    owner,
    name,
  });
  return { found: !!raw.found, url: raw.repository?.url };
}

export type GithubRepoSummary = {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  pushedAt: string | null;
  htmlUrl: string;
  description?: string | null;
  language?: string | null;
  stars?: number;
};

export async function fetchMyRepos(limit = 30): Promise<GithubRepoSummary[]> {
  const data = await getJSON<{ repositories: GithubRepoSummary[] }>(`/api/repos/me?limit=${limit}`);
  return data.repositories || [];
}

export async function searchGithubRepositories(query: string, perPage = 20): Promise<GithubRepoSummary[]> {
  const q = query.trim();
  if (!q) return [];
  const params = new URLSearchParams({ q, per_page: String(perPage) });
  const data = await getJSON<{ repositories: GithubRepoSummary[] }>(`/api/repos/search?${params}`);
  return data.repositories || [];
}

export type RepoOverviewKnowledgeNode = {
  id: string;
  label: string;
  fullName: string;
  x: number;
  y: number;
  size: number;
  color: string;
  changes: number;
  authors: number;
  floatDuration: number;
};

export type RepoOverviewResponse = {
  id: string;
  name: string;
  description: string | null;
  url: string;
  language?: string | null;
  defaultBranch?: string;
  healthScore: number;
  topAntiPatterns: Array<{ text: string; count: number; dot: string }>;
  mostChangedFiles: Array<{ name: string; changes: number; touches?: number }>;
  knowledgeGraph: {
    nodes: RepoOverviewKnowledgeNode[];
    edges: [string, string][];
  };
  stats: {
    stars: number;
    forks: number;
    commits: number;
    pullRequests: number;
    issues: number;
    files?: number;
    contributors?: number;
  };
};

async function getJSON<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text.trim()) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(
        !res.ok
          ? res.statusText || "Bad response from server"
          : "Server returned invalid JSON"
      );
    }
  }
  if (!res.ok) {
    throw new Error(
      (data.message as string) || (data.error as string) || res.statusText
    );
  }
  return data as T;
}

export { getJSON };

export async function fetchRepoOverview(
  owner: string,
  name: string,
  branch?: string
): Promise<RepoOverviewResponse> {
  const q = branch ? `?branch=${encodeURIComponent(branch)}` : "";
  return getJSON<RepoOverviewResponse>(`/api/repo/${encodeURIComponent(owner)}/${encodeURIComponent(name)}${q}`);
}

export type RepoPatternInsightsResponse = {
  explain: {
    labels: Array<{ text: string; count: number }>;
    rowCount: number;
  };
  knowledgeGraph: {
    prNodeCount: number;
    byType: Array<{ text: string; count: number }>;
    topTopics: Array<{ text: string; count: number }>;
  };
  lineAnalyze: {
    cachedCount: number;
    byConfidence: { high: number; medium: number; low: number };
    topFiles: Array<{ path: string; count: number }>;
  };
};

export async function fetchRepoPatternInsights(
  owner: string,
  name: string
): Promise<RepoPatternInsightsResponse> {
  return getJSON<RepoPatternInsightsResponse>(
    `/api/repo/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pattern-insights`
  );
}

export type GithubUserProfile = {
  login: string;
  name: string | null;
  avatar_url: string;
  public_repos: number;
  followers: number;
  following: number;
  total_private_repos?: number;
};

export async function fetchGithubUserProfile(): Promise<GithubUserProfile> {
  return getJSON<GithubUserProfile>("/api/user/github-profile");
}

export type RepoPullSummary = {
  number: number;
  title: string;
  state: string;
  updatedAt: string;
  htmlUrl: string;
  authorLogin: string | null;
};

export async function fetchRepoPullRequests(
  owner: string,
  name: string,
  limit = 20
): Promise<RepoPullSummary[]> {
  const data = await getJSON<{ pulls: RepoPullSummary[] }>(
    `/api/repo/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls?limit=${limit}`
  );
  return data.pulls || [];
}

export type PullDiffReviewResponse = {
  number: number;
  title: string;
  state: string;
  authorLogin: string | null;
  updatedAt: string;
  htmlUrl: string;
  diff: string;
  comments: Array<{
    id: number;
    path: string;
    line: number | null;
    body: string;
    author: string;
    diff_hunk: string | null;
  }>;
};

export async function fetchPullDiffReview(
  owner: string,
  name: string,
  pullNumber: number
): Promise<PullDiffReviewResponse> {
  return getJSON<PullDiffReviewResponse>(
    `/api/repo/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${pullNumber}/diff-review`
  );
}

/** Ingested PR decision node (no embedding). */
export type KnowledgeGraphNodeDTO = {
  pr_number: number;
  pr_url: string;
  type: string;
  title: string;
  summary: string;
  topics?: string[];
  merged_at?: string;
};

export async function fetchKnowledgeGraphNodes(
  owner: string,
  name: string
): Promise<{ nodes: KnowledgeGraphNodeDTO[]; count: number }> {
  return getJSON(`/api/repo/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/knowledge`);
}

/** Structured layout for the Overview knowledge graph SVG. */
export type KnowledgeLayoutResponse = {
  viewBox: { w: number; h: number };
  nodes: Array<{
    id: string;
    kind: string;
    label: string;
    sublabel?: string;
    x: number;
    y: number;
    r?: number;
    color: string;
    href?: string;
    prType?: string;
  }>;
  edges: Array<{ from: string; to: string; kind: string }>;
};

export async function fetchKnowledgeLayout(
  owner: string,
  name: string
): Promise<KnowledgeLayoutResponse> {
  return getJSON(
    `/api/repo/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/knowledge-layout`
  );
}

/** Backend chat / Gemini readiness (no secrets). */
export type ChatGraphStatusResponse = {
  geminiConfigured: boolean;
  model: string;
};

export async function fetchChatGraphStatus(
  owner: string,
  name: string
): Promise<ChatGraphStatusResponse> {
  return getJSON(
    `/api/repo/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/chat/status`
  );
}

export async function fetchRepoIndex(
  owner: string,
  name: string,
  ref: string,
  limit = 400
): Promise<{
  owner: string;
  name: string;
  defaultBranch: string;
  refUsed: string;
  paths: string[];
  truncated: boolean;
}> {
  const q = new URLSearchParams();
  if (ref) q.set("ref", ref);
  q.set("limit", String(limit));
  return getJSON(`/api/repo/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/index?${q}`);
}

export async function fetchRepoFileRaw(
  owner: string,
  name: string,
  path: string,
  ref: string
): Promise<{ text: string | null; isBinary: boolean; message?: string }> {
  const q = new URLSearchParams({ path });
  if (ref) q.set("ref", ref);
  return getJSON(`/api/repo/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/raw?${q}`);
}

export async function fetchGuardrails(): Promise<{
  allowed: string[];
  blocked: string[];
  user?: { username: string; scope: string };
}> {
  const res = await apiFetch("/api/guardrails");
  if (res.status === 401) {
    return { allowed: [], blocked: [] };
  }
  if (!res.ok) throw new Error("Failed to load guardrails");
  return res.json() as Promise<{ allowed: string[]; blocked: string[]; user?: { username: string; scope: string } }>;
}

export async function testGuardrailAction(action: string): Promise<{
  allowed: boolean;
  reason: string;
  category?: string;
}> {
  return postJSON("/api/guardrails/test", { action });
}

/** ElevenLabs voice — configured on backend; never exposes API key. */
export interface VoiceStatusResponse {
  ttsReady: boolean;
  ttsHindiReady?: boolean;
  agentReady: boolean;
  /** ElevenLabs agent + Gemini for client-tool voice Q&A */
  voiceChatGeminiReady?: boolean;
  /** ConvAI / LiveKit region — must match your ElevenLabs workspace */
  elevenlabsServerLocation?: string;
  ttsModel: string;
  envPresent?: {
    apiKey: boolean;
    voiceId: boolean;
    voiceIdHi?: boolean;
    geminiForHindi?: boolean;
    geminiApi?: boolean;
    agentId: boolean;
  };
}

export type AgentSessionResponse = {
  mode: "webrtc" | "public";
  agentId?: string;
  conversationToken?: string;
  /** Align WebRTC LiveKit host with token API region */
  serverLocation?: "us" | "global" | "eu-residency" | "in-residency";
  note?: string;
};

export async function fetchVoiceStatus(): Promise<VoiceStatusResponse> {
  return getJSON<VoiceStatusResponse>("/api/voice/status");
}

export async function fetchAgentSession(): Promise<AgentSessionResponse> {
  return getJSON<AgentSessionResponse>("/api/voice/agent/session");
}

export async function postGeminiVoiceReply(body: {
  user_question: string;
  context_text: string;
}): Promise<{ answer: string }> {
  return postJSON<{ answer: string }>("/api/voice/gemini-voice-reply", body);
}

export type VoiceTtsResult = { blob: Blob; displayText: string };

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

export async function postVoiceTts(text: string, opts?: { locale?: "en" | "hi" }): Promise<VoiceTtsResult> {
  const res = await apiFetch("/api/voice/tts", {
    method: "POST",
    body: JSON.stringify({ text, locale: opts?.locale ?? "en" }),
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { error?: string; message?: string; hint?: string };
      const parts = [j.error || j.message, j.hint].filter(Boolean);
      msg = parts.length ? parts.join(" — ") : msg;
    } catch {
      try {
        const t = await res.text();
        if (t) msg = t.slice(0, 200);
      } catch {
        /* ignore */
      }
    }
    throw new Error(msg || "TTS failed");
  }
  const data = (await res.json()) as {
    displayText?: string;
    audioBase64?: string;
    mimeType?: string;
  };
  if (!data.audioBase64 || typeof data.displayText !== "string") {
    throw new Error("Invalid TTS response from server");
  }
  return {
    blob: base64ToBlob(data.audioBase64, data.mimeType || "audio/mpeg"),
    displayText: data.displayText,
  };
}
