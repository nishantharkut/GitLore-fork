import crypto from "crypto";

const GH_API = "https://api.github.com";

function base64url(data: Buffer | string): string {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * GitHub App JWT (RS256). Per GitHub: iat ~60s in the past for clock skew; exp − iat ≤ 10 minutes.
 */
export function generateAppJWT(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const iat = now - 60;
  const exp = iat + 600;
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iat,
      exp,
      iss: String(appId),
    })
  );
  const signingInput = `${header}.${payload}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signingInput);
  sign.end();
  const sigBuf = sign.sign(privateKeyPem);
  const signature = base64url(sigBuf);
  return `${signingInput}.${signature}`;
}

function parsePrivateKeyPem(raw: string): string {
  return raw.trim().replace(/\\n/g, "\n");
}

type InstallationTokenResponse = {
  token: string;
  expires_at: string;
};

let cachedToken: string | null = null;
let cachedExpiryMs = 0;

function clearTokenCache(): void {
  cachedToken = null;
  cachedExpiryMs = 0;
}

export function isAppConfigured(): boolean {
  const id = process.env.GITHUB_APP_ID?.trim();
  const inst = process.env.GITHUB_APP_INSTALLATION_ID?.trim();
  const key = process.env.GITHUB_APP_PRIVATE_KEY?.trim();
  return Boolean(id && inst && key);
}

/**
 * Short-lived installation access token (Bearer) for API calls as the GitHub App bot.
 */
export async function getInstallationToken(): Promise<string> {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID?.trim();
  const keyRaw = process.env.GITHUB_APP_PRIVATE_KEY?.trim();

  if (!appId || !installationId || !keyRaw) {
    throw new Error(
      "Missing GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, or GITHUB_APP_PRIVATE_KEY"
    );
  }

  const skewMs = 5 * 60 * 1000;
  if (cachedToken && cachedExpiryMs > Date.now() + skewMs) {
    return cachedToken;
  }

  const privateKeyPem = parsePrivateKeyPem(keyRaw);
  let jwt: string;
  try {
    jwt = generateAppJWT(appId, privateKeyPem);
  } catch (e) {
    clearTokenCache();
    throw new Error(
      `Failed to sign GitHub App JWT — check GITHUB_APP_PRIVATE_KEY PEM: ${e instanceof Error ? e.message : e}`
    );
  }

  const url = `${GH_API}/app/installations/${encodeURIComponent(installationId)}/access_tokens`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch (e) {
    clearTokenCache();
    throw e;
  }

  const text = await res.text();
  if (!res.ok) {
    clearTokenCache();
    if (res.status === 401) {
      throw new Error("Invalid JWT — check GITHUB_APP_ID and private key");
    }
    if (res.status === 404) {
      throw new Error("App installation not found — check GITHUB_APP_INSTALLATION_ID");
    }
    if (res.status === 403) {
      throw new Error("App doesn't have required permissions");
    }
    throw new Error(`GitHub App token request failed: ${res.status} ${text.slice(0, 240)}`);
  }

  let body: InstallationTokenResponse;
  try {
    body = JSON.parse(text) as InstallationTokenResponse;
  } catch {
    clearTokenCache();
    throw new Error("Invalid JSON from GitHub installation token endpoint");
  }

  if (!body.token || !body.expires_at) {
    clearTokenCache();
    throw new Error("GitHub installation token response missing token or expires_at");
  }

  const expMs = new Date(body.expires_at).getTime();
  if (!Number.isFinite(expMs)) {
    clearTokenCache();
    throw new Error("Invalid expires_at from GitHub installation token response");
  }

  cachedToken = body.token;
  cachedExpiryMs = expMs;
  return body.token;
}
