/**
 * Popup UI: OAuth settings, GitHub connect, repo list, open side panel.
 */
import { BUNDLED_GITHUB_OAUTH_CLIENT_ID } from "../defaults-config.js";
import * as storage from "../utils/storage.js";
import * as githubApi from "../utils/github-api.js";
import { parseGithubRepoFromUrl } from "../utils/gitlore-platform.js";

const $ = (id) => document.getElementById(id);

const loginSection = $("loginSection");
const repoSection = $("repoSection");
const userRow = $("userRow");
const avatar = $("avatar");
const username = $("username");
const connectBtn = $("connectBtn");
const logoutBtn = $("logoutBtn");
const toggleSettings = $("toggleSettings");
const toggleSettingsHeader = $("toggleSettingsHeader");
const settingsPanel = $("settingsPanel");
const repoSearch = $("repoSearch");
const repoList = $("repoList");
const repoSkeleton = $("repoSkeleton");
const repoError = $("repoError");
const githubOauthClientId = $("githubOauthClientId");
const githubOauthClientSecret = $("githubOauthClientSecret");
const geminiApiKey = $("geminiApiKey");
const gitloreBackendUrl = $("gitloreBackendUrl");
const deviceFlowBanner = $("deviceFlowBanner");
const deviceFlowCode = $("deviceFlowCode");
const copyDeviceCodeBtn = $("copyDeviceCodeBtn");
/** @type {string} */
let lastShownDeviceUserCode = "";
const saveSettings = $("saveSettings");
const settingsError = $("settingsError");
const loginError = $("loginError");
const setupHint = $("setupHint");
const openGithubOAuthApps = $("openGithubOAuthApps");
const openNewGithubOAuth = $("openNewGithubOAuth");
const geminiBanner = $("geminiBanner");
const openSettingsForGemini = $("openSettingsForGemini");
const openSidePanelBtn = $("openSidePanelBtn");
const indexCurrentTabBtn = $("indexCurrentTabBtn");

/** Same key as `SIDE_PANEL_CTX` in the service worker — repo context for the side panel. */
const SIDE_PANEL_REPO_KEY = "sidePanelRepo";

/**
 * Open the side panel on a real browser window. `chrome.windows.WINDOW_ID_CURRENT` from the
 * extension popup often points at the wrong surface, so `sidePanel.open` does nothing visible.
 */
function openGitLoreSidePanel() {
  return new Promise((resolve, reject) => {
    chrome.windows.getAll({ populate: true }, (windows) => {
      const err = chrome.runtime.lastError?.message;
      if (err) {
        reject(new Error(err));
        return;
      }
      const normal = (windows || []).filter((w) => w.type === "normal");
      const focused = normal.find((w) => w.focused);
      const win = focused || normal[0];
      if (!win || win.id == null) {
        reject(
          new Error(
            "No normal browser window found. Open a regular Chrome window and try again."
          )
        );
        return;
      }
      const active = win.tabs?.find((t) => t.active);
      const open =
        active?.id != null
          ? chrome.sidePanel.open({ tabId: active.id })
          : chrome.sidePanel.open({ windowId: win.id });
      open.then(resolve).catch(reject);
    });
  });
}

/** @type {Array<Record<string, unknown>>} */
let allRepos = [];

/** Notify tabs (floating GitLore button) that sign-in state changed. */
function broadcastGitloreSessionToTabs() {
  try {
    chrome.tabs.query({}, (tabs) => {
      for (const t of tabs) {
        if (t.id != null) {
          chrome.tabs.sendMessage(t.id, { type: "GITLORE_SESSION_CHANGED" }).catch(() => {});
        }
      }
    });
  } catch {
    /* ignore */
  }
}

function showError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideError(el) {
  if (el) el.classList.add("hidden");
}

/**
 * Optional host access for local GitLore API (narrower than always-on localhost in manifest).
 * @param {string} backendUrl
 * @returns {Promise<boolean>} false if user denied or URL is invalid for localhost check
 */
