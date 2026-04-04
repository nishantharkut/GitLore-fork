/**
 * GitHub REST API helpers (GraphQL client lives in github.ts).
 */

const GH_API = "https://api.github.com";

/** Encoded /repos/{owner}/{repo} root for API paths. */
export function githubRepoApiRoot(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export class GithubRestError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "GithubRestError";
  }
}

export async function githubRestJson<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${GH_API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new GithubRestError(res.status, text.slice(0, 500));
  }
  return JSON.parse(text) as T;
}

export async function githubRestJsonMethod<T>(
  token: string,
  method: "POST" | "PUT" | "PATCH",
  path: string,
  body: unknown
): Promise<T> {
  const res = await fetch(`${GH_API}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new GithubRestError(res.status, text.slice(0, 500));
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function githubRestText(
  token: string,
  path: string,
  accept = "application/vnd.github.diff"
): Promise<string> {
  const res = await fetch(`${GH_API}${path}`, {
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new GithubRestError(res.status, text.slice(0, 500));
  }
  return text;
}

export type GithubUserRest = {
  login: string;
  name: string | null;
  avatar_url: string;
  public_repos: number;
  followers: number;
  following: number;
  total_private_repos?: number;
};

export async function fetchGithubUserRest(token: string): Promise<GithubUserRest> {
  return githubRestJson<GithubUserRest>(token, "/user");
}

export type PullRequestListItem = {
  number: number;
  title: string;
  state: string;
  updated_at: string;
  html_url: string;
  user: { login: string } | null;
};

export async function listPullRequestsRest(
  token: string,
  owner: string,
  repo: string,
  limit: number
): Promise<PullRequestListItem[]> {
  const n = Math.min(Math.max(limit, 1), 30);
  return githubRestJson<PullRequestListItem[]>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=all&sort=updated&direction=desc&per_page=${n}`
  );
}

export type PullReviewCommentRest = {
  id: number;
  path: string;
  line: number | null;
  body: string;
  user: { login: string } | null;
  diff_hunk: string | null;
};

export async function listPullRequestReviewCommentsRest(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<PullReviewCommentRest[]> {
  return githubRestJson<PullReviewCommentRest[]>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/comments?per_page=100`
  );
}

export type PullRequestFileRest = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
};

export async function listPullRequestFilesRest(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<PullRequestFileRest[]> {
  return githubRestJson<PullRequestFileRest[]>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/files?per_page=100`
  );
}

export async function getPullRequestDiffRest(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<string> {
  return githubRestText(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}`,
    "application/vnd.github.diff"
  );
}

export type PullRequestRefRest = {
  ref: string;
  sha: string;
};

export type PullRequestDetailRest = {
  number: number;
  title: string;
  state: string;
  user: { login: string } | null;
  updated_at: string;
  html_url: string;
  head: PullRequestRefRest;
  base: PullRequestRefRest;
};

export async function getPullRequestRest(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<PullRequestDetailRest> {
  return githubRestJson<PullRequestDetailRest>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}`
  );
}

export type OverviewFileChange = { name: string; changes: number; touches: number };

export type KnowledgeGraphNode = {
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

export type RepoOverviewEnrichment = {
  defaultBranch: string;
  fileCount: number;
  contributorCount: number;
  mostChangedFiles: OverviewFileChange[];
  knowledgeGraph: {
    nodes: KnowledgeGraphNode[];
    edges: [string, string][];
  };
};

const GRAPH_COLORS = ["#F87171", "#FBBF24", "#34D399", "#60A5FA", "#A78BFA", "#F472B6"];

function layoutGraphNodes(files: OverviewFileChange[]): {
  nodes: KnowledgeGraphNode[];
  edges: [string, string][];
} {
  const top = files.slice(0, 12);
  if (!top.length) {
    return { nodes: [], edges: [] };
  }
  const nodes: KnowledgeGraphNode[] = top.map((f, i) => {
    const angle = (2 * Math.PI * i) / top.length;
    const x = Math.round(50 + 38 * Math.cos(angle));
    const y = Math.round(50 + 38 * Math.sin(angle));
    const base = f.name.includes("/") ? f.name.split("/").pop()! : f.name;
    const short =
      base.length > 14 ? `${base.slice(0, 12)}…` : base;
    const maxCh = Math.max(...top.map((t) => t.changes), 1);
    const size = 22 + Math.round((f.changes / maxCh) * 28);
    const authors = Math.min(12, 1 + (f.touches % 6) + Math.floor(f.touches / 3));
    return {
      id: `n${i}`,
      label: short,
      fullName: f.name,
      x,
      y,
      size,
      color: GRAPH_COLORS[i % GRAPH_COLORS.length],
      changes: f.changes,
      authors,
      floatDuration: 3 + (i % 3) * 0.35,
    };
  });
  const edges: [string, string][] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push([nodes[i].id, nodes[i + 1].id]);
  }
  if (nodes.length > 2) {
    edges.push([nodes[nodes.length - 1].id, nodes[0].id]);
  }
  return { nodes, edges };
}

