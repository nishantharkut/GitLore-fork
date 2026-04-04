import { Hono } from "hono";
import { z } from "zod";
import { getDB } from "../lib/mongo";
import { getCurrentUser } from "../middleware/auth";
import { runAutoFixClassify, runAutoFixApply } from "../lib/autofix";

export const autofixRouter = new Hono();

const applyBodySchema = z.object({
  comment_ids: z.array(z.number().int().positive()),
  branch_name: z.string().min(1).max(200).optional(),
});

/**
 * POST /api/repo/:owner/:name/pulls/:number/auto-fix/classify
 */
autofixRouter.post("/repo/:owner/:name/pulls/:number/auto-fix/classify", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) return c.json({ error: "Not authenticated" }, 401);

    const owner = c.req.param("owner");
    const name = c.req.param("name");
    const pullNumber = parseInt(c.req.param("number"), 10);
    if (!owner || !name || !Number.isFinite(pullNumber)) {
      return c.json({ error: "Invalid owner, name, or pull number" }, 400);
    }

    const db = getDB();
    const result = await runAutoFixClassify(db, user.access_token, owner, name, pullNumber);
    return c.json(result);
  } catch (error) {
    console.error("auto-fix classify error:", error);
    return c.json(
      { error: "Auto-fix classify failed", message: error instanceof Error ? error.message : String(error) },
      500
    );
  }
});

/**
 * POST /api/repo/:owner/:name/pulls/:number/auto-fix/apply
 */
autofixRouter.post("/repo/:owner/:name/pulls/:number/auto-fix/apply", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) return c.json({ error: "Not authenticated" }, 401);

    const owner = c.req.param("owner");
    const name = c.req.param("name");
    const pullNumber = parseInt(c.req.param("number"), 10);
    if (!owner || !name || !Number.isFinite(pullNumber)) {
      return c.json({ error: "Invalid owner, name, or pull number" }, 400);
    }

    const body = await c.req.json();
    const parsed = applyBodySchema.parse(body);
    if (parsed.comment_ids.length === 0) {
      return c.json({ error: "comment_ids must be non-empty" }, 400);
    }

    const db = getDB();
    const result = await runAutoFixApply(
      db,
      user.access_token,
      owner,
      name,
      pullNumber,
      parsed.comment_ids,
      parsed.branch_name
    );
    return c.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: "Invalid body", details: error.errors }, 400);
    }
    console.error("auto-fix apply error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    const status = /No valid fixes|not found/i.test(msg) ? 400 : 500;
    return c.json({ error: "Auto-fix apply failed", message: msg }, status);
  }
});