async function ensureLocalhostBackendPermission(backendUrl) {
  const t = (backendUrl || "").trim();
  if (!t) return true;
  let hostname = "";
  try {
    hostname = new URL(t).hostname.toLowerCase();
  } catch {
    return true;
  }
  if (hostname !== "localhost" && hostname !== "127.0.0.1") return true;
  return chrome.permissions.request({
    origins: ["http://localhost/*", "http://127.0.0.1/*"],
  });
}

function formatDate(iso) {
  if (!iso || typeof iso !== "string") return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "—";
  }
}

function renderRepos(filter) {
  repoList.innerHTML = "";
  const q = (filter || "").trim().toLowerCase();
  const items = allRepos.filter((r) => {
    const name = String(r.full_name || r.name || "");
    return !q || name.toLowerCase().includes(q);
  });

  for (const r of items) {
    const fullName = String(r.full_name || "");
    const vis = r.private ? "private" : "public";
    const lang = r.language ? String(r.language) : "—";
    const updated = formatDate(r.updated_at);

    const li = document.createElement("li");
    li.className = "repo-item";
    li.innerHTML = `
      <div class="repo-row">
        <div>
          <div class="repo-name">${escapeHtml(fullName)}</div>
          <div class="repo-meta">${escapeHtml(
            `${updated} · ${lang}`
          )}</div>
        </div>
        <span class="badge badge-${vis}">${vis}</span>
      </div>
      <button type="button" class="btn-analyze" data-repo="${escapeHtml(
        fullName
      )}" data-branch="${escapeHtml(String(r.default_branch || "main"))}">
        Analyze with GitLore
      </button>
    `;
    repoList.appendChild(li);
  }

  repoList.querySelectorAll(".btn-analyze").forEach((btn) => {
    btn.addEventListener("click", () => {
      const repoFullName = btn.getAttribute("data-repo");
      const branch = btn.getAttribute("data-branch") || "main";
      if (!repoFullName) return;
      hideError(repoError);
      chrome.storage.session.set(
        {
          [SIDE_PANEL_REPO_KEY]: {
            repoFullName,
            defaultBranch: branch,
          },
        },
        () => {
          openGitLoreSidePanel().catch((e) => {
            showError(
              repoError,
              e instanceof Error ? e.message : "Could not open side panel"
            );
          });
        }
      );
    });
  });
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setDeviceFlowVisible(visible, userCode) {
  if (!deviceFlowBanner || !deviceFlowCode) return;
  if (visible && userCode) {
    lastShownDeviceUserCode = userCode;
    deviceFlowCode.textContent = userCode;
    deviceFlowBanner.classList.remove("hidden");
  } else {
    lastShownDeviceUserCode = "";
    deviceFlowBanner.classList.add("hidden");
    deviceFlowCode.textContent = "";
  }
}

const OAUTH_USER_CODE_KEY = "oauthUserCode";

async function syncDeviceFlowBannerFromSession() {
  try {
    const sess = await chrome.storage.session.get(OAUTH_USER_CODE_KEY);
    const code = sess[OAUTH_USER_CODE_KEY];
    const session = await githubApi.getSession();
    if (code && typeof code === "string" && !(session.token && session.user)) {
      setDeviceFlowVisible(true, code);
    }
  } catch {
    /* ignore */
  }
}

copyDeviceCodeBtn?.addEventListener("click", async () => {
  const text = lastShownDeviceUserCode || deviceFlowCode?.textContent || "";
  if (!text.trim()) return;
  try {
    await navigator.clipboard.writeText(text.trim());
    copyDeviceCodeBtn.textContent = "Copied";
    setTimeout(() => {
      copyDeviceCodeBtn.textContent = "Copy code";
    }, 1500);
  } catch {
    copyDeviceCodeBtn.textContent = "Copy failed";
    setTimeout(() => {
      copyDeviceCodeBtn.textContent = "Copy code";
    }, 1500);
  }
});

async function loadSettingsFields() {
  const s = await storage.getSettings();
  githubOauthClientId.value = s.githubOauthClientId || "";
  if (githubOauthClientSecret) {
    githubOauthClientSecret.value = s.githubOauthClientSecret || "";
  }
  geminiApiKey.value = s.geminiApiKey || "";
  if (gitloreBackendUrl) gitloreBackendUrl.value = s.gitloreBackendUrl || "";

  const bundled = (BUNDLED_GITHUB_OAUTH_CLIENT_ID || "").trim();
  if (bundled && setupHint) {
    setupHint.textContent =
      "This build includes a default Client ID. Create a GitHub OAuth App with any placeholder callback URL, then Connect.";
  } else if (setupHint) {
    setupHint.textContent =
      "My OAuth apps → New OAuth App: set callback to e.g. http://localhost:3000/callback (unused), save, paste Client ID in Settings, then Connect.";
  }
}

function queryActiveBrowserTab(callback) {
  chrome.windows.getAll({ populate: true }, (windows) => {
    const normal = (windows || []).filter((w) => w.type === "normal");
    const focused = normal.find((w) => w.focused);
    const win = focused || normal[0];
    const tab = win?.tabs?.find((t) => t.active);
    callback(tab || null);
  });
}

async function tryLinkGitloreServer() {
  const s = await storage.getSettings();
  if (!(s.gitloreBackendUrl || "").trim()) {
    await storage.setGitloreSession(null);
    return;
  }
  const gh = await githubApi.getSession();
  if (!gh.token) return;
  try {
    await githubApi.platformExchange();
    hideError(loginError);
  } catch (e) {
    showError(
      loginError,
      e instanceof Error
        ? e.message
        : "Could not link to GitLore backend (check URL, CORS, and that the backend is running)."
    );
  }
}

async function updatePlatformUiState() {
  if (!indexCurrentTabBtn) return;
  const s = await storage.getSettings();
  const hasBackend = !!(s.gitloreBackendUrl || "").trim();
  const sess = await githubApi.getSession();
  indexCurrentTabBtn.classList.toggle(
    "hidden",
    !hasBackend || !sess.token || !sess.gitloreSession
  );
}

openGithubOAuthApps?.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://github.com/settings/developers" });
});