/**
 * File churn from recent commits + counts + graph layout + default branch metadata.
 */
export type GithubRepoMetadataRest = {
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  private: boolean;
  default_branch: string;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  owner: { login: string; type?: string };
};

export async function fetchRepositoryMetadataRest(
  token: string,
  owner: string,
  repo: string
): Promise<GithubRepoMetadataRest> {
  return githubRestJson<GithubRepoMetadataRest>(token, githubRepoApiRoot(owner, repo));
}

/** GitHub Search API: total PRs or issues for a repo. */
export async function searchRepoCountRest(
  token: string,
  owner: string,
  repo: string,
  filter: "pr" | "issue"
): Promise<number> {
  const q = encodeURIComponent(`repo:${owner}/${repo} is:${filter}`);
  const data = await githubRestJson<{ total_count: number }>(
    token,
    `/search/issues?q=${q}&per_page=1`
  );
  return typeof data.total_count === "number" ? data.total_count : 0;
}

/** Approximate commit count on a branch via the commits list Link header. */
export async function countCommitsApproxRest(
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<number> {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  } as const;
  const root = `${GH_API}${githubRepoApiRoot(owner, repo)}`;
  const u = `${root}/commits?sha=${encodeURIComponent(branch)}&per_page=100`;
  const res = await fetch(u, { headers });
  if (!res.ok) return 0;
  const link = res.headers.get("Link");
  const first = (await res.json()) as unknown[];
  const n0 = Array.isArray(first) ? first.length : 0;
  if (!link?.includes('rel="last"')) return n0;
  const m = link.match(/page=(\d+)>; rel="last"/);
  if (!m) return n0;
  const lastPage = parseInt(m[1], 10);
  if (lastPage <= 1) return n0;
  const lastRes = await fetch(`${u}&page=${lastPage}`, { headers });
  if (!lastRes.ok) return (lastPage - 1) * 100 + n0;
  const lastItems = (await lastRes.json()) as unknown[];
  const nLast = Array.isArray(lastItems) ? lastItems.length : 0;
  return (lastPage - 1) * 100 + nLast;
}

export async function enrichRepositoryOverview(
  token: string,
  owner: string,
  repo: string,
  preferredBranch?: string
): Promise<RepoOverviewEnrichment> {
  const root = githubRepoApiRoot(owner, repo);
  const meta = await githubRestJson<{ default_branch: string }>(token, root);
  const branch = preferredBranch?.trim() || meta.default_branch;

  let contributorCount = 0;
  try {
    const contribs = await githubRestJson<unknown[]>(
      token,
      `${root}/contributors?per_page=100&anon=false`
    );
    contributorCount = Array.isArray(contribs) ? contribs.length : 0;
  } catch {
    contributorCount = 0;
  }

  const fileTouches = new Map<string, { touches: number; changes: number }>();
  try {
    const commits = await githubRestJson<Array<{ sha: string }>>(
      token,
      `${root}/commits?sha=${encodeURIComponent(branch)}&per_page=15`
    );
    const batchSize = 5;
    for (let i = 0; i < commits.length; i += batchSize) {
      const batch = commits.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (c) => {
          try {
            const detail = await githubRestJson<{
              files?: Array<{ filename: string; changes?: number }>;
            }>(token, `${root}/commits/${c.sha}`);
            for (const f of detail.files || []) {
              const cur = fileTouches.get(f.filename) || { touches: 0, changes: 0 };
              cur.touches += 1;
              cur.changes += f.changes ?? 0;
              fileTouches.set(f.filename, cur);
            }
          } catch {
            /* ignore single commit */
          }
        })
      );
    }
  } catch {
    /* no commit access */
  }

  const mostChangedFiles: OverviewFileChange[] = [...fileTouches.entries()]
    .map(([name, v]) => ({ name, changes: v.changes, touches: v.touches }))
    .sort((a, b) => b.changes - a.changes)
    .slice(0, 20);

  let fileCount = 0;
  try {
    const br = await githubRestJson<{ commit: { sha: string } }>(
      token,
      `${root}/branches/${encodeURIComponent(branch)}`
    );
    const commitDetail = await githubRestJson<{ tree: { sha: string } }>(
      token,
      `${root}/git/commits/${br.commit.sha}`
    );
    const tree = await githubRestJson<{ tree: Array<{ type: string }>; truncated: boolean }>(
      token,
      `${root}/git/trees/${commitDetail.tree.sha}?recursive=1`
    );
    fileCount = tree.tree.filter((t) => t.type === "blob").length;
  } catch {
    fileCount = 0;
  }

  const { nodes, edges } = layoutGraphNodes(mostChangedFiles);

  return {
    defaultBranch: branch,
    fileCount,
    contributorCount,
    mostChangedFiles,
    knowledgeGraph: { nodes, edges },
  };
}

