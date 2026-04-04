import { Hono } from "hono";
import { z } from "zod";
import {
  ARMOR_POLICY_DEFINITION,
  getEnforcementLogs,
  previewEnforcement,
  type EnforcementContext,
} from "../lib/armorclaw";
import { getCurrentUser } from "../middleware/auth";
import { createGithubClient, getRepositoryInfo } from "../lib/github";

export const enforcementRouter = new Hono();

function normalizeRepo(full: string): { owner: string; name: string; repoFull: string } {
  const s = full.trim().replace(/^\/+|\/+$/g, "");
  const i = s.indexOf("/");
  if (i <= 0 || i === s.length - 1) {
    throw new Error("repo must be owner/name");
  }
  const owner = s.slice(0, i).trim();
  const name = s.slice(i + 1).trim();
  if (!owner || !name) throw new Error("repo must be owner/name");
  return { owner, name, repoFull: `${owner}/${name}`.toLowerCase() };
}

/** Normalize path params the same way as body `repo` strings. */
function paramsToRepo(ownerParam: string, nameParam: string): { owner: string; name: string; repoFull: string } {
  return normalizeRepo(`${ownerParam}/${nameParam}`);
}

/**
 * GET /api/enforcement/logs/:owner/:name
 */
enforcementRouter.get("/enforcement/logs/:owner/:name", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) return c.json({ error: "Not authenticated" }, 401);

    let owner: string;
    let name: string;
    let repoFull: string;
    try {
      ({ owner, name, repoFull } = paramsToRepo(c.req.param("owner"), c.req.param("name")));
    } catch {
      return c.json({ error: "Invalid owner or repository name" }, 400);
    }

    const gql = createGithubClient(user.access_token);
    const repoMeta = await getRepositoryInfo(gql, owner, name);
    if (!repoMeta) {
      return c.json(
        { error: "Repository not found or not accessible with your GitHub token" },
        403
      );
    }

    const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 50));
    const action = c.req.query("action");
    const act =
      action === "allow" || action === "deny" ? action : undefined;

    const currentUserId = `github:${user.username}`;
    const logs = await getEnforcementLogs(repoFull, limit, act, currentUserId);
    return c.json({
      repo: repoFull,
      count: logs.length,
      logs: logs.map((l) => ({
        timestamp: l.timestamp instanceof Date ? l.timestamp.toISOString() : String(l.timestamp),
        user: l.user,
        repo: l.repo,
        plan_id: l.plan_id,
        tool: l.tool,
        params: l.params,
        action: l.action,
        reason: l.reason,
        policy_rule: l.policy_rule,
        risk_level: l.risk_level,
        intent_token_id: l.intent_token_id,
        response_time_ms: l.response_time_ms,
        phase: l.phase,
      })),
    });
  } catch (error) {
    console.error("enforcement logs error:", error);
    return c.json({ error: "Failed to load enforcement logs" }, 500);
  }
});

const testBodySchema = z.object({
  tool: z.string().min(1),
  params: z.record(z.unknown()).optional().default({}),
  repo: z.string().min(3),
});

/**
 * POST /api/enforcement/test — dry-run policy (no tool execution).
 */
enforcementRouter.post("/enforcement/test", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) return c.json({ error: "Not authenticated" }, 401);

    const body = await c.req.json();
    const { tool, params, repo } = testBodySchema.parse(body);
    const { owner, name, repoFull } = normalizeRepo(repo);

    const gql = createGithubClient(user.access_token);
    const repoMeta = await getRepositoryInfo(gql, owner, name);
    const ctx: EnforcementContext = {
      userId: `github:${user.username}`,
      githubLogin: user.username,
      repoScope: repoFull,
      scopedOwner: owner,
      scopedRepo: name,
      accessToken: user.access_token,
      repoIsPrivate: Boolean(repoMeta?.isPrivate),
      repoOwnerLogin: String(repoMeta?.owner?.login || owner),
    };

    const ev = previewEnforcement(tool, params, ctx);
    return c.json({
      allowed: ev.allowed,
      reason: ev.reason,
      policy_rule: ev.policy_rule,
      risk_level: ev.risk_level,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: "Invalid body", details: error.errors }, 400);
    }
    console.error("enforcement test error:", error);
    return c.json({ error: "Policy test failed" }, 500);
  }
});

/**
 * GET /api/enforcement/policy — public (auth skipped in middleware).
 */
enforcementRouter.get("/enforcement/policy", (c) => {
  return c.json(ARMOR_POLICY_DEFINITION);
});