openNewGithubOAuth?.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://github.com/settings/applications/new" });
});

async function updateGeminiBanner() {
  if (!geminiBanner) return;
  const s = await storage.getSettings();
  const hasKey = !!(s.geminiApiKey || "").trim();
  geminiBanner.classList.toggle("hidden", hasKey);
}

async function refreshSession() {
  if (connectBtn) connectBtn.disabled = true;
  try {
    const session = await githubApi.getSession();
    if (session.user && session.token) {
      loginSection.classList.add("hidden");
      repoSection.classList.remove("hidden");
      userRow.classList.remove("hidden");
      username.textContent = session.user.login || "";
      if (session.user.avatar_url) {
        avatar.src = session.user.avatar_url;
        avatar.alt = session.user.login || "";
      }
      await updateGeminiBanner();
      await loadRepos();
      await tryLinkGitloreServer();
      await updatePlatformUiState();
    } else {
      loginSection.classList.remove("hidden");
      repoSection.classList.add("hidden");
      userRow.classList.add("hidden");
      await syncDeviceFlowBannerFromSession();
      await updatePlatformUiState();
    }
  } catch {
    loginSection.classList.remove("hidden");
    repoSection.classList.add("hidden");
    userRow.classList.add("hidden");
    await syncDeviceFlowBannerFromSession();
    await updatePlatformUiState();
  } finally {
    if (connectBtn) connectBtn.disabled = false;
    broadcastGitloreSessionToTabs();
  }
}

async function loadRepos() {
  hideError(repoError);
  repoSkeleton.classList.remove("hidden");
  repoList.innerHTML = "";
  try {
    allRepos = await githubApi.listUserRepos();
    renderRepos(repoSearch.value);
  } catch (e) {
    showError(
      repoError,
      e instanceof Error
        ? e.message
        : "Failed to load repositories. Sign out and connect again."
    );
    allRepos = [];
  } finally {
    repoSkeleton.classList.add("hidden");
  }
}

