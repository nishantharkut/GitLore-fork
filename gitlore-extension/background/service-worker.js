/**
 * Standalone MV3 worker: GitHub OAuth (device flow), Git tree graph, Gemini chat. No GitLore backend required.
 */
import { requestDeviceCode, exchangeDeviceCode } from "../utils/oauth-github-device.js";
import { buildRepoTreeGraph } from "../utils/github-graph.js";
import * as storage from "../utils/storage.js";
import { BUNDLED_GITHUB_OAUTH_CLIENT_ID } from "../defaults-config.js";
import { normalizeBackendBase } from "../utils/gitlore-platform.js";

const SIDE_PANEL_REPO_SESSION_KEY = "sidePanelRepo";

const OAUTH_DEVICE_CODE = "oauthDeviceCode";
const OAUTH_DEVICE_CLIENT_ID = "oauthDeviceClientId";
const OAUTH_DEVICE_SECRET = "oauthDeviceSecret";
const OAUTH_DEVICE_INTERVAL_MS = "oauthDeviceIntervalMs";
const OAUTH_DEVICE_EXPIRES_AT = "oauthDeviceExpiresAt";
/** Shown again if the popup closed before the user could read the code. */
const OAUTH_USER_CODE = "oauthUserCode";
const ALARM_OAUTH_DEVICE_POLL = "gitloreOAuthDevicePoll";

const GEMINI_MODEL = "gemini-2.5-flash";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

/**
 * Chrome Web Store builds: pre-fill Client ID once so users skip typing it.
 * Sign-in uses GitHub Device Flow (no extension callback URL).
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

async function clearOAuthDeviceSession() {
  await chrome.alarms.clear(ALARM_OAUTH_DEVICE_POLL);
  await chrome.storage.session.remove([
    OAUTH_DEVICE_CODE,
    OAUTH_DEVICE_CLIENT_ID,
    OAUTH_DEVICE_SECRET,
    OAUTH_DEVICE_INTERVAL_MS,
    OAUTH_DEVICE_EXPIRES_AT,
    OAUTH_USER_CODE,
  ]);
}

function scheduleOAuthDevicePollAlarm(delayMs) {
  const ms = Math.max(delayMs, 5000);
  return chrome.alarms.create(ALARM_OAUTH_DEVICE_POLL, {
    delayInMinutes: ms / 60000,
  });
}

/**
 * One token poll step (shared by popup messages and `alarms` so auth completes after the popup closes).
 * @returns {Promise<
 *   | { kind: "none" }
 *   | { kind: "expired" }
 *   | { kind: "pending"; nextMs: number }
 *   | { kind: "slow_down"; nextMs: number }
 *   | { kind: "error"; message: string }
 *   | { kind: "success"; user: Awaited<ReturnType<typeof storage.getGithubUser>> }
 * >}
 */
async function runOAuthDevicePollStep() {
  const sess = await chrome.storage.session.get([
    OAUTH_DEVICE_CODE,
    OAUTH_DEVICE_CLIENT_ID,
    OAUTH_DEVICE_SECRET,
    OAUTH_DEVICE_INTERVAL_MS,
    OAUTH_DEVICE_EXPIRES_AT,
  ]);
  const deviceCode = sess[OAUTH_DEVICE_CODE];
  const clientId = sess[OAUTH_DEVICE_CLIENT_ID];
  const clientSecret = sess[OAUTH_DEVICE_SECRET] || "";
  if (!deviceCode || !clientId) {
    return { kind: "none" };
  }
  const expiresAt = sess[OAUTH_DEVICE_EXPIRES_AT] || 0;
  if (Date.now() > expiresAt) {
    await clearOAuthDeviceSession();
    return { kind: "expired" };
  }

  const exchanged = await exchangeDeviceCode(
    clientId,
    deviceCode,
    clientSecret
  );

  if ("pending" in exchanged && exchanged.pending) {
    const nextMs = sess[OAUTH_DEVICE_INTERVAL_MS] || 5000;
    return { kind: "pending", nextMs };
  }
  if ("slow_down" in exchanged && exchanged.slow_down) {
    const cur = sess[OAUTH_DEVICE_INTERVAL_MS] || 5000;
    const nextMs = cur + 5000;
    await chrome.storage.session.set({
      [OAUTH_DEVICE_INTERVAL_MS]: nextMs,
    });
    return { kind: "slow_down", nextMs };
  }
  if ("error" in exchanged && exchanged.error) {
    await clearOAuthDeviceSession();
    return { kind: "error", message: exchanged.error };
  }
  if (!("access_token" in exchanged) || !exchanged.access_token) {
    await clearOAuthDeviceSession();
    return { kind: "error", message: "No access token from GitHub" };
  }

  await clearOAuthDeviceSession();

  const u = await fetchGithubUser(exchanged.access_token);
  await storage.setGithubToken(exchanged.access_token);
  await storage.setGithubUser({
    login: u.login,
    id: u.id,
    avatar_url: u.avatar_url,
    name: u.name,
  });
  return {
    kind: "success",
    user: await storage.getGithubUser(),
  };
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_OAUTH_DEVICE_POLL) return;
  const result = await runOAuthDevicePollStep();
  if (result.kind === "pending" || result.kind === "slow_down") {
    await scheduleOAuthDevicePollAlarm(result.nextMs);
  }
});