export async function listRepoPathsLimited(
  token: string,
  owner: string,
  repo: string,
  ref: string,
  maxFiles: number
): Promise<{ paths: string[]; truncated: boolean; defaultBranch: string }> {
  const root = githubRepoApiRoot(owner, repo);
  const meta = await githubRestJson<{ default_branch: string }>(token, root);
  const branch = ref.trim() || meta.default_branch;

  const br = await githubRestJson<{ commit: { sha: string } }>(
    token,
    `${root}/branches/${encodeURIComponent(branch)}`
  );
  const commitDetail = await githubRestJson<{ tree: { sha: string } }>(
    token,
    `${root}/git/commits/${br.commit.sha}`
  );
  const tree = await githubRestJson<{ tree: Array<{ type: string; path?: string }>; truncated: boolean }>(
    token,
    `${root}/git/trees/${commitDetail.tree.sha}?recursive=1`
  );
  const blobs = tree.tree
    .filter((t) => t.type === "blob" && t.path)
    .map((t) => t.path!)
    .filter((p) => !p.includes("/.git"))
    .sort();
  const truncated = tree.truncated || blobs.length > maxFiles;
  return {
    paths: blobs.slice(0, maxFiles),
    truncated,
    defaultBranch: branch,
  };
}

export async function getRepoFileContent(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
  ref: string
): Promise<{ text: string | null; isBinary: boolean; size: number }> {
  const path = filePath.replace(/^\//, "");
  const q = new URLSearchParams();
  if (ref) q.set("ref", ref);
  const encPath = encodeURIComponent(path);
  const data = await githubRestJson<{
    content?: string;
    encoding?: string;
    size?: number;
    message?: string;
  }>(token, `${githubRepoApiRoot(owner, repo)}/contents/${encPath}?${q}`);

  if (data.encoding === "base64" && data.content) {
    const raw = Buffer.from(data.content.replace(/\n/g, ""), "base64");
    const NUL = raw.indexOf(0);
    if (NUL !== -1) {
      return { text: null, isBinary: true, size: data.size ?? raw.length };
    }
    return {
      text: raw.toString("utf8"),
      isBinary: false,
      size: data.size ?? raw.length,
    };
  }

  return { text: null, isBinary: true, size: data.size ?? 0 };
}

/** Contents API blob: includes `sha` required for PUT updates. */
export async function getRepoFileBlobAtRef(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
  ref: string
): Promise<{ text: string | null; sha: string | null; isBinary: boolean; size: number }> {
  const path = filePath.replace(/^\//, "");
  const q = new URLSearchParams();
  if (ref) q.set("ref", ref);
  const encPath = path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  const data = await githubRestJson<{
    content?: string;
    encoding?: string;
    size?: number;
    sha?: string;
    message?: string;
  }>(token, `${githubRepoApiRoot(owner, repo)}/contents/${encPath}?${q}`);

  const sha = typeof data.sha === "string" ? data.sha : null;
  if (data.encoding === "base64" && data.content) {
    const raw = Buffer.from(data.content.replace(/\n/g, ""), "base64");
    const NUL = raw.indexOf(0);
    if (NUL !== -1) {
      return { text: null, sha, isBinary: true, size: data.size ?? raw.length };
    }
    return {
      text: raw.toString("utf8"),
      sha,
      isBinary: false,
      size: data.size ?? raw.length,
    };
  }

  return { text: null, sha, isBinary: true, size: data.size ?? 0 };
}

/** Create a branch ref pointing at `sha` (commit SHA). */
export async function createGitRef(
  token: string,
  owner: string,
  repo: string,
  refName: string,
  sha: string
): Promise<{ ref: string; url: string }> {
  const ref = refName.startsWith("refs/") ? refName : `refs/heads/${refName}`;
  return githubRestJsonMethod<{ ref: string; url: string }>(
    token,
    "POST",
    `${githubRepoApiRoot(owner, repo)}/git/refs`,
    { ref, sha }
  );
}

/**
 * Point an existing ref at `sha`. Use `force: true` to reset a branch (e.g. re-run auto-fix from current PR head).
 * `refName`: short branch name or `refs/heads/...`.
 */
export async function updateGitRef(
  token: string,
  owner: string,
  repo: string,
  refName: string,
  sha: string,
  force = false
): Promise<{ ref: string; url: string }> {
  const branchShort = refName.startsWith("refs/heads/")
    ? refName.slice("refs/heads/".length)
    : refName.startsWith("refs/")
      ? refName.replace(/^refs\/heads\//, "")
      : refName;
  const refPath = encodeURIComponent(`heads/${branchShort}`);
  return githubRestJsonMethod<{ ref: string; url: string }>(
    token,
    "PATCH",
    `${githubRepoApiRoot(owner, repo)}/git/refs/${refPath}`,
    { sha, force }
  );
}

/** Update a file on a branch (creates a commit). */
export async function updateRepoFileContents(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
  branch: string,
  message: string,
  newUtf8Content: string,
  fileSha: string
): Promise<{ commit: { sha: string }; content: { sha: string } }> {
  const path = filePath.replace(/^\//, "");
  const encPath = path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  const content = Buffer.from(newUtf8Content, "utf8").toString("base64");
  return githubRestJsonMethod(
    token,
    "PUT",
    `${githubRepoApiRoot(owner, repo)}/contents/${encPath}`,
    {
      message,
      content,
      sha: fileSha,
      branch,
    }
  );
}

export type CreatedPullRest = {
  number: number;
  html_url: string;
  title: string;
  draft: boolean;
};

/** Open a pull request (use draft: true for auto-fix flow). */
export async function createPullRequestRest(
  token: string,
  owner: string,
  repo: string,
  body: {
    title: string;
    body: string;
    head: string;
    base: string;
    draft?: boolean;
  }
): Promise<CreatedPullRest> {
  return githubRestJsonMethod<CreatedPullRest>(
    token,
    "POST",
    `${githubRepoApiRoot(owner, repo)}/pulls`,
    {
      title: body.title,
      body: body.body,
      head: body.head,
      base: body.base,
      draft: body.draft ?? false,
    }
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Match explanations for owner/name regardless of `owner/name` string casing. */
export async function aggregatePatternCounts(
  db: import("mongodb").Db,
  owner: string,
  repoName: string
): Promise<Array<{ text: string; count: number }>> {
  const pattern = new RegExp(`^${escapeRegex(owner)}/${escapeRegex(repoName)}$`, "i");
  const docs = await db
    .collection("explanations_cache")
    .find({ repo: pattern })
    .limit(300)
    .toArray();

  const counts = new Map<string, number>();
  for (const doc of docs) {
    const exp = (doc as any).explanation;
    const name =
      (typeof exp?.pattern_name === "string" && exp.pattern_name) ||
      (typeof (doc as any).pattern_matched === "string" && (doc as any).pattern_matched);
    if (name) {
      const key = name.trim();
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

export type ChurnHotspot = {
  file: string;
  prCount: number;
  types: string[];
  prs: Array<{ number: number; type: string; title: string }>;
};

export type DecisionOscillation = {
  earlier: { pr_number: number; title: string; decision: string };
  later: { pr_number: number; title: string; decision: string };
  sharedTerms: string[];
};

export type DecisionTimelineMonth = {
  month: string;
  count: number;
  types: Record<string, number>;
};

/** Repo-scoped pattern / theme insights for the Patterns UI (Mongo only, not cached with repo overview). */
export type RepoPatternInsights = {
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
  churnHotspots: ChurnHotspot[];
  decisionOscillations: DecisionOscillation[];
  decisionTimeline: DecisionTimelineMonth[];
};

export async function aggregateRepoPatternInsights(
  db: import("mongodb").Db,
  owner: string,
  repoName: string
): Promise<RepoPatternInsights> {
  const repoRe = new RegExp(`^${escapeRegex(owner)}/${escapeRegex(repoName)}$`, "i");

  const explainDocs = await db
    .collection("explanations_cache")
    .find({ repo: repoRe })
    .limit(500)
    .toArray();
  const explainMap = new Map<string, number>();
  for (const doc of explainDocs) {
    const exp = (doc as any).explanation;
    const name =
      (typeof exp?.pattern_name === "string" && exp.pattern_name.trim()) ||
      (typeof (doc as any).pattern_matched === "string" && String((doc as any).pattern_matched).trim());
    if (name) {
      const key = String(name).trim();
      explainMap.set(key, (explainMap.get(key) || 0) + 1);
    }
  }
  const labels = [...explainMap.entries()]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const prNodeCount = await db.collection("knowledge_nodes").countDocuments({ repo: repoRe });

  const byTypeRaw = await db
    .collection("knowledge_nodes")
    .aggregate([
      { $match: { repo: repoRe } },
      { $group: { _id: "$type", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();
  const byType = byTypeRaw
    .filter((x) => x._id != null && String(x._id).trim() !== "")
    .map((x) => ({ text: String(x._id), count: x.count as number }));

  const topicsRaw = await db
    .collection("knowledge_nodes")
    .aggregate([
      { $match: { repo: repoRe, topics: { $exists: true, $type: "array", $ne: [] } } },
      { $unwind: "$topics" },
      { $match: { topics: { $type: "string", $ne: "" } } },
      { $group: { _id: { $toLower: "$topics" }, count: { $sum: 1 } } },
      { $match: { _id: { $ne: "" } } },
      { $sort: { count: -1 } },
      { $limit: 28 },
    ])
    .toArray();
  const topTopics = topicsRaw.map((x) => ({
    text: String(x._id),
    count: x.count as number,
  }));

  const commitDocs = await db
    .collection("commit_cache")
    .find({ repo: repoRe })
    .limit(800)
    .toArray();
  const fileMap = new Map<string, number>();
  let high = 0;
  let medium = 0;
  let low = 0;
  for (const doc of commitDocs) {
    const fp = (doc as any).file_path;
    if (typeof fp === "string" && fp.trim()) {
      fileMap.set(fp, (fileMap.get(fp) || 0) + 1);
    }
    const c = String((doc as any).narrative?.confidence ?? "").toLowerCase();
    if (c === "high") high++;
    else if (c === "medium") medium++;
    else low++;
  }
  const topFiles = [...fileMap.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  let churnHotspots: ChurnHotspot[] = [];
  try {
    const churnRaw = await db
      .collection("knowledge_nodes")
      .aggregate([
        { $match: { repo: repoRe, changed_files: { $exists: true, $type: "array", $ne: [] } } },
        { $unwind: "$changed_files" },
        { $match: { changed_files: { $type: "string", $ne: "" } } },
        {
          $group: {
            _id: "$changed_files",
            prCount: { $sum: 1 },
            types: { $addToSet: "$type" },
            prs: { $push: { number: "$pr_number", type: "$type", title: "$title" } },
          },
        },
        { $match: { prCount: { $gte: 2 } } },
        { $sort: { prCount: -1 } },
        { $limit: 10 },
      ])
      .toArray();
    churnHotspots = churnRaw.map((x) => ({
      file: String(x._id),
      prCount: x.prCount as number,
      types: (x.types as string[]).filter(Boolean).map(String),
      prs: ((x.prs as Array<{ number?: number; type?: string; title?: string }>) || []).map((p) => ({
        number: Number(p.number) || 0,
        type: String(p.type || "other"),
        title: String(p.title || "").slice(0, 200),
      })),
    }));
  } catch {
    churnHotspots = [];
  }

  const kgNodes = await db
    .collection("knowledge_nodes")
    .find({ repo: repoRe })
    .project({
      pr_number: 1,
      title: 1,
      decision: 1,
      alternatives: 1,
      merged_at: 1,
      type: 1,
    })
    .limit(80)
    .toArray();

  const decisionTimelineMap = new Map<string, { count: number; types: Record<string, number> }>();
  for (const n of kgNodes) {
    const raw = (n as any).merged_at;
    const d = raw ? new Date(raw) : null;
    if (!d || Number.isNaN(d.getTime())) continue;
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const ty = String((n as any).type || "other");
    const cur = decisionTimelineMap.get(month) || { count: 0, types: {} };
    cur.count++;
    cur.types[ty] = (cur.types[ty] || 0) + 1;
    decisionTimelineMap.set(month, cur);
  }
  const decisionTimeline: DecisionTimelineMonth[] = [...decisionTimelineMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, count: v.count, types: v.types }));

  const decisionOscillations: DecisionOscillation[] = [];
  const seenPair = new Set<string>();
  const wordRe = /\w+/g;
  for (let i = 0; i < kgNodes.length; i++) {
    for (let j = 0; j < kgNodes.length; j++) {
      if (i === j) continue;
      const a = kgNodes[i] as any;
      const b = kgNodes[j] as any;
      const ta = a.merged_at ? new Date(a.merged_at).getTime() : 0;
      const tb = b.merged_at ? new Date(b.merged_at).getTime() : 0;
      if (!(ta && tb && ta < tb)) continue;
      const alts: string[] = Array.isArray(a.alternatives) ? a.alternatives.map(String) : [];
      const decisionB = String(b.decision || "");
      if (!alts.length || !decisionB.trim()) continue;
      const shared = new Set<string>();
      for (const alt of alts) {
        const words = alt.toLowerCase().match(wordRe) || [];
        for (const w of words) {
          if (w.length <= 5) continue;
          if (decisionB.toLowerCase().includes(w)) shared.add(w);
        }
      }
      if (shared.size === 0) continue;
      const key = `${a.pr_number}-${b.pr_number}`;
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      decisionOscillations.push({
        earlier: {
          pr_number: Number(a.pr_number),
          title: String(a.title || "").slice(0, 160),
          decision: String(a.decision || "").slice(0, 400),
        },
        later: {
          pr_number: Number(b.pr_number),
          title: String(b.title || "").slice(0, 160),
          decision: String(b.decision || "").slice(0, 400),
        },
        sharedTerms: [...shared].slice(0, 10),
      });
      if (decisionOscillations.length >= 10) break;
    }
    if (decisionOscillations.length >= 10) break;
  }

  return {
    explain: { labels, rowCount: explainDocs.length },
    knowledgeGraph: { prNodeCount, byType, topTopics },
    lineAnalyze: {
      cachedCount: commitDocs.length,
      byConfidence: { high, medium, low },
      topFiles,
    },
    churnHotspots,
    decisionOscillations,
    decisionTimeline,
  };
}

/** GitHub `GET /user/repos` and search `items[]` shape (subset). */
type GithubRepoListItemRaw = {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch?: string;
  private: boolean;
  pushed_at: string | null;
  html_url: string;
  description?: string | null;
  language?: string | null;
  stargazers_count?: number;
};

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

function mapRepoItem(item: GithubRepoListItemRaw): GithubRepoSummary {
  return {
    owner: item.owner.login,
    name: item.name,
    fullName: item.full_name,
    defaultBranch: item.default_branch || "main",
    private: item.private,
    pushedAt: item.pushed_at,
    htmlUrl: item.html_url,
    description: item.description ?? null,
    language: item.language ?? null,
    stars: typeof item.stargazers_count === "number" ? item.stargazers_count : undefined,
  };
}

/**
 * Repositories the token can access, most recently pushed first.
 */
export async function listAuthenticatedUserRepos(
  token: string,
  limit = 30
): Promise<GithubRepoSummary[]> {
  const perPage = Math.min(Math.max(limit, 1), 100);
  const raw = await githubRestJson<GithubRepoListItemRaw[]>(
    token,
    `/user/repos?sort=updated&per_page=${perPage}&affiliation=owner,collaborator,organization_member`
  );
  return raw.map(mapRepoItem);
}

/**
 * GitHub repository search (uses `/search/repositories`).
 */
export async function searchRepositoriesRest(
  token: string,
  query: string,
  perPage = 20
): Promise<GithubRepoSummary[]> {
  const q = query.trim();
  if (!q) return [];
  const n = Math.min(Math.max(perPage, 1), 30);
  const path = `/search/repositories?q=${encodeURIComponent(q)}&per_page=${n}`;
  const data = await githubRestJson<{ items: GithubRepoListItemRaw[] }>(token, path);
  return (data.items || []).map(mapRepoItem);
}
