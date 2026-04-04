/**
 * ArmorClaw — intent enforcement for GitLore (ArmorIQ track).
 * Option B: local policy + signed intent token (UUID + expiry + allowed steps).
 * Optional cloud ArmorIQ SDK can be added later when ARMORIQ_API_KEY is set.
 */
import { randomUUID } from "crypto";
import type { ObjectId } from "mongodb";
import { getDB } from "./mongo";

export const TOOL_RISK: Record<string, "low" | "medium" | "high" | "critical"> = {
  search_knowledge_graph: "low",
  fetch_blame: "low",
  fetch_pr_details: "low",
  fetch_issue: "low",
  fetch_repo_stats: "low",
  fetch_file_content: "medium",
  generate_narrative: "low",
  generate_embedding: "low",
  generate_voice: "low",
  ingest_repo: "medium",
  access_private_repo: "high",
  modify_code: "high",
  post_comment: "high",
  access_credentials: "critical",
  delete_data: "critical",
  access_other_user: "critical",
  external_upload: "critical",
  execute_code: "critical",
};

export const ARMOR_POLICY_DEFINITION = {
  policy_version: "1.0",
  agent_id: "gitlore-agent",
  default_action: "deny",
  tools: TOOL_RISK,
  rules: [
    {
      name: "allow_read_scoped_repo",
      tools: [
        "search_knowledge_graph",
        "fetch_blame",
        "fetch_pr_details",
        "fetch_issue",
        "fetch_repo_stats",
        "fetch_file_content",
      ],
      condition: "target_repo == scoped_repo AND NOT sensitive_path",
      action: "allow",
    },
    {
      name: "allow_generation",
      tools: ["generate_narrative", "generate_embedding", "generate_voice"],
      condition: "always",
      action: "allow",
    },
    {
      name: "allow_ingest_rate_limited",
      tools: ["ingest_repo"],
      condition: "scoped_repo AND user_rate_ok",
      action: "allow",
    },
    {
      name: "block_write_operations",
      tools: ["modify_code", "post_comment", "delete_data"],
      condition: "always",
      action: "deny",
      reason: "GitLore is read-only — no write operations permitted",
    },
    {
      name: "block_credential_access",
      tools: ["access_credentials", "access_other_user", "external_upload", "execute_code"],
      condition: "always",
      action: "deny",
      reason:
        "Critical security boundary — credentials, other users, external uploads, and code execution are never permitted",
    },
    {
      name: "block_private_repo_tool",
      tools: ["access_private_repo"],
      condition: "always",
      action: "deny",
      reason: "Cross-repository / private access must stay within OAuth-scoped session repos",
    },
  ],
} as const;

export type EnforcementContext = {
  userId: string;
  githubLogin: string;
  repoScope: string;
  scopedOwner: string;
  scopedRepo: string;
  accessToken: string;
  repoIsPrivate: boolean;
  repoOwnerLogin: string;
};

export type IntentPlanStep = {
  step: number;
  tool: string;
  params: Record<string, unknown>;
  justification?: string;
};

export type IntentPlan = {
  intent?: string;
  steps: IntentPlanStep[];
};

export type LocalIntentToken = {
  planId: string;
  intentTokenId: string;
  expiresAt: number;
  allowedSteps: Array<{ stepIndex: number; tool: string; params: Record<string, unknown> }>;
};

const INGEST_COOLDOWN_MS = 120_000;
const ingestLastByUser = new Map<string, number>();

export function markIngestExecuted(userId: string): void {
  ingestLastByUser.set(userId, Date.now());
}

function normalizeRepoParam(repo: unknown, ctx: EnforcementContext): string {
  if (typeof repo === "string" && repo.includes("/")) {
    return repo.toLowerCase().replace(/^\/+|\/+$/g, "");
  }
  return ctx.repoScope;
}

const SENSITIVE_PATH_RE =
  /\.env($|[./])|(^|\/)\.env\.|id_rsa|id_ed25519|\.pem$|credentials\.json|\.aws\/|token\.json|secrets\.|\/\.git\/|password|apikey|api_key/i;

export function isSensitiveFilePath(path: unknown): boolean {
  if (typeof path !== "string" || !path.trim()) return false;
  const p = path.replace(/\\/g, "/").toLowerCase();
  return SENSITIVE_PATH_RE.test(p);
}