connectBtn.addEventListener("click", async () => {
  connectBtn.disabled = true;
  hideError(repoError);
  hideError(loginError);
  setDeviceFlowVisible(false);
  const s = await storage.getSettings();
  if (!(s.githubOauthClientId || "").trim()) {
    showError(
      loginError,
      "Add your GitHub OAuth App Client ID in Settings first."
    );
    connectBtn.disabled = false;
    return;
  }
  try {
    await githubApi.connectGithub(({ user_code: uc }) => {
      setDeviceFlowVisible(true, uc);
    });
    setDeviceFlowVisible(false);
    await refreshSession();
  } catch (e) {
    setDeviceFlowVisible(false);
    showError(
      loginError,
      e instanceof Error ? e.message : "GitHub authorization failed"
    );
  } finally {
    connectBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", async () => {
  await githubApi.clearSession();
  setDeviceFlowVisible(false);
  allRepos = [];
  repoList.innerHTML = "";
  loginSection.classList.remove("hidden");
  repoSection.classList.add("hidden");
  userRow.classList.add("hidden");
  broadcastGitloreSessionToTabs();
});

function toggleSettingsPanel() {
  settingsPanel.classList.toggle("hidden");
  if (!settingsPanel.classList.contains("hidden")) loadSettingsFields();
}

toggleSettings.addEventListener("click", toggleSettingsPanel);
toggleSettingsHeader?.addEventListener("click", toggleSettingsPanel);

saveSettings.addEventListener("click", async () => {
  const backend = gitloreBackendUrl ? gitloreBackendUrl.value.trim() : "";
  hideError(settingsError);
  if (backend) {
    const ok = await ensureLocalhostBackendPermission(backend);
    if (!ok) {
      showError(
        settingsError,
        "Chrome did not allow access to localhost. Approve the permission, then Save again."
      );
      return;
    }
  }
  await storage.saveSettings({
    githubOauthClientId: githubOauthClientId.value.trim(),
    githubOauthClientSecret: githubOauthClientSecret
      ? githubOauthClientSecret.value.trim()
      : undefined,
    geminiApiKey: geminiApiKey.value.trim(),
    gitloreBackendUrl: backend,
  });
  if (!backend) {
    await storage.setGitloreSession(null);
  } else {
    await tryLinkGitloreServer();
  }
  settingsPanel.classList.add("hidden");
  await updateGeminiBanner();
  await updatePlatformUiState();
});

openSettingsForGemini?.addEventListener("click", () => {
  settingsPanel.classList.remove("hidden");
  loadSettingsFields();
  setTimeout(() => geminiApiKey?.focus(), 0);
});

repoSearch.addEventListener("input", () => {
  renderRepos(repoSearch.value);
});

openSidePanelBtn?.addEventListener("click", () => {
  hideError(repoError);
  openGitLoreSidePanel().catch((e) => {
    showError(
      repoError,
      e instanceof Error ? e.message : "Could not open side panel"
    );
  });
});

indexCurrentTabBtn?.addEventListener("click", () => {
  hideError(repoError);
  queryActiveBrowserTab(async (tab) => {
    const url = tab?.url || "";
    const parsed = parseGithubRepoFromUrl(url);
    if (!parsed) {
      showError(
        repoError,
        "Open a github.com repository page in a normal Chrome window, then click again."
      );
      return;
    }
    try {
      const s = await storage.getSettings();
      const backend = (s.gitloreBackendUrl || "").trim();
      if (backend) {
        const ok = await ensureLocalhostBackendPermission(backend);
        if (!ok) {
          showError(
            repoError,
            "Allow localhost access when Chrome prompts, then try Index again (or Save settings once)."
          );
          return;
        }
      }
      await githubApi.platformStartRepo({
        owner: parsed.owner,
        name: parsed.name,
      });
      await openGitLoreSidePanel();
    } catch (e) {
      showError(
        repoError,
        e instanceof Error ? e.message : "Could not start backend ingest"
      );
    }
  });
});

async function ensureBundledClientSeeded() {
  const bundled = (BUNDLED_GITHUB_OAUTH_CLIENT_ID || "").trim();
  if (!bundled) return;
  const s = await storage.getSettings();
  if ((s.githubOauthClientId || "").trim()) return;
  await storage.saveSettings({ githubOauthClientId: bundled });
}

ensureBundledClientSeeded().then(() => {
  loadSettingsFields();
  refreshSession();
});
