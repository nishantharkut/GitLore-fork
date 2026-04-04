import { Hono } from "hono";
import { getDB } from "../lib/mongo";
import { getCurrentUser } from "../middleware/auth";
import { ingestRepo, isStaleIngestRunning } from "../lib/ingest";
import { buildKnowledgeLayout } from "../lib/knowledgeLayout";

export const ingestRouter = new Hono();

function repoKey(owner: string, name: string) {
  return `${owner}/${name}`.toLowerCase().replace(/^\/+|\/+$/g, "");
}

/**
 * POST /api/repo/:owner/:name/ingest
 * Start knowledge graph ingestion for a repository
 */
ingestRouter.post("/repo/:owner/:name/ingest", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) return c.json({ error: "Not authenticated" }, 401);

    const owner = c.req.param("owner");
    const name = c.req.param("name");
    if (!owner || !name) return c.json({ error: "Missing owner or name" }, 400);

    const body = await c.req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body.limit) || 30, 1), 50);
    const repoFull = repoKey(owner, name);
    const db = getDB();

    const existing = await db.collection("knowledge_progress").findOne({ repo: repoFull });
    if (existing?.status === "running" && !isStaleIngestRunning(existing)) {
      return c.json({
        status: "already_running",
        processed: existing.processed,
        total: existing.total,
        failed: existing.failed ?? 0,
      });
    }

    ingestRepo(user.access_token, owner, name, limit).catch((err) => {
      console.error("Background ingest error:", err);
    });

    return c.json({ status: "started", limit });
  } catch (error) {
    console.error("Ingest error:", error);
    return c.json({ error: "Failed to start ingestion" }, 500);
  }
});

/**
 * GET /api/repo/:owner/:name/ingest/status
 * Check ingestion progress
 */
ingestRouter.get("/repo/:owner/:name/ingest/status", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) return c.json({ error: "Not authenticated" }, 401);

    const owner = c.req.param("owner");
    const name = c.req.param("name");
    const repoFull = repoKey(owner, name);
    const db = getDB();

    const progress = await db.collection("knowledge_progress").findOne({ repo: repoFull });
    if (!progress) {
      return c.json({ status: "not_started" });
    }

    const nodeCount = await db.collection("knowledge_nodes").countDocuments({ repo: repoFull });

    if (isStaleIngestRunning(progress)) {
      return c.json({
        status: "stale",
        processed: progress.processed ?? 0,
        failed: progress.failed ?? 0,
        total: progress.total ?? 0,
        errorCount: Array.isArray(progress.errors) ? progress.errors.length : 0,
        nodeCount,
        hint:
          "Ingest was marked running but has not updated recently (e.g. server restarted). Start again to continue.",
      });
    }

    return c.json({
      status: progress.status,
      processed: progress.processed,
      failed: progress.failed ?? 0,
      total: progress.total,
      errorCount: Array.isArray(progress.errors) ? progress.errors.length : 0,
      nodeCount,
    });
  } catch (error) {
    console.error("Ingest status error:", error);
    return c.json({ error: "Failed to check status" }, 500);
  }
});

/**
 * GET /api/repo/:owner/:name/knowledge
 * Get all knowledge nodes for the graph visualization
 */
ingestRouter.get("/repo/:owner/:name/knowledge", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) return c.json({ error: "Not authenticated" }, 401);

    const owner = c.req.param("owner");
    const name = c.req.param("name");
    const repoFull = repoKey(owner, name);
    const db = getDB();

    const nodes = await db
      .collection("knowledge_nodes")
      .find({ repo: repoFull })
      .project({ embedding: 0 }) // Don't send embeddings to frontend
      .sort({ merged_at: -1 })
      .limit(100)
      .toArray();

    return c.json({ nodes, count: nodes.length });
  } catch (error) {
    console.error("Knowledge fetch error:", error);
    return c.json({ error: "Failed to fetch knowledge" }, 500);
  }
});

/**
 * GET /api/repo/:owner/:name/knowledge-layout
 * Structured graph (repo → PRs → issues / merge commits / contributors) for the Overview SVG.
 */
ingestRouter.get("/repo/:owner/:name/knowledge-layout", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) return c.json({ error: "Not authenticated" }, 401);

    const owner = c.req.param("owner");
    const name = c.req.param("name");
    const repoFull = repoKey(owner, name);
    const db = getDB();

    const prDocs = await db
      .collection("knowledge_nodes")
      .find({ repo: repoFull })
      .project({ embedding: 0 })
      .sort({ merged_at: -1 })
      .limit(50)
      .toArray();

    const layout = buildKnowledgeLayout(repoFull, owner, name, prDocs as Record<string, unknown>[]);
    return c.json(layout);
  } catch (error) {
    console.error("Knowledge layout error:", error);
    return c.json({ error: "Failed to build knowledge layout" }, 500);
  }
});