export type PolicyEval = {
  allowed: boolean;
  reason: string;
  policy_rule: string;
  risk_level: "low" | "medium" | "high" | "critical";
};

export function evaluateToolPolicy(
  tool: string,
  params: Record<string, unknown>,
  ctx: EnforcementContext
): PolicyEval {
  const risk = TOOL_RISK[tool] || "high";
  const targetRepo = normalizeRepoParam(params.repo, ctx);

  const deny = (policy_rule: string, reason: string): PolicyEval => ({
    allowed: false,
    reason,
    policy_rule,
    risk_level: risk,
  });

  const allow = (policy_rule: string, reason: string): PolicyEval => ({
    allowed: true,
    reason,
    policy_rule,
    risk_level: risk,
  });

  if (
    tool === "modify_code" ||
    tool === "post_comment" ||
    tool === "delete_data"
  ) {
    return deny(
      "block_write_operations",
      ARMOR_POLICY_DEFINITION.rules[3].reason as string
    );
  }

  if (
    tool === "access_credentials" ||
    tool === "access_other_user" ||
    tool === "external_upload" ||
    tool === "execute_code"
  ) {
    return deny(
      "block_credential_access",
      ARMOR_POLICY_DEFINITION.rules[4].reason as string
    );
  }

  if (tool === "access_private_repo") {
    return deny(
      "block_private_repo_tool",
      "Repository is outside the current GitLore session scope or tool is not permitted."
    );
  }

  if (targetRepo !== ctx.repoScope) {
    return deny(
      "allow_read_scoped_repo",
      `Cross-repository access denied: ${targetRepo} is not the active repo (${ctx.repoScope}).`
    );
  }

  if (tool === "fetch_file_content") {
    const filePath = params.file ?? params.path;
    if (isSensitiveFilePath(filePath)) {
      return deny(
        "block_credential_access",
        "Reading this path is blocked (credential / secret patterns)."
      );
    }
  }

  if (tool === "ingest_repo") {
    const last = ingestLastByUser.get(ctx.userId) || 0;
    if (Date.now() - last < INGEST_COOLDOWN_MS) {
      return deny(
        "allow_ingest_rate_limited",
        "Ingest was requested too soon; wait before starting another batch ingest."
      );
    }
    return allow("allow_ingest_rate_limited", "Ingest allowed for scoped repo (rate limited).");
  }

  if (
    tool === "search_knowledge_graph" ||
    tool === "fetch_blame" ||
    tool === "fetch_pr_details" ||
    tool === "fetch_issue" ||
    tool === "fetch_repo_stats" ||
    tool === "fetch_file_content"
  ) {
    return allow(
      "allow_read_scoped_repo",
      "Read tool allowed for OAuth-scoped repository."
    );
  }

  if (
    tool === "generate_narrative" ||
    tool === "generate_embedding" ||
    tool === "generate_voice"
  ) {
    return allow("allow_generation", "Generation tools allowed.");
  }

  return deny("default_deny", `Unknown or disallowed tool: ${tool}`);
}

export type EnforcementLogDoc = {
  timestamp: Date;
  user: string;
  repo: string;
  plan_id: string;
  tool: string;
  params: Record<string, unknown>;
  action: "allow" | "deny";
  reason: string;
  policy_rule: string;
  risk_level: string;
  intent_token_id: string;
  response_time_ms: number;
  phase?: "plan" | "execute";
};

export async function logEnforcementDecision(
  doc: EnforcementLogDoc
): Promise<ObjectId> {
  const db = getDB();
  const res = await db.collection("enforcement_logs").insertOne(doc);
  return res.insertedId;
}

export async function getEnforcementLogs(
  repoFull: string,
  limit: number,
  action?: "allow" | "deny",
  /** When set, only rows created by this GitLore user id (e.g. github:login). */
  forUser?: string
): Promise<EnforcementLogDoc[]> {
  const db = getDB();
  const q: Record<string, unknown> = { repo: repoFull };
  if (action) q.action = action;
  if (forUser) q.user = forUser;
  const rows = await db
    .collection("enforcement_logs")
    .find(q)
    .sort({ timestamp: -1 })
    .limit(Math.min(limit, 200))
    .toArray();
  return rows as unknown as EnforcementLogDoc[];
}

export class EnforcementLayer {
  readonly context: EnforcementContext;
  token: LocalIntentToken | null = null;
  planId = "";

