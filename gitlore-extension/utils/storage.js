/**
 * Typed wrappers around `chrome.storage.local` for GitLore extension state.
 * Standalone mode: GitHub token + optional Gemini API key (no GitLore backend).
 * @module storage
 */

/** @typedef {{ login: string, id?: number, avatar_url?: string, name?: string }} GitHubUser */

/**
 * @typedef {Object} ExtensionSettings
 * @property {string} [githubOauthClientId] GitHub OAuth App client ID (public; required for Connect)
 * @property {string} [githubOauthClientSecret] OAuth client secret (optional; token exchange only; do not commit)
 * @property {string} [geminiApiKey] Google AI Studio key for standalone chat (optional)
 * @property {string} [gitloreBackendUrl] GitLore API base URL, e.g. http://localhost:3001 — enables platform ingest + chat
 */

const DEFAULT_SETTINGS = {
  githubOauthClientId: "",
  githubOauthClientSecret: "",
  geminiApiKey: "",
  gitloreBackendUrl: "",
};

const STORAGE_KEYS = {
  GITHUB_TOKEN: "githubAccessToken",
  GITHUB_USER: "githubUser",
  GITLORE_SESSION: "gitloreSessionToken",
  SETTINGS: "gitloreSettings",
  CHAT_PREFIX: "chat:",
  GRAPH_PREFIX: "graph:",
  CHAT_CONTEXT_PREFIX: "chatContext:",
};

/**
 * @returns {Promise<ExtensionSettings>}
 */
export async function getSettings() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const raw = data[STORAGE_KEYS.SETTINGS];
  const r = typeof raw === "object" && raw ? raw : {};
  return {
    githubOauthClientId:
      typeof r.githubOauthClientId === "string" ? r.githubOauthClientId : DEFAULT_SETTINGS.githubOauthClientId,
    githubOauthClientSecret:
      typeof r.githubOauthClientSecret === "string"
        ? r.githubOauthClientSecret
        : DEFAULT_SETTINGS.githubOauthClientSecret,
    geminiApiKey: typeof r.geminiApiKey === "string" ? r.geminiApiKey : DEFAULT_SETTINGS.geminiApiKey,
    gitloreBackendUrl:
      typeof r.gitloreBackendUrl === "string" ? r.gitloreBackendUrl : DEFAULT_SETTINGS.gitloreBackendUrl,
  };
}

/**
 * @param {Partial<ExtensionSettings>} patch
 * @returns {Promise<void>}
 */
export async function saveSettings(patch) {
  const cur = await getSettings();
  await chrome.storage.local.set({
    [STORAGE_KEYS.SETTINGS]: {
      githubOauthClientId:
        typeof patch.githubOauthClientId === "string"
          ? patch.githubOauthClientId.trim()
          : cur.githubOauthClientId,
      githubOauthClientSecret:
        typeof patch.githubOauthClientSecret === "string"
          ? patch.githubOauthClientSecret.trim()
          : cur.githubOauthClientSecret,
      geminiApiKey:
        typeof patch.geminiApiKey === "string" ? patch.geminiApiKey.trim() : cur.geminiApiKey,
      gitloreBackendUrl:
        typeof patch.gitloreBackendUrl === "string"
          ? patch.gitloreBackendUrl.trim().replace(/\/$/, "")
          : cur.gitloreBackendUrl,
    },
  });
}

/**
 * @returns {Promise<string | null>}
 */
export async function getGithubToken() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.GITHUB_TOKEN);
  const t = data[STORAGE_KEYS.GITHUB_TOKEN];
  return typeof t === "string" && t.length > 0 ? t : null;
}

/**
 * @param {string | null} token
 * @returns {Promise<void>}
 */
export async function setGithubToken(token) {
  if (token == null || token === "") {
    await chrome.storage.local.remove(STORAGE_KEYS.GITHUB_TOKEN);
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.GITHUB_TOKEN]: token });
}

/**
 * @returns {Promise<GitHubUser | null>}
 */
export async function getGithubUser() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.GITHUB_USER);
  const u = data[STORAGE_KEYS.GITHUB_USER];
  return u && typeof u === "object" ? /** @type {GitHubUser} */ (u) : null;
}

/**
 * @param {GitHubUser | null} user
 * @returns {Promise<void>}
 */
export async function setGithubUser(user) {
  if (!user) {
    await chrome.storage.local.remove(STORAGE_KEYS.GITHUB_USER);
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.GITHUB_USER]: user });
}

/**
 * @returns {Promise<string | null>}
 */
export async function getGitloreSession() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.GITLORE_SESSION);
  const t = data[STORAGE_KEYS.GITLORE_SESSION];
  return typeof t === "string" && t.length > 0 ? t : null;
}

/**
 * @param {string | null} token
 * @returns {Promise<void>}
 */
export async function setGitloreSession(token) {
  if (token == null || token === "") {
    await chrome.storage.local.remove(STORAGE_KEYS.GITLORE_SESSION);
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.GITLORE_SESSION]: token });
}

/**
 * Clears GitHub token, profile, and GitLore server session.
 * @returns {Promise<void>}
 */
export async function clearSession() {
  await chrome.storage.local.remove([
    STORAGE_KEYS.GITHUB_TOKEN,
    STORAGE_KEYS.GITHUB_USER,
    STORAGE_KEYS.GITLORE_SESSION,
  ]);
}

/**
 * Cache for Gemini chat context (file list + readme) after building a graph.
 * @param {string} repoFullName
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function getChatContext(repoFullName) {
  const key = `${STORAGE_KEYS.CHAT_CONTEXT_PREFIX}${repoFullName}`;
  const data = await chrome.storage.local.get(key);
  const v = data[key];
  return v && typeof v === "object" ? /** @type {Record<string, unknown>} */ (v) : null;
}

/**
 * @param {string} repoFullName
 * @param {Record<string, unknown>} ctx
 * @returns {Promise<void>}
 */
export async function setChatContext(repoFullName, ctx) {
  const key = `${STORAGE_KEYS.CHAT_CONTEXT_PREFIX}${repoFullName}`;
  await chrome.storage.local.set({ [key]: ctx });
}

/**
 * @param {string} repoFullName
 * @returns {Promise<unknown[] | null>}
 */
export async function getChatHistory(repoFullName) {
  const key = `${STORAGE_KEYS.CHAT_PREFIX}${repoFullName}`;
  const data = await chrome.storage.local.get(key);
  const h = data[key];
  return Array.isArray(h) ? h : null;
}

/**
 * @param {string} repoFullName
 * @param {unknown[]} messages
 * @returns {Promise<void>}
 */
export async function setChatHistory(repoFullName, messages) {
  const key = `${STORAGE_KEYS.CHAT_PREFIX}${repoFullName}`;
  await chrome.storage.local.set({ [key]: messages });
}

/**
 * @param {string} repoFullName
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function getCachedGraph(repoFullName) {
  const key = `${STORAGE_KEYS.GRAPH_PREFIX}${repoFullName}`;
  const data = await chrome.storage.local.get(key);
  const g = data[key];
  return g && typeof g === "object" ? /** @type {Record<string, unknown>} */ (g) : null;
}

/**
 * @param {string} repoFullName
 * @param {Record<string, unknown>} graphPayload
 * @returns {Promise<void>}
 */
export async function setCachedGraph(repoFullName, graphPayload) {
  const key = `${STORAGE_KEYS.GRAPH_PREFIX}${repoFullName}`;
  await chrome.storage.local.set({ [key]: graphPayload });
}

export { STORAGE_KEYS, DEFAULT_SETTINGS };
