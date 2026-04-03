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
  timeline: Array<{ color: string; label: string; sublabel: string; date: string }>;
  debate: string;
  impact: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
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
  const debate = (raw.debate as string) || (raw.context as string) || "";
  const impact = (raw.impact as string) || (raw.decision as string) || "";
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
        const title = (item.title as string) || "Issue";
        const date = (item.date as string) || "";
        return {
          color,
          label: trunc(title, 28),
          sublabel: "Issue",
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
    timeline,
    debate,
    impact,
    confidence: confUpper(raw.confidence as string),
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
    const msg = (data.error as string) || (data.message as string) || res.statusText;
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
}

export async function searchDecisions(repo: string, query: string, limit = 5): Promise<SearchResultItem[]> {
  const raw = await postJSON<{ results: Array<{ one_liner: string; score: number; source: string }> }>(
    "/api/search",
    { repo, query, limit }
  );
  return (raw.results || []).map((r) => ({
    text: r.one_liner || "",
    score: Math.round((r.score || 0) * 100),
    source: r.source,
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
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error((data.error as string) || (data.message as string) || res.statusText);
  }
  return data as T;
}

export async function fetchRepoOverview(
  owner: string,
  name: string,
  branch?: string
): Promise<RepoOverviewResponse> {
  const q = branch ? `?branch=${encodeURIComponent(branch)}` : "";
  return getJSON<RepoOverviewResponse>(`/api/repo/${encodeURIComponent(owner)}/${encodeURIComponent(name)}${q}`);
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
