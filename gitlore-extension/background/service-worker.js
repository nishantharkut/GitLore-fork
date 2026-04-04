/**
 * Standalone MV3 worker: GitHub OAuth (PKCE), Git tree graph, Gemini chat. No GitLore backend required.
 */
import {
  buildGithubAuthorizeUrl,
  createCodeChallenge,
  createCodeVerifier,
  exchangeGithubCode,
} from "../utils/oauth-github-pkce.js";
import { createOAuthState, parseOAuthRedirect, validateState } from "../utils/auth.js";
import { buildRepoTreeGraph } from "../utils/github-graph.js";
import * as storage from "../utils/storage.js";
import { BUNDLED_GITHUB_OAUTH_CLIENT_ID } from "../defaults-config.js";

const OAUTH_STATE_SESSION = "oauthState";
const OAUTH_PKCE_VERIFIER = "oauthPkceVerifier";
const GEMINI_MODEL = "gemini-2.5-flash";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

/**
 * Chrome Web Store builds: pre-fill Client ID once so users skip typing it.
 * Callback URL must still be registered on that OAuth app for this extension ID (maintainer one-time step).
 */
async function seedBundledGithubOAuthClientId() {
  const bundled = (BUNDLED_GITHUB_OAUTH_CLIENT_ID || "").trim();
  if (!bundled) return;
  const s = await storage.getSettings();
  if ((s.githubOauthClientId || "").trim()) return;
  await storage.saveSettings({ githubOauthClientId: bundled });
}

chrome.runtime.onInstalled.addListener(() => {
  seedBundledGithubOAuthClientId();
});

chrome.runtime.onStartup.addListener(() => {
  seedBundledGithubOAuthClientId();
});

/**
 * @param {string} token
 */
async function fetchGithubUser(token) {
  const r = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!r.ok) {
    throw new Error(`GitHub /user failed: ${r.status}`);
  }
  return r.json();
}

/**
 * @param {string} token
 */
