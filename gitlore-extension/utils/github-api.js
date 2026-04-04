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
 * Start GitHub OAuth via the service worker (`launchWebAuthFlow`).
 * @returns {Promise<{ user: import('./storage.js').GitHubUser }>}
 */
export function connectGithub() {
  return send("OAUTH_START");
}

/**
 * List repositories for the signed-in user (sorted by GitHub default for /user/repos).
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export function listUserRepos() {
  return send("GITHUB_LIST_REPOS");
}

/**
 * @returns {Promise<{ token: string | null, user: import('./storage.js').GitHubUser | null }>}
 */
export function getSession() {
  return send("GET_SESSION");
}

/**
 * @returns {Promise<void>}
 */
export function clearSession() {
  return send("CLEAR_SESSION");
}

