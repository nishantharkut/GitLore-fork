/**
 * GitHub REST helpers (popup/sidepanel): all requests are proxied by the service worker.
 * @module github-api
 */

/**
 * @template T
 * @param {string} type
 * @param {Record<string, unknown>} [payload]
 * @returns {Promise<T>}
 */
function send(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response && response.ok) {
        resolve(/** @type {T} */ (response.data));
        return;
      }
      reject(new Error((response && response.error) || "Request failed"));
    });
  });
}

/**
 * Start GitHub OAuth via **device flow** (user enters code on github.com — no extension callback URL).
 * @param {(info: { user_code: string; verification_uri: string }) => void} [onDeviceCode] Called after GitHub returns the user code (show UI, open tab).
 * @returns {Promise<{ user: import('./storage.js').GitHubUser }>}
 */
export async function connectGithub(onDeviceCode) {
  const init = await send("OAUTH_DEVICE_INIT");
  onDeviceCode?.({
    user_code: init.user_code,
    verification_uri: init.verification_uri,
  });

  // GitHub tab is opened by the service worker after a short delay. Do not call
  // `chrome.tabs.create` from the popup — it closes the popup and hides the user code.
  // Token polling runs on `chrome.alarms` in the worker; we only wait for storage here.

  const deadline =
    Date.now() + Math.min((init.expires_in || 900) * 1000, 16 * 60 * 1000);

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const session = await send("GET_SESSION");
    if (session.token && session.user) {
      return { user: session.user };
    }
  }

  throw new Error("Timed out waiting for GitHub. Try Connect again.");
}

/**
 * List repositories for the signed-in user (sorted by GitHub default for /user/repos).
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export function listUserRepos() {
  return send("GITHUB_LIST_REPOS");
}

/**
 * @returns {Promise<{ token: string | null, user: import('./storage.js').GitHubUser | null, gitloreSession?: string | null }>}
 */
export function getSession() {
  return send("GET_SESSION");
}

/** @returns {Promise<{ user?: unknown }>} */
export function platformExchange() {
  return send("PLATFORM_EXCHANGE");
}

/**
 * @param {{ owner: string, name: string, branch?: string, limit?: number }} p
 */
export function platformStartRepo(p) {
  return send("PLATFORM_START_REPO", p);
}

/**
 * @param {{ owner: string, name: string }} p
 */
export function platformIngestStatus(p) {
  return send("PLATFORM_INGEST_STATUS", p);
}

/**
 * @param {{ owner: string, name: string, question: string, history?: unknown[], concise?: boolean }} p
 */
export function platformChat(p) {
  return send("PLATFORM_CHAT", { ...p, concise: p.concise !== false });
}

/**
 * @returns {Promise<void>}
 */
export function clearSession() {
  return send("CLEAR_SESSION");
}
