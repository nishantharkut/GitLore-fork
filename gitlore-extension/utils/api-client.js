/**
 * Service worker APIs: local graph build, Gemini chat stream.
 * @module api-client
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
 * Build a repo file-tree graph via GitHub API (no backend).
 * @param {{ repoFullName: string, branch?: string }} p
 * @returns {Promise<{ graphData: { nodes: unknown[], edges: unknown[] }, fileCount: number }>}
 */
export function buildLocalGraph(p) {
  return send("BUILD_GRAPH", p);
}

/**
 * Connect a port for Gemini streaming chat (service worker).
 * @param {{ repoFullName: string, message: string, chatHistory: unknown[] }} body
 * @returns {chrome.runtime.Port}
 */
export function connectChatStream(body) {
  const port = chrome.runtime.connect({ name: "GITLORE_CHAT_STREAM" });
  queueMicrotask(() => {
    port.postMessage({ type: "start", body });
  });
  return port;
}
