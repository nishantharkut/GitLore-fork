import { Hono } from "hono";
import { z } from "zod";
import { getCurrentUser } from "../middleware/auth";

export const guardrailsRouter = new Hono();

// Allowed and blocked actions
const ALLOWED_ACTIONS = [
  "analyze_public_repo",
  "generate_narrative",
  "explain_review_comment",
  "search_similar_decisions",
  "generate_voice_narration",
  "view_code_context",
  "fetch_repository_info",
];

const BLOCKED_ACTIONS = [
  "access_private_repo_without_auth",
  "modify_code",
  "post_comments_on_behalf_of_user",
  "generate_medical_legal_advice",
  "access_user_credentials",
  "delete_repository_data",
  "access_other_users_data",
];

/**
 * GET /api/guardrails
 * Get allowed and blocked actions configuration
 */
guardrailsRouter.get("/guardrails", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    return c.json({
      status: "guardrails_active",
      allowed: ALLOWED_ACTIONS,
      blocked: BLOCKED_ACTIONS,
      user: {
        username: user.username,
        scope: "public_repos",
      },
    });
  } catch (error) {
    console.error("Guardrails error:", error);
    return c.json(
      {
        error: "Failed to fetch guardrails configuration",
      },
      500
    );
  }
});

/**
 * POST /api/guardrails/test
 * Test if an action is allowed or blocked
 */
const guardrailsTestSchema = z.object({
  action: z.string().describe("Action to test"),
});

guardrailsRouter.post("/guardrails/test", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    // Parse and validate request
    const body = await c.req.json();
    const { action } = guardrailsTestSchema.parse(body);

    // Check if action is allowed
    if (BLOCKED_ACTIONS.includes(action)) {
      return c.json({
        action,
        allowed: false,
        reason: `Blocked: ${action} violates security policy`,
        category: "blocked",
        severity: "high",
      });
    }

    if (ALLOWED_ACTIONS.includes(action)) {
      return c.json({
        action,
        allowed: true,
        reason: `Authorized: ${action} is permitted`,
        category: "allowed",
        severity: "low",
      });
    }

    // Unknown action - deny by default
    return c.json({
      action,
      allowed: false,
      reason: `Unknown action: ${action} — denied by default`,
      category: "unknown",
      severity: "medium",
    });
  } catch (error) {
    console.error("Guardrails test error:", error);

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
        error: "Guardrails test failed",
      },
      500
    );
  }
});

/**
 * POST /api/guardrails/report
 * Report a guardrails violation (logging only for MVP)
 */
const guardrailsReportSchema = z.object({
  action: z.string(),
  reason: z.string().optional(),
});

guardrailsRouter.post("/guardrails/report", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    const body = await c.req.json();
    const { action, reason } = guardrailsReportSchema.parse(body);

    console.warn("Guardrail violation reported", {
      user: user.username,
      action,
      reason,
      timestamp: new Date().toISOString(),
    });

    return c.json({
      status: "reported",
      action,
      message: "Violation reported and logged",
    });
  } catch (error) {
    console.error("Guardrails report error:", error);

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
        error: "Report failed",
      },
      500
    );
  }
});
