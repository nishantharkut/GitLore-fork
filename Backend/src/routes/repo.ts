import { Hono } from "hono";
import { z } from "zod";
import { getDB } from "../lib/mongo";
import { getUserToken, getCurrentUser } from "../middleware/auth";
import {
  createGithubClient,
  getRepositoryInfo,
  getRepositoryStats,
} from "../lib/github";
import {
  enrichRepositoryOverview,
  aggregatePatternCounts,
  listRepoPathsLimited,
  getRepoFileContent,
  listAuthenticatedUserRepos,
  searchRepositoriesRest,
} from "../lib/githubRest";

export const repoRouter = new Hono();

/**
 * GET /api/repos/me?limit=30 — repos for the signed-in user (updated desc).
 */
repoRouter.get("/repos/me", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return c.json({ error: "Not authenticated" }, 401);
    }
    const limit = Math.min(parseInt(c.req.query("limit") || "30", 10) || 30, 100);
    const repositories = await listAuthenticatedUserRepos(user.access_token, limit);
    return c.json({ repositories });
  } catch (error) {
    console.error("repos/me error:", error);
    return c.json(
      {
        error: "Failed to list repositories",
        message:
          process.env.NODE_ENV === "development" && error instanceof Error
            ? error.message
            : undefined,
      },
      500
    );
  }
});

/**
 * GET /api/repos/search?q=&per_page=20 — GitHub repository search.
 */
repoRouter.get("/repos/search", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return c.json({ error: "Not authenticated" }, 401);
    }
    const q = (c.req.query("q") || "").trim();
    if (!q) {
      return c.json({ repositories: [] });
    }
    const perPage = Math.min(parseInt(c.req.query("per_page") || "20", 10) || 20, 30);
    const repositories = await searchRepositoriesRest(user.access_token, q, perPage);
    return c.json({ repositories });
  } catch (error) {
    console.error("repos/search error:", error);
    return c.json(
      {
        error: "Repository search failed",
        message:
          process.env.NODE_ENV === "development" && error instanceof Error
            ? error.message
            : undefined,
      },
      500
    );
  }
});

// Schema for repo request
const repoRequestSchema = z.object({
  owner: z.string().describe("Repository owner"),
  name: z.string().describe("Repository name"),
});

type RepoRequest = z.infer<typeof repoRequestSchema>;

/**
 * GET /api/repo/:owner/:name/index?ref=&limit=400
 */
repoRouter.get("/repo/:owner/:name/index", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return c.json({ error: "Not authenticated" }, 401);
    }
    const owner = c.req.param("owner");
    const name = c.req.param("name");
    const ref = c.req.query("ref") || "";
    const limit = Math.min(parseInt(c.req.query("limit") || "400", 10) || 400, 2000);

    if (!owner || !name) {
      return c.json({ error: "Missing owner or repository name" }, 400);
    }

    const { paths, truncated, defaultBranch } = await listRepoPathsLimited(
      user.access_token,
      owner,
      name,
      ref,
      limit
    );

    return c.json({
      owner,
      name,
      defaultBranch,
      refUsed: ref || defaultBranch,
      paths,
      truncated,
    });
  } catch (error) {
    console.error("Repo index error:", error);
    return c.json(
      {
        error: "Failed to list repository files",
        message:
          process.env.NODE_ENV === "development" && error instanceof Error
            ? error.message
            : undefined,
      },
      500
    );
  }
});

/**
 * GET /api/repo/:owner/:name/raw?path=&ref=
 */
repoRouter.get("/repo/:owner/:name/raw", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return c.json({ error: "Not authenticated" }, 401);
    }
    const owner = c.req.param("owner");
    const name = c.req.param("name");
    const path = c.req.query("path");
    const ref = c.req.query("ref") || "";

    if (!owner || !name || !path) {
      return c.json({ error: "Missing owner, repository name, or path" }, 400);
    }

    const result = await getRepoFileContent(
      user.access_token,
      owner,
      name,
      path,
      ref
    );

    if (result.isBinary || result.text === null) {
      return c.json({
        path,
        isBinary: true,
        text: null,
        message: "Binary or non-text file — open on GitHub to view.",
        size: result.size,
      });
    }

    return c.json({
      path,
      isBinary: false,
      text: result.text,
      size: result.size,
    });
  } catch (error) {
    console.error("Repo raw error:", error);
    return c.json(
      {
        error: "Failed to fetch file",
        message:
          process.env.NODE_ENV === "development" && error instanceof Error
            ? error.message
            : undefined,
      },
      500
    );
  }
});

/**
 * GET /api/repo/:owner/:name
 * Get repository overview information
 */