/**
 * @param {string} baseUrl
 * @param {string} gitloreSession
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function platformApiFetch(baseUrl, gitloreSession, path, init = {}) {
  const base = normalizeBackendBase(baseUrl);
  if (!base) throw new Error("GitLore backend URL is not set");
  if (!gitloreSession) throw new Error("Not linked to GitLore server — sign in with GitHub again");
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${gitloreSession}`);
  }
  const r = await fetch(url, { ...init, headers });
  const text = await r.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 280) || `HTTP ${r.status}`);
  }
  if (!r.ok) {
    const msg = typeof j.error === "string" ? j.error : `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return j;
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
          const gitloreSession = await storage.getGitloreSession();
          sendResponse({ ok: true, data: { token, user, gitloreSession } });
          break;
        }
        case "PLATFORM_EXCHANGE": {
          const settings = await storage.getSettings();
          const base = normalizeBackendBase(settings.gitloreBackendUrl);
          if (!base) {
            sendResponse({
              ok: false,
              error: "Set GitLore backend URL in extension Settings.",
            });
            break;
          }
          const githubToken = await storage.getGithubToken();
          if (!githubToken) {
            sendResponse({ ok: false, error: "Sign in with GitHub first." });
            break;
          }
          try {
            const r = await fetch(`${base}/auth/github/exchange-token`, {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ github_access_token: githubToken }),
            });
            const text = await r.text();
            let j;
            try {
              j = JSON.parse(text);
            } catch {
              throw new Error(text.slice(0, 240) || `HTTP ${r.status}`);
            }
            if (!r.ok) {
              throw new Error(
                typeof j.error === "string" ? j.error : `HTTP ${r.status}`
              );
            }
            const session = typeof j.session === "string" ? j.session : "";
            if (!session) {
              throw new Error("No session in server response");
            }
            await storage.setGitloreSession(session);
            sendResponse({ ok: true, data: { user: j.user } });
          } catch (e) {
            sendResponse({
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            });
          }
          break;
        }
        case "PLATFORM_START_REPO": {
          const owner = payload && payload.owner;
          const name = payload && payload.name;
          const branch =
            (payload && typeof payload.branch === "string" && payload.branch) ||
            "main";
          if (!owner || !name || typeof owner !== "string" || typeof name !== "string") {
            sendResponse({ ok: false, error: "Missing repository owner or name." });
            break;
          }
          const settings = await storage.getSettings();
          const base = normalizeBackendBase(settings.gitloreBackendUrl);
          const glSession = await storage.getGitloreSession();
          if (!base) {
            sendResponse({
              ok: false,
              error: "Set GitLore backend URL in Settings.",
            });
            break;
          }
          if (!glSession) {
            sendResponse({
              ok: false,
              error: "Link to GitLore server: set backend URL, Save, sign in with GitHub.",
            });
            break;
          }
          try {
            await chrome.storage.session.set({
              [SIDE_PANEL_REPO_SESSION_KEY]: {
                repoFullName: `${owner}/${name}`,
                defaultBranch: branch,
              },
            });
            const limit = Math.min(
              Math.max(Number(payload && payload.limit) || 30, 1),
              50
            );
            const ing = await platformApiFetch(
              base,
              glSession,
              `/api/repo/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/ingest`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ limit }),
              }
            );
            sendResponse({ ok: true, data: ing });
          } catch (e) {
            sendResponse({
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            });
          }
          break;
        }
        case "PLATFORM_INGEST_STATUS": {
          const owner = payload && payload.owner;
          const name = payload && payload.name;
          if (!owner || !name) {
            sendResponse({ ok: false, error: "Missing owner or name." });
            break;
          }
          const settings = await storage.getSettings();
          const base = normalizeBackendBase(settings.gitloreBackendUrl);
          const glSession = await storage.getGitloreSession();
          if (!base || !glSession) {
            sendResponse({ ok: false, error: "Backend or session not configured." });
            break;
          }
          try {
            const st = await platformApiFetch(
              base,
              glSession,
              `/api/repo/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/ingest/status`
            );
            sendResponse({ ok: true, data: st });
          } catch (e) {
            sendResponse({
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            });
          }
          break;
        }
        case "PLATFORM_CHAT": {
          const owner = payload && payload.owner;
          const name = payload && payload.name;
          const question = payload && payload.question;
          const history = (payload && payload.history) || [];
          if (!owner || !name || typeof question !== "string") {
            sendResponse({ ok: false, error: "Missing chat parameters." });
            break;
          }
          const settings = await storage.getSettings();
          const base = normalizeBackendBase(settings.gitloreBackendUrl);
          const glSession = await storage.getGitloreSession();
          if (!base || !glSession) {
            sendResponse({ ok: false, error: "Backend or session not configured." });
            break;
          }
          try {
            const out = await platformApiFetch(
              base,
              glSession,
              `/api/repo/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/chat`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                question,
                history,
                concise: !!(payload && payload.concise),
              }),
              }
            );
            sendResponse({ ok: true, data: out });
          } catch (e) {
            sendResponse({
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            });
          }
          break;
        }
        case "CLEAR_SESSION": {
          await storage.clearSession();
          await clearOAuthDeviceSession();
          sendResponse({ ok: true, data: undefined });
          break;
        }
        case "OAUTH_DEVICE_INIT": {
          const settings = await storage.getSettings();
          const clientId = (settings.githubOauthClientId || "").trim();
          if (!clientId) {
            sendResponse({
              ok: false,
              error: "Add your GitHub OAuth App Client ID in Settings (public ID).",
            });
            break;
          }
          try {
            const dc = await requestDeviceCode(clientId);
            const intervalMs = Math.max(dc.interval * 1000, 5000);
            const expiresAt = Date.now() + dc.expires_in * 1000;
            const clientSecret = (settings.githubOauthClientSecret || "").trim();
            const verificationUri =
              dc.verification_uri || "https://github.com/login/device";
            await chrome.storage.session.set({
              [OAUTH_DEVICE_CODE]: dc.device_code,
              [OAUTH_DEVICE_CLIENT_ID]: clientId,
              [OAUTH_DEVICE_SECRET]: clientSecret,
              [OAUTH_DEVICE_INTERVAL_MS]: intervalMs,
              [OAUTH_DEVICE_EXPIRES_AT]: expiresAt,
              [OAUTH_USER_CODE]: dc.user_code,
            });
            await chrome.alarms.clear(ALARM_OAUTH_DEVICE_POLL);
            await scheduleOAuthDevicePollAlarm(intervalMs);
            setTimeout(() => {
              chrome.tabs.create({ url: verificationUri }).catch(() => {});
            }, 450);
            sendResponse({
              ok: true,
              data: {
                user_code: dc.user_code,
                verification_uri: verificationUri,
                interval: dc.interval,
                expires_in: dc.expires_in,
              },
            });
          } catch (e) {
            sendResponse({
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            });
          }
          break;
        }
        case "OAUTH_DEVICE_POLL": {
          const result = await runOAuthDevicePollStep();
          if (result.kind === "none") {
            sendResponse({
              ok: false,
              error: "No device authorization in progress. Click Connect again.",
            });
            break;
          }
          if (result.kind === "expired") {
            sendResponse({
              ok: false,
              error: "Device code expired. Click Connect again.",
            });
            break;
          }
          if (result.kind === "pending") {
            sendResponse({ ok: true, data: { pending: true } });
            break;
          }
          if (result.kind === "slow_down") {
            sendResponse({ ok: true, data: { slow_down: true } });
            break;
          }
          if (result.kind === "error") {
            sendResponse({ ok: false, error: result.message });
            break;
          }
          sendResponse({ ok: true, data: { user: result.user } });
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
