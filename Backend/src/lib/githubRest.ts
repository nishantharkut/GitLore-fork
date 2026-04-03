/**
 * GitHub REST API helpers (GraphQL client lives in github.ts).
 */

const GH_API = "https://api.github.com";

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
export async function enrichRepositoryOverview(
  token: string,
  owner: string,
  repo: string,
  preferredBranch?: string
): Promise<RepoOverviewEnrichment> {
  const meta = await githubRestJson<{ default_branch: string }>(
    token,
    `/repos/${owner}/${repo}`
  );
  const branch = preferredBranch?.trim() || meta.default_branch;

  let contributorCount = 0;
  try {
    const contribs = await githubRestJson<unknown[]>(
      token,
      `/repos/${owner}/${repo}/contributors?per_page=100&anon=false`
    );
    contributorCount = Array.isArray(contribs) ? contribs.length : 0;
  } catch {
    contributorCount = 0;
  }

  const fileTouches = new Map<string, { touches: number; changes: number }>();
  try {
    const commits = await githubRestJson<Array<{ sha: string }>>(
      token,
      `/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=15`
    );
    const batchSize = 5;
    for (let i = 0; i < commits.length; i += batchSize) {
      const batch = commits.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (c) => {
          try {
            const detail = await githubRestJson<{
              files?: Array<{ filename: string; changes?: number }>;
            }>(token, `/repos/${owner}/${repo}/commits/${c.sha}`);
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
      `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`
    );
    const commitDetail = await githubRestJson<{ tree: { sha: string } }>(
      token,
      `/repos/${owner}/${repo}/git/commits/${br.commit.sha}`
    );
    const tree = await githubRestJson<{ tree: Array<{ type: string }>; truncated: boolean }>(
      token,
      `/repos/${owner}/${repo}/git/trees/${commitDetail.tree.sha}?recursive=1`
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
  const meta = await githubRestJson<{ default_branch: string }>(
    token,
    `/repos/${owner}/${repo}`
  );
  const branch = ref.trim() || meta.default_branch;

  const br = await githubRestJson<{ commit: { sha: string } }>(
    token,
    `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`
  );
  const commitDetail = await githubRestJson<{ tree: { sha: string } }>(
    token,
    `/repos/${owner}/${repo}/git/commits/${br.commit.sha}`
  );
  const tree = await githubRestJson<{ tree: Array<{ type: string; path?: string }>; truncated: boolean }>(
    token,
    `/repos/${owner}/${repo}/git/trees/${commitDetail.tree.sha}?recursive=1`
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
  }>(token, `/repos/${owner}/${repo}/contents/${encPath}?${q}`);

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

export async function aggregatePatternCounts(
  db: import("mongodb").Db,
  repoFull: string
): Promise<Array<{ text: string; count: number }>> {
  const docs = await db
    .collection("explanations_cache")
    .find({ repo: repoFull })
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
};

export type GithubRepoSummary = {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  pushedAt: string | null;
  htmlUrl: string;
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
