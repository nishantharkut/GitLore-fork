import crypto from "crypto";

export function verifyGithubWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined
): { ok: true } | { ok: false; reason: "invalid_signature" | "missing_signature" } {
  const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.warn("GITHUB_WEBHOOK_SECRET not set — skipping signature verification");
    return { ok: true };
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