async function fetchAllUserRepos(token) {
  const repos = [];
  let page = 1;
  const headers = {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  while (true) {
    const url = `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`;
    const r = await fetch(url, { headers });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(t || `GitHub repos ${r.status}`);
    }
    const batch = await r.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    repos.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return repos;
}

/**
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @param {(chunk: string) => void} onText
 */
async function consumeGeminiSSE(reader, onText) {
  const dec = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") continue;
      try {
        const o = JSON.parse(payload);
        const text = o.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) onText(text);
      } catch {
        /* ignore */
      }
    }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "GITLORE_CHAT_STREAM") return;

  let started = false;
  port.onMessage.addListener((msg) => {
    if (started || !msg || msg.type !== "start" || !msg.body) return;
    started = true;

    (async () => {
      const githubToken = await storage.getGithubToken();
      if (!githubToken) {
        port.postMessage({ type: "error", message: "Not signed in to GitHub" });
        port.disconnect();
        return;
      }
      const settings = await storage.getSettings();
      const apiKey = (settings.geminiApiKey || "").trim();
      if (!apiKey) {
        port.postMessage({
          type: "error",
          message: "Add a Google Gemini API key in the popup settings to use chat.",
        });
        port.disconnect();
        return;
      }

      const { repoFullName, message, chatHistory } = msg.body;
      const ctxStored = await storage.getChatContext(repoFullName);
      const fileList = Array.isArray(ctxStored?.filePaths)
        ? ctxStored.filePaths.join("\n")
        : "(build the graph first for richer context)";
      const readme = typeof ctxStored?.readmeSnippet === "string" ? ctxStored.readmeSnippet : "";
      const branch = typeof ctxStored?.branch === "string" ? ctxStored.branch : "main";

      const systemText = `You are GitLore, helping a developer understand a GitHub repository.
Repository: ${repoFullName} (branch: ${branch})
You only use the file list and README excerpt below plus the conversation. If information is missing, say so.

File paths (sample):
${fileList.slice(0, 24000)}

README excerpt:
${readme.slice(0, 12000)}`;

      const contents = [];
      const prior = Array.isArray(chatHistory) ? chatHistory : [];
      for (const m of prior) {
        const o = /** @type {{ role?: string, content?: string }} */ (m);
        if (!o.role || !o.content) continue;
        const role = o.role === "assistant" ? "model" : "user";
        contents.push({ role, parts: [{ text: o.content }] });
      }
      contents.push({ role: "user", parts: [{ text: message }] });

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

      let res;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemText }] },
            contents,
            generationConfig: { temperature: 0.35, maxOutputTokens: 8192 },
          }),
        });
      } catch (e) {
        port.postMessage({
          type: "error",
          message: e instanceof Error ? e.message : "Network error",
        });
        port.disconnect();
        return;
      }

      if (!res.ok) {
        const errText = await res.text();
        port.postMessage({
          type: "error",
          message: errText.slice(0, 800) || `Gemini HTTP ${res.status}`,
        });
        port.disconnect();
        return;
      }

      if (!res.body) {
        port.postMessage({ type: "error", message: "Empty Gemini response" });
        port.disconnect();
        return;
      }

      try {
        await consumeGeminiSSE(res.body.getReader(), (t) => {
          port.postMessage({ type: "chunk", text: t });
        });
        port.postMessage({ type: "done" });
      } catch (e) {
        port.postMessage({
          type: "error",
          message: e instanceof Error ? e.message : "Stream error",
        });
      }
    })();
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message || {};

  (async () => {
    try {
      switch (type) {
        case "GET_SESSION": {
          const token = await storage.getGithubToken();
          const user = await storage.getGithubUser();
          sendResponse({ ok: true, data: { token, user } });
          break;
        }
        case "CLEAR_SESSION": {
          await storage.clearSession();
          sendResponse({ ok: true, data: undefined });
          break;
        }
        case "OAUTH_START": {
          const settings = await storage.getSettings();
          const clientId = (settings.githubOauthClientId || "").trim();
          if (!clientId) {
            sendResponse({
              ok: false,
              error: "Add your GitHub OAuth App Client ID in the popup settings (public ID, not a secret).",
            });
            break;
          }
          const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
          const state = createOAuthState();
          const codeVerifier = createCodeVerifier();
          const codeChallenge = await createCodeChallenge(codeVerifier);
          await chrome.storage.session.set({
            [OAUTH_STATE_SESSION]: state,
            [OAUTH_PKCE_VERIFIER]: codeVerifier,
          });
          const authUrl = buildGithubAuthorizeUrl(clientId, redirectUri, state, codeChallenge);

          let redirect;
          try {
            redirect = await new Promise((resolve, reject) => {
              chrome.identity.launchWebAuthFlow(
                { url: authUrl, interactive: true },
                (responseUrl) => {
                  if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                  }
                  resolve(responseUrl);
                }
              );
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const hint =
              msg.includes("could not be loaded") || msg.includes("Authorization page")
                ? " Ensure https://github.com/* is allowed and the OAuth callback URL in GitHub matches https://YOUR_EXTENSION_ID.chromiumapp.org/"
                : "";
            sendResponse({ ok: false, error: `${msg}${hint}` });
            break;
          }

          if (!redirect) {
            sendResponse({ ok: false, error: "Authorization was cancelled" });
            break;
          }

          const parsed = parseOAuthRedirect(redirect);
          if ("error" in parsed) {
            sendResponse({ ok: false, error: parsed.error });
            break;
          }

          const sess = await chrome.storage.session.get([
            OAUTH_STATE_SESSION,
            OAUTH_PKCE_VERIFIER,
          ]);
          const expected = sess[OAUTH_STATE_SESSION];
          const verifier = sess[OAUTH_PKCE_VERIFIER];
          await chrome.storage.session.remove([OAUTH_STATE_SESSION, OAUTH_PKCE_VERIFIER]);

          if (!validateState(expected, parsed.state)) {
            sendResponse({ ok: false, error: "Invalid OAuth state (possible CSRF)" });
            break;
          }
          if (!verifier) {
            sendResponse({ ok: false, error: "Missing PKCE verifier" });
            break;
          }

          const clientSecret = (settings.githubOauthClientSecret || "").trim();
          const exchanged = await exchangeGithubCode(
            clientId,
            parsed.code,
            redirectUri,
            verifier,
            clientSecret
          );
          if ("error" in exchanged) {
            sendResponse({ ok: false, error: exchanged.error });
            break;
          }

          const u = await fetchGithubUser(exchanged.access_token);
          await storage.setGithubToken(exchanged.access_token);
          await storage.setGithubUser({
            login: u.login,
            id: u.id,
            avatar_url: u.avatar_url,
            name: u.name,
          });
          sendResponse({
            ok: true,
            data: { user: await storage.getGithubUser() },
          });
          break;
        }
        case "GITHUB_LIST_REPOS": {
          const token = await storage.getGithubToken();
          if (!token) {
            sendResponse({ ok: false, error: "Not signed in" });
            break;
          }
          const repos = await fetchAllUserRepos(token);
          sendResponse({ ok: true, data: repos });
          break;
        }
        case "BUILD_GRAPH": {
          const token = await storage.getGithubToken();
          if (!token) {
            sendResponse({ ok: false, error: "Not signed in" });
            break;
          }
          const repoFullName = payload && payload.repoFullName;
          const branch = (payload && payload.branch) || "main";
          if (!repoFullName || typeof repoFullName !== "string") {
            sendResponse({ ok: false, error: "Missing repoFullName" });
            break;
          }
          const slash = repoFullName.indexOf("/");
          if (slash < 1) {
            sendResponse({ ok: false, error: "Invalid repo (expected owner/name)" });
            break;
          }
          const owner = repoFullName.slice(0, slash);
          const name = repoFullName.slice(slash + 1);
          try {
            const { nodes, edges, filePaths, readmeSnippet } = await buildRepoTreeGraph(
              owner,
              name,
              branch,
              token
            );
            const graphData = { nodes, edges };
            await storage.setCachedGraph(repoFullName, { graphData, updatedAt: Date.now() });
            await storage.setChatContext(repoFullName, {
              filePaths,
              readmeSnippet,
              branch,
            });
            sendResponse({ ok: true, data: { graphData, fileCount: filePaths.length } });
          } catch (e) {
            sendResponse({
              ok: false,
              error: e instanceof Error ? e.message : "Failed to build graph",
            });
          }
          break;
        }
        default:
          sendResponse({ ok: false, error: `Unknown message: ${type}` });
      }
    } catch (e) {
      sendResponse({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  })();

  return true;
});