repoRouter.get("/repo/:owner/:name", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    const owner = c.req.param("owner");
    const name = c.req.param("name");
    const branchHint = c.req.query("branch") || undefined;

    if (!owner || !name) {
      return c.json(
        { error: "Missing owner or repository name" },
        400
      );
    }

    const db = getDB();
    const repoFull = `${owner}/${name}`;
    const cacheKey = `repo:${owner}:${name}:${branchHint || "__def__"}`;
    const cached = await db.collection("repo_cache").findOne({ _id: cacheKey } as any);

    if (cached && new Date() < cached.expires_at) {
      return c.json(cached.data);
    }

    const githubClient = createGithubClient(user.access_token);

    const repoInfo = await getRepositoryInfo(githubClient as any, owner, name);
    const stats = await getRepositoryStats(githubClient as any, owner, name);

    if (!repoInfo) {
      return c.json(
        {
          error: "Repository not found",
          message: `Could not find repository ${owner}/${name}`,
        },
        404
      );
    }

    const refs = stats?.refs?.nodes || [];
    const mainRef = refs.find((r: any) => r.name === "main") || refs[0];
    const totalCommits = mainRef?.target?.history?.totalCount || 0;
    const prCount = stats?.pullRequests?.totalCount || 0;
    const issueCount = stats?.issues?.totalCount || 0;

    let enrich;
    try {
      enrich = await enrichRepositoryOverview(
        user.access_token,
        owner,
        name,
        branchHint
      );
    } catch (e) {
      console.error("enrichRepositoryOverview:", e);
      enrich = {
        defaultBranch: "main",
        fileCount: 0,
        contributorCount: 0,
        mostChangedFiles: [],
        knowledgeGraph: { nodes: [], edges: [] },
      };
    }

    const patternRows = await aggregatePatternCounts(db, repoFull);
    const topAntiPatterns = patternRows.map((p, i) => ({
      text: p.text,
      count: p.count,
      dot:
        i % 3 === 0
          ? "bg-gitlore-error"
          : i % 3 === 1
            ? "bg-gitlore-warning"
            : "bg-gitlore-success",
    }));

    const response = {
      id: repoFull,
      name: repoInfo.name,
      description: repoInfo.description,
      url: repoInfo.url,
      isPrivate: repoInfo.isPrivate,
      language: repoInfo.primaryLanguage?.name,
      defaultBranch: enrich.defaultBranch,
      owner: {
        login: repoInfo.owner.login,
        type: repoInfo.owner.type,
      },
      stats: {
        stars: repoInfo.stargazerCount,
        forks: repoInfo.forkCount,
        commits: totalCommits,
        pullRequests: prCount,
        issues: issueCount,
        files: enrich.fileCount,
        contributors: enrich.contributorCount,
      },
      healthScore: calculateHealthScore({
        stars: repoInfo.stargazerCount,
        commits: totalCommits,
        pullRequests: prCount,
        isPrivate: repoInfo.isPrivate,
      }),
      topAntiPatterns,
      mostChangedFiles: enrich.mostChangedFiles.map((f) => ({
        name: f.name,
        changes: f.changes,
        touches: f.touches,
      })),
      knowledgeGraph: enrich.knowledgeGraph,
    };

    await db.collection("repo_cache").updateOne(
      { _id: cacheKey } as any,
      {
        $set: {
          data: response,
          expires_at: new Date(Date.now() + 60 * 60 * 1000),
        },
      },
      { upsert: true }
    );

    return c.json(response);
  } catch (error) {
    console.error("Repo error:", error);

    return c.json(
      {
        error: "Failed to fetch repository information",
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

/**
 * POST /api/repo/search
 * Search for repositories (simplified)
 */
const repoSearchSchema = z.object({
  owner: z.string().describe("Repository owner"),
  name: z.string().describe("Repository name"),
});

repoRouter.post("/repo/search", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    const body = await c.req.json();
    const { owner, name } = repoSearchSchema.parse(body);

    // For MVP, just validate the repo exists
    const githubClient = createGithubClient(user.access_token);
    const repoInfo = await getRepositoryInfo(githubClient as any, owner, name);

    if (!repoInfo) {
      return c.json(
        {
          error: "Repository not found",
        },
        404
      );
    }

    return c.json({
      found: true,
      repository: {
        owner,
        name,
        url: repoInfo.url,
      },
    });
  } catch (error) {
    console.error("Repo search error:", error);

    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: "Validation error",
          details: error.errors,
        },
        400
      );
    }

    return c.json(
      {
        error: "Repository search failed",
      },
      500
    );
  }
});

/**
 * Helper: Calculate health score (simplified)
 */
function calculateHealthScore(metrics: {
  stars: number;
  commits: number;
  pullRequests: number;
  isPrivate: boolean;
}): number {
  let score = 5; // Base score

  if (metrics.stars > 1000) score += 2;
  else if (metrics.stars > 100) score += 1;

  if (metrics.commits > 500) score += 1.5;
  else if (metrics.commits > 100) score += 0.5;

  if (metrics.pullRequests > 50) score += 1;

  if (!metrics.isPrivate) score += 0.5;

  return Math.min(score, 10);
}