  constructor(context: EnforcementContext) {
    this.context = context;
  }

  async submitPlan(plan: IntentPlan): Promise<LocalIntentToken> {
    const t0 = Date.now();
    this.planId = randomUUID();
    const intentTokenId = randomUUID();
    const allowedSteps: LocalIntentToken["allowedSteps"] = [];

    for (const s of plan.steps || []) {
      const ev = evaluateToolPolicy(s.tool, s.params || {}, this.context);
      const started = Date.now();
      await logEnforcementDecision({
        timestamp: new Date(),
        user: this.context.userId,
        repo: this.context.repoScope,
        plan_id: this.planId,
        tool: s.tool,
        params: s.params || {},
        action: ev.allowed ? "allow" : "deny",
        reason: ev.reason,
        policy_rule: ev.policy_rule,
        risk_level: ev.risk_level,
        intent_token_id: intentTokenId,
        response_time_ms: Date.now() - started,
        phase: "plan",
      });
      if (ev.allowed) {
        allowedSteps.push({
          stepIndex: s.step,
          tool: s.tool,
          params: s.params || {},
        });
      }
    }

    this.token = {
      planId: this.planId,
      intentTokenId,
      expiresAt: Date.now() + 15 * 60 * 1000,
      allowedSteps,
    };

    void t0;
    return this.token;
  }

  async enforceTool(
    tool: string,
    params: Record<string, unknown>,
    stepIndex: number
  ): Promise<{ allowed: boolean; reason: string; policy_rule: string; risk_level: string; logId?: string }> {
    const started = Date.now();
    if (!this.token || Date.now() > this.token.expiresAt) {
      const reason = "Intent token missing or expired — start a new plan.";
      const id = await logEnforcementDecision({
        timestamp: new Date(),
        user: this.context.userId,
        repo: this.context.repoScope,
        plan_id: this.planId,
        tool,
        params,
        action: "deny",
        reason,
        policy_rule: "token_expired",
        risk_level: "medium",
        intent_token_id: this.token?.intentTokenId || "none",
        response_time_ms: Date.now() - started,
        phase: "execute",
      });
      return {
        allowed: false,
        reason,
        policy_rule: "token_expired",
        risk_level: "medium",
        logId: id.toString(),
      };
    }

    const match = this.token.allowedSteps.find(
      (x) => x.stepIndex === stepIndex && x.tool === tool
    );
    if (!match) {
      const reason = "Tool/step not in approved plan (ArmorClaw).";
      const id = await logEnforcementDecision({
        timestamp: new Date(),
        user: this.context.userId,
        repo: this.context.repoScope,
        plan_id: this.planId,
        tool,
        params,
        action: "deny",
        reason,
        policy_rule: "not_in_plan",
        risk_level: "high",
        intent_token_id: this.token.intentTokenId,
        response_time_ms: Date.now() - started,
        phase: "execute",
      });
      return {
        allowed: false,
        reason,
        policy_rule: "not_in_plan",
        risk_level: "high",
        logId: id.toString(),
      };
    }

    const ev = evaluateToolPolicy(tool, params, this.context);
    const id = await logEnforcementDecision({
      timestamp: new Date(),
      user: this.context.userId,
      repo: this.context.repoScope,
      plan_id: this.planId,
      tool,
      params,
      action: ev.allowed ? "allow" : "deny",
      reason: ev.reason,
      policy_rule: ev.policy_rule,
      risk_level: ev.risk_level,
      intent_token_id: this.token.intentTokenId,
      response_time_ms: Date.now() - started,
      phase: "execute",
    });

    return {
      allowed: ev.allowed,
      reason: ev.reason,
      policy_rule: ev.policy_rule,
      risk_level: ev.risk_level,
      logId: id.toString(),
    };
  }
}

export function createEnforcementLayer(ctx: EnforcementContext): EnforcementLayer {
  if (process.env.ARMORIQ_API_KEY?.trim()) {
    // Future: swap for IAP-signed tokens via @armoriq/armoriq-sdk-customer-ts
  }
  return new EnforcementLayer(ctx);
}

/** Dry-run policy check (no plan token, no execution). */
export function previewEnforcement(
  tool: string,
  params: Record<string, unknown>,
  ctx: EnforcementContext
): PolicyEval {
  return evaluateToolPolicy(tool, params, ctx);
}
