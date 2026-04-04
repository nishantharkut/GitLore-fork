/**
 * GitHub OAuth Device Flow — no browser redirect / chromiumapp.org callback.
 * @see https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 */

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";

/**
 * @param {string} clientId
 * @param {string} [scope]
 * @returns {Promise<{
 *   device_code: string;
 *   user_code: string;
 *   verification_uri: string;
 *   expires_in: number;
 *   interval: number;
 * }>}
 */
export async function requestDeviceCode(clientId, scope = "repo read:user") {
  const body = new URLSearchParams({
    client_id: clientId.trim(),
    scope: scope.trim(),
  });
  const r = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await r.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 200) || `Device code request failed (${r.status})`);
  }
  if (j.error) {
    throw new Error(j.error_description || j.error);
  }
  if (!j.device_code || !j.user_code) {
    throw new Error("Invalid device code response from GitHub");
  }
  return {
    device_code: j.device_code,
    user_code: j.user_code,
    verification_uri: j.verification_uri || "https://github.com/login/device",
    expires_in: typeof j.expires_in === "number" ? j.expires_in : 900,
    interval: typeof j.interval === "number" ? j.interval : 5,
  };
}

/**
 * @param {string} clientId
 * @param {string} deviceCode
 * @param {string} [clientSecret]
 * @returns {Promise<
 *   | { access_token: string; scope?: string }
 *   | { pending: true }
 *   | { slow_down: true }
 *   | { error: string }
 * >}
 */
export async function exchangeDeviceCode(clientId, deviceCode, clientSecret) {
  const body = new URLSearchParams({
    client_id: clientId.trim(),
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });
  const sec = (clientSecret || "").trim();
  if (sec) body.set("client_secret", sec);

  const r = await fetch(ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await r.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return { error: text.slice(0, 200) || `Token request failed (${r.status})` };
  }

  if (j.access_token) {
    return { access_token: j.access_token, scope: j.scope };
  }
  if (j.error === "authorization_pending") {
    return { pending: true };
  }
  if (j.error === "slow_down") {
    return { slow_down: true };
  }
  if (j.error) {
    return { error: j.error_description || j.error };
  }
  return { error: "Unexpected token response" };
}
