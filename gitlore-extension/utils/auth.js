/**
 * OAuth URL helpers for the Chrome extension (GitHub redirect parsing + CSRF state).
 * @module auth
 */

/**
 * Parse `code` and `state` from the OAuth redirect URL.
 * @param {string} urlString Full redirect URL from `launchWebAuthFlow`
 * @returns {{ code: string, state: string } | { error: string }}
 */
export function parseOAuthRedirect(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return { error: "Invalid redirect URL" };
  }
  const params = url.searchParams;
  const oauthErr = params.get("error");
  if (oauthErr) {
    const desc = params.get("error_description") || oauthErr;
    return { error: desc };
  }
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) {
    return { error: "Missing authorization code or state" };
  }
  return { code, state };
}

/**
 * Constant-time-ish compare for OAuth state (best-effort in JS).
 * @param {string | null | undefined} expected
 * @param {string | null | undefined} received
 * @returns {boolean}
 */
export function validateState(expected, received) {
  if (expected == null || received == null) return false;
  if (expected.length !== received.length) return false;
  let out = 0;
  for (let i = 0; i < expected.length; i++) {
    out |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return out === 0;
}

/**
 * @returns {string} Random URL-safe state string
 */
export function createOAuthState() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
