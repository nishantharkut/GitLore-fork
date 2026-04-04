/**
 * GitHub OAuth with PKCE. Token exchange may include optional `client_secret` (GitHub OAuth App docs).
 * @see https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
 * @module oauth-github-pkce
 */

/**
 * @param {Uint8Array} buf
 */
function base64UrlEncode(buf) {
  let bin = "";
  buf.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * @returns {string} PKCE code_verifier (43–128 chars)
 */
export function createCodeVerifier() {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * @param {string} verifier
 * @returns {Promise<string>} code_challenge (S256)
 */
export async function createCodeChallenge(verifier) {
  const enc = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * @param {string} clientId GitHub OAuth App client ID (public)
 * @param {string} redirectUri Must match OAuth app callback (e.g. https://EXT.chromiumapp.org/)
 * @param {string} state CSRF
 * @param {string} codeChallenge S256 challenge
 * @returns {string}
 */
export function buildGithubAuthorizeUrl(clientId, redirectUri, state, codeChallenge) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "repo read:user",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    allow_signup: "true",
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for access token (PKCE + optional client_secret).
 * GitHub’s docs still list `client_secret` as required for OAuth Apps; many setups
 * need it on the token POST even when PKCE was used. Never ship a secret in extension
 * source — store it only in settings (local) if you accept that risk for dev.
 * @param {string} clientId
 * @param {string} code
 * @param {string} redirectUri
 * @param {string} codeVerifier
 * @param {string} [clientSecret] If set, sent as `client_secret` (omit for PKCE-only attempts)
 * @returns {Promise<{ access_token: string } | { error: string }>}
 */
export async function exchangeGithubCode(
  clientId,
  code,
  redirectUri,
  codeVerifier,
  clientSecret
) {
  const params = new URLSearchParams({
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  const secret = (clientSecret || "").trim();
  if (secret) {
    params.set("client_secret", secret);
  }

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { error: (data && data.error_description) || data.error || `HTTP ${res.status}` };
  }
  if (data.error) {
    return { error: data.error_description || data.error };
  }
  if (!data.access_token) {
    return { error: "No access_token in GitHub response" };
  }
  return { access_token: data.access_token };
}
