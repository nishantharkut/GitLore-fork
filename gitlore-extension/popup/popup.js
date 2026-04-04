/**
 * Popup UI: OAuth settings, GitHub connect, repo list, open side panel.
 */
import { BUNDLED_GITHUB_OAUTH_CLIENT_ID } from "../defaults-config.js";
import * as storage from "../utils/storage.js";
import * as githubApi from "../utils/github-api.js";

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
const callbackHint = $("callbackHint");
const copyCallbackBtn = $("copyCallbackBtn");
const saveSettings = $("saveSettings");
const loginError = $("loginError");
const setupHint = $("setupHint");
const openGithubOAuthApps = $("openGithubOAuthApps");
const openNewGithubOAuth = $("openNewGithubOAuth");
const geminiBanner = $("geminiBanner");
const openSettingsForGemini = $("openSettingsForGemini");

/** Same key as `SIDE_PANEL_CTX` in the service worker — repo context for the side panel. */
const SIDE_PANEL_REPO_KEY = "sidePanelRepo";

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
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideError(el) {
  el.classList.add("hidden");
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
      // `chrome.sidePanel.open()` must run from this popup (user gesture). The service worker path loses the gesture.
      chrome.storage.session.set(
        {
          [SIDE_PANEL_REPO_KEY]: {
            repoFullName,
            defaultBranch: branch,
          },
        },
        () => {
          const wid = chrome.windows.WINDOW_ID_CURRENT;
          const openOpts =
            typeof wid === "number" ? { windowId: wid } : {};
          chrome.sidePanel.open(openOpts).catch((e) => {
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

async function loadSettingsFields() {
  const s = await storage.getSettings();
  githubOauthClientId.value = s.githubOauthClientId || "";
  if (githubOauthClientSecret) {
    githubOauthClientSecret.value = s.githubOauthClientSecret || "";
  }
  geminiApiKey.value = s.geminiApiKey || "";
  const callbackId = chrome.runtime.id;
  callbackHint.value = `https://${callbackId}.chromiumapp.org/`;

  const bundled = (BUNDLED_GITHUB_OAUTH_CLIENT_ID || "").trim();
  if (bundled && setupHint) {
    setupHint.textContent =
      "This build includes a default Client ID. If sign-in fails, ensure the GitHub OAuth app lists the callback URL below (Copy → paste in GitHub).";
  } else if (setupHint) {
    setupHint.textContent =
      "Use My OAuth apps / New OAuth App, paste the callback URL (Copy) into GitHub, save, then Connect.";
  }
}

openGithubOAuthApps?.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://github.com/settings/developers" });
});

openNewGithubOAuth?.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://github.com/settings/applications/new" });
});

copyCallbackBtn.addEventListener("click", async () => {
  const url = callbackHint.value;
  try {
    await navigator.clipboard.writeText(url);
    copyCallbackBtn.textContent = "Copied";
    setTimeout(() => {
      copyCallbackBtn.textContent = "Copy";
    }, 1500);
  } catch {
    callbackHint.select();
    document.execCommand("copy");
  }
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
    } else {
      loginSection.classList.remove("hidden");
      repoSection.classList.add("hidden");
      userRow.classList.add("hidden");
    }
  } catch {
    loginSection.classList.remove("hidden");
    repoSection.classList.add("hidden");
    userRow.classList.add("hidden");
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
    await githubApi.connectGithub();
    await refreshSession();
  } catch (e) {
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
  await storage.saveSettings({
    githubOauthClientId: githubOauthClientId.value.trim(),
    githubOauthClientSecret: githubOauthClientSecret
      ? githubOauthClientSecret.value.trim()
      : undefined,
    geminiApiKey: geminiApiKey.value.trim(),
  });
  settingsPanel.classList.add("hidden");
  await updateGeminiBanner();
});

openSettingsForGemini?.addEventListener("click", () => {
  settingsPanel.classList.remove("hidden");
  loadSettingsFields();
  setTimeout(() => geminiApiKey?.focus(), 0);
});

repoSearch.addEventListener("input", () => {
  renderRepos(repoSearch.value);
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
