import crypto from "crypto";

export type WebhookSigFailure =
  | "invalid_signature"
  | "missing_signature"
  | "missing_secret";

/**
 * Verifies GitHub X-Hub-Signature-256.
 * Production: GITHUB_WEBHOOK_SECRET is required (fail closed).
 * Non-production: set GITLORE_WEBHOOK_ALLOW_UNSIGNED=true to allow missing secret (local/ngrok only).
 */
export function verifyGithubWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined
): { ok: true } | { ok: false; reason: WebhookSigFailure } {
  const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim();
  if (!secret) {
    const allowUnsigned =
      process.env.NODE_ENV !== "production" &&
      process.env.GITLORE_WEBHOOK_ALLOW_UNSIGNED?.trim() === "true";
    if (allowUnsigned) {
      console.warn(
        "GITLORE_WEBHOOK_ALLOW_UNSIGNED=true — accepting webhooks without GITHUB_WEBHOOK_SECRET (dev only)"
      );
      return { ok: true };
    }
    console.error(
      "GITHUB_WEBHOOK_SECRET not set — rejecting webhook (set secret or GITLORE_WEBHOOK_ALLOW_UNSIGNED=true in non-production)"
    );
    return { ok: false, reason: "missing_secret" };
  }
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return { ok: false, reason: "missing_signature" };
  }
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(rawBody, "utf8");
  const expected = `sha256=${hmac.digest("hex")}`;
  const a = Buffer.from(signatureHeader, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "invalid_signature" };
  }
  return { ok: true };
}
