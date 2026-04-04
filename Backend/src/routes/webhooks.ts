import { Hono } from "hono";
import { verifyGithubWebhookSignature } from "../webhooks/github/signature";
import { processPRWebhook, type GithubPRWebhookBody } from "../webhooks/github/processPrWebhook";

export const webhookRouter = new Hono();

webhookRouter.post("/github", async (c) => {
  const rawBody = await c.req.text();
  const sig = c.req.header("x-hub-signature-256");
  const v = verifyGithubWebhookSignature(rawBody, sig);
  if (!v.ok) {
    const msg = v.reason === "invalid_signature" ? "Invalid signature" : "Unauthorized";
    return c.json({ error: msg }, 401);
  }

  const event = c.req.header("x-github-event") || "";
  if (event === "ping") {
    return c.json({ status: "pong" });
  }
  if (event !== "pull_request") {
    return c.json({ ignored: true, event });
  }

  let payload: GithubPRWebhookBody;
  try {
    payload = JSON.parse(rawBody) as GithubPRWebhookBody;
  } catch {
    return c.json({ ignored: true, reason: "invalid_json" });
  }

  const action = payload.action;
  if (action !== "opened" && action !== "reopened") {
    return c.json({ ignored: true, action });
  }

  const prNumber = payload.pull_request?.number;
  if (typeof prNumber !== "number") {
    return c.json({ ignored: true, reason: "no_pr_number" });
  }

  console.log("[webhook] Received pull_request event", {
    action,
    pr: prNumber,
    repo: payload.repository?.full_name,
  });

  void processPRWebhook(payload).catch((err) =>
    console.error("[webhook] PR processing failed:", err)
  );

  return c.json({ status: "accepted", pr: prNumber }, 202);
});
