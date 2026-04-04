/**
 * Side panel: chat (markdown + Prism). No D3 graph — use the web app for full graph views.
 */
import DOMPurify from "../vendor/purify.es.mjs";
import { marked } from "../vendor/marked.esm.js";
import * as api from "../utils/api-client.js";
import * as githubApi from "../utils/github-api.js";
import * as storage from "../utils/storage.js";

marked.setOptions({
  gfm: true,
  breaks: true,
});

const Prism = globalThis.Prism;

const SESSION_KEY = "sidePanelRepo";

const $ = (id) => document.getElementById(id);

const repoTitle = $("repoTitle");
const analyzeStatus = $("analyzeStatus");
const btnRefreshIngest = $("btnRefreshIngest");
const chatMessages = $("chatMessages");
const chatForm = $("chatForm");
const chatInput = $("chatInput");
const geminiKeyNotice = $("geminiKeyNotice");
const btnRepoPicker = $("btnRepoPicker");
const repoPickerModal = $("repoPickerModal");
const repoPickerSearch = $("repoPickerSearch");
const repoPickerList = $("repoPickerList");
const repoPickerStatus = $("repoPickerStatus");
const btnCloseRepoPicker = $("btnCloseRepoPicker");

/** @type {{ repoFullName: string, defaultBranch: string } | null} */
let ctx = null;

/** @type {Array<Record<string, unknown>>} */
let allReposForPicker = [];

let repoPickerWired = false;

/** Use GitLore server ingest + /chat (same as web app). */
let platformMode = false;

/** @type {ReturnType<typeof setInterval> | null} */
let ingestPollTimer = null;

/**
 * @param {string} s
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render Markdown to DOM (GFM: headings, lists, bold/italic, code, links, tables).
 * Always wrap in `.md-root` so typography/CSS applies in the side panel.
 * @param {string} raw
 */
function renderRichText(raw) {
  const wrap = document.createElement("div");
  wrap.className = "md-root";
  const s = String(raw ?? "");
  try {
    const html = marked.parse(s, { async: false });
    wrap.innerHTML = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  } catch {
    const p = document.createElement("p");
    p.textContent = s;
    wrap.appendChild(p);
  }
  if (!wrap.textContent || !wrap.textContent.trim()) {
    wrap.innerHTML = "";
    const p = document.createElement("p");
    p.className = "md-empty-fallback";
    p.textContent = s.trim() ? s : "(No visible text in this reply.)";
    wrap.appendChild(p);
  }
  return wrap;
}

/**
 * @param {unknown[]} turns
 * @returns {{ role: "user" | "assistant"; content: string }[]}
 */
function sanitizeChatHistoryForApi(turns) {
  const out = [];
  if (!Array.isArray(turns)) return out;
  for (const x of turns) {
    const o = /** @type {{ role?: string, content?: unknown }} */ (x);
    const role = o.role === "assistant" ? "assistant" : "user";
    const content = typeof o.content === "string" ? o.content : "";
    if (!content.trim()) continue;
    out.push({ role, content: content.slice(0, 12000) });
  }
  return out.slice(-24);
}

/**
 * @param {Record<string, unknown> | null | undefined} res
 */
function extractChatAnswer(res) {
  if (!res || typeof res !== "object") return "";
  const a = res.answer;
  if (typeof a === "string" && a.trim()) return a.trim();
  return "";
}

/**
 * @param {string} chunk
 */
function decodeStreamChunk(chunk) {
  const t = chunk.trim();
  if (!t) return "";
  try {
    const j = JSON.parse(t);
    if (typeof j.text === "string") return j.text;
    if (typeof j.delta === "string") return j.delta;
    if (j.content && typeof j.content === "string") return j.content;
  } catch {
    /* plain text */
  }
  return chunk;
}

/**
 * @param {HTMLElement} container
 */
function highlightIn(container) {
  if (!Prism) return;
  container.querySelectorAll("code[class*='language-']").forEach((el) => {
    try {
      Prism.highlightElement(el);
    } catch {
      /* ignore */
    }
  });
}

/**
 * @param {string} role
 * @param {string} text
 */
function appendMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg msg-${role === "user" ? "user" : "ai"}`;
  div.appendChild(renderRichText(text));
  highlightIn(div);
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * @param {string} msg
 * @param {'running'|'error'|'ok'|'muted'} kind
 */
function setAnalyzeUi(msg, kind) {
  analyzeStatus.textContent = msg;
  analyzeStatus.className = "analyze-status";
  if (kind === "running") analyzeStatus.classList.add("status-running");
  if (kind === "error") analyzeStatus.classList.add("status-error");
  if (kind === "ok") analyzeStatus.classList.add("status-ok");
  if (kind === "muted") analyzeStatus.classList.add("status-muted");
}

function repoOwnerName(full) {
  const slash = String(full).indexOf("/");
  if (slash < 1) return { owner: "", name: "" };
  return {
    owner: full.slice(0, slash),
    name: full.slice(slash + 1),
  };
}

function applyPlatformChatUi() {
  if (geminiKeyNotice) geminiKeyNotice.classList.add("hidden");
  btnRefreshIngest?.classList.remove("hidden");
  if (chatInput) {
    chatInput.disabled = false;
    chatInput.placeholder = "Ask about merged PRs and decisions…";
  }
  const sendBtn = chatForm?.querySelector('button[type="submit"]');
  if (sendBtn instanceof HTMLButtonElement) sendBtn.disabled = false;
}

async function pollPlatformIngestOnce() {
  if (!ctx || !platformMode) return;
  const { owner, name } = repoOwnerName(ctx.repoFullName);
  if (!owner || !name) return;
  try {
    const st = await api.platformIngestStatus({ owner, name });
    const status = String(st.status || "");
    const recent = Array.isArray(st.recentErrors) ? st.recentErrors : [];
    const errTail =
      recent.length > 0
        ? String(recent[recent.length - 1]).slice(0, 220)
        : "";

    if (status === "running") {
      setAnalyzeUi(
        `Indexing… ${st.processed ?? 0}/${st.total ?? "?"} PRs`,
        "running"
      );
    } else if (status === "not_started") {
      setAnalyzeUi(
        "Ingest not started — use popup: Index current GitHub tab",
        "muted"
      );
    } else if (status === "error") {
      setAnalyzeUi(
        errTail ||
          (st.errorCount
            ? `Ingest failed (${st.errorCount} error(s)). Check backend logs and GEMINI_API_KEY.`
            : "Ingest failed. Check backend logs (GitHub token, Gemini API)."),
        "error"
      );
    } else if (status === "done" || status === "complete" || status === "completed") {
      const nodes = st.nodeCount ?? 0;
      const total = st.total ?? 0;
      if (nodes === 0 && total === 0) {
        setAnalyzeUi(
          "Ingest finished: no merged PRs in range (or empty repo). You can still chat if data exists.",
          "muted"
        );
      } else {
        setAnalyzeUi(`Indexed · ${nodes} PR decisions — you can chat`, "ok");
      }
    } else if (status === "stale") {
      setAnalyzeUi(st.hint || "Ingest stale — start again from the popup", "error");
    } else {
      setAnalyzeUi(`${status} · ${st.nodeCount ?? 0} nodes`, "ok");
    }
  } catch (e) {
    setAnalyzeUi(e instanceof Error ? e.message : "Status error", "error");
  }
}

function stopPlatformIngestPolling() {
  if (ingestPollTimer) clearInterval(ingestPollTimer);
  ingestPollTimer = null;
}

function startPlatformIngestPolling() {
  stopPlatformIngestPolling();
  if (!platformMode || !ctx) return;
  ingestPollTimer = setInterval(() => void pollPlatformIngestOnce(), 5000);
  void pollPlatformIngestOnce();
}

async function loadChatHistory() {
  if (!ctx) return;
  chatMessages.innerHTML = "";
  const h = await storage.getChatHistory(ctx.repoFullName);
  if (!h || !h.length) return;
  for (const m of h) {
    const o = /** @type {{ role?: string, content?: string }} */ (m);
    if (o.role && o.content) {
      appendMessage(o.role, o.content);
    }
  }
}

/**
 * @param {{ role: string, content: string }[]} messages
 */
async function saveChatHistory(messages) {
  if (!ctx) return;
  await storage.setChatHistory(ctx.repoFullName, messages);
}

/**
 * @param {boolean} hasGemini
 */
function applyGeminiKeyUi(hasGemini) {
  btnRefreshIngest?.classList.add("hidden");
  if (geminiKeyNotice) geminiKeyNotice.classList.toggle("hidden", hasGemini);
  if (chatInput) {
    chatInput.placeholder = hasGemini
      ? "Ask about this repo (file tree context)…"
      : "Add a Gemini API key in the popup Settings to enable chat…";
    chatInput.disabled = !hasGemini;
  }
  const sendBtn = chatForm?.querySelector('button[type="submit"]');
  if (sendBtn instanceof HTMLButtonElement) sendBtn.disabled = !hasGemini;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const sk = storage.STORAGE_KEYS;
  if (!changes[sk.SETTINGS] && !changes[sk.GITLORE_SESSION]) return;
  void (async () => {
    const s = await storage.getSettings();
    const sess = await githubApi.getSession();
    const plat = !!(s.gitloreBackendUrl || "").trim() && !!sess.gitloreSession;
    platformMode = plat;
    if (plat) {
      applyPlatformChatUi();
      if (ctx) startPlatformIngestPolling();
    } else {
      stopPlatformIngestPolling();
      applyGeminiKeyUi(!!(s.geminiApiKey || "").trim());
      if (!ctx) btnRefreshIngest?.classList.add("hidden");
    }
  })();
});

btnRefreshIngest?.addEventListener("click", () => void pollPlatformIngestOnce());

function isRepoPickerOpen() {
  return repoPickerModal && !repoPickerModal.classList.contains("hidden");
}

function closeRepoPickerModal() {
  repoPickerModal?.classList.add("hidden");
}

function renderRepoPickerList(filter) {
  if (!repoPickerList) return;
  const q = (filter || "").trim().toLowerCase();
  repoPickerList.innerHTML = "";
  const items = allReposForPicker.filter((r) => {
    const name = String(r.full_name || r.name || "");
    return !q || name.toLowerCase().includes(q);
  });
  for (const r of items) {
    const fullName = String(r.full_name || "");
    const branch = String(r.default_branch || "main");
    const li = document.createElement("li");
    li.className = "repo-picker-item";
    const vis = r.private ? "private" : "public";
    li.innerHTML = `<span class="repo-picker-name">${escapeHtml(fullName)}</span><span class="repo-picker-badge repo-picker-badge-${vis}">${vis}</span>`;
    li.addEventListener("click", async () => {
      closeRepoPickerModal();
      await chrome.storage.session.set({
        [SESSION_KEY]: { repoFullName: fullName, defaultBranch: branch },
      });
      location.reload();
    });
    repoPickerList.appendChild(li);
  }
}

async function openRepoPickerModal() {
  if (!repoPickerModal) return;
  repoPickerModal.classList.remove("hidden");
  if (repoPickerStatus) repoPickerStatus.textContent = "Loading repositories…";
  if (repoPickerList) repoPickerList.innerHTML = "";
  try {
    allReposForPicker = await githubApi.listUserRepos();
    if (repoPickerStatus) repoPickerStatus.textContent = "";
    renderRepoPickerList(repoPickerSearch?.value || "");
    repoPickerSearch?.focus();
  } catch (e) {
    if (repoPickerStatus) {
      repoPickerStatus.textContent =
        e instanceof Error ? e.message : "Could not load repositories";
    }
  }
}

function setupRepoPickerUI() {
  if (repoPickerWired) return;
  repoPickerWired = true;

  btnRepoPicker?.addEventListener("click", () => {
    void openRepoPickerModal();
  });
  btnCloseRepoPicker?.addEventListener("click", closeRepoPickerModal);
  repoPickerSearch?.addEventListener("input", () => {
    renderRepoPickerList(repoPickerSearch.value);
  });
  repoPickerModal?.addEventListener("click", (e) => {
    if (e.target === repoPickerModal) closeRepoPickerModal();
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isRepoPickerOpen()) {
    closeRepoPickerModal();
  }
});

chatForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!ctx) return;
  const s0 = await storage.getSettings();
  const sess = await githubApi.getSession();
  const usePlatform =
    platformMode ||
    (!!(s0.gitloreBackendUrl || "").trim() && !!sess.gitloreSession);
  if (!usePlatform && !(s0.geminiApiKey || "").trim()) return;
  const text = chatInput.value.trim();
  if (!text || text.length < 5) return;

  const history = (await storage.getChatHistory(ctx.repoFullName)) || [];
  const typed = history.map((x) => {
    const o = /** @type {{ role: string, content: string }} */ (x);
    return { role: o.role, content: o.content };
  });

  appendMessage("user", text);
  typed.push({ role: "user", content: text });
  chatInput.value = "";
  await saveChatHistory(typed);

  const aiDiv = document.createElement("div");
  aiDiv.className = "msg msg-ai";
  chatMessages.appendChild(aiDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  const submitBtn = chatForm.querySelector('button[type="submit"]');
  if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = true;

  if (usePlatform) {
    const { owner, name } = repoOwnerName(ctx.repoFullName);
    aiDiv.textContent = "Thinking…";
    aiDiv.classList.add("msg-ai-loading");
    try {
      const res = /** @type {Record<string, unknown>} */ (
        await api.platformChat({
          owner,
          name,
          question: text,
          history: sanitizeChatHistoryForApi(typed.slice(0, -1)),
          concise: true,
        })
      );
      aiDiv.classList.remove("msg-ai-loading");
      const answer = extractChatAnswer(res);
      aiDiv.innerHTML = "";
      if (!answer) {
        aiDiv.appendChild(
          renderRichText(
            "**No answer text from the server.** Wait until **ingest** finishes, ensure the backend has **GEMINI_API_KEY**, then try again."
          )
        );
        typed.push({
          role: "assistant",
          content:
            "No answer text returned from the server. Finish ingest and check backend Gemini configuration.",
        });
      } else {
        aiDiv.appendChild(renderRichText(answer));
        highlightIn(aiDiv);
        if (!aiDiv.textContent || !aiDiv.textContent.trim()) {
          aiDiv.textContent = answer;
        }
        typed.push({ role: "assistant", content: answer });
      }
      await saveChatHistory(typed);
    } catch (e) {
      aiDiv.classList.remove("msg-ai-loading");
      const msg = e instanceof Error ? e.message : "Chat request failed";
      aiDiv.textContent = msg;
      typed.push({ role: "assistant", content: msg });
      await saveChatHistory(typed);
    } finally {
      if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = false;
    }
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return;
  }

  let acc = "";
  const port = api.connectChatStream({
    repoFullName: ctx.repoFullName,
    message: text,
    chatHistory: typed.slice(0, -1),
  });

  port.onMessage.addListener((msg) => {
    if (msg.type === "chunk" && typeof msg.text === "string") {
      acc += decodeStreamChunk(msg.text);
      aiDiv.innerHTML = "";
      aiDiv.appendChild(renderRichText(acc));
      highlightIn(aiDiv);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    if (msg.type === "done") {
      typed.push({ role: "assistant", content: acc });
      saveChatHistory(typed);
      if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = false;
      port.disconnect();
    }
    if (msg.type === "error") {
      aiDiv.textContent = msg.message || "Chat failed";
      if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = false;
      port.disconnect();
    }
  });
});

async function init() {
  const s = await chrome.storage.session.get(SESSION_KEY);
  const raw = s[SESSION_KEY];
  const session = await githubApi.getSession();

  if (!session.token) {
    btnRefreshIngest?.classList.add("hidden");
    repoTitle.textContent = "Sign in from the GitLore extension popup.";
    repoTitle.removeAttribute("title");
    setAnalyzeUi("Not signed in", "error");
    return;
  }

  const settings = await storage.getSettings();
  platformMode = !!(
    (settings.gitloreBackendUrl || "").trim() && session.gitloreSession
  );

  if (platformMode) {
    applyPlatformChatUi();
  } else {
    applyGeminiKeyUi(!!(settings.geminiApiKey || "").trim());
  }

  setupRepoPickerUI();

  const hasRepoCtx = raw && typeof raw === "object" && raw.repoFullName;

  if (!hasRepoCtx) {
    ctx = null;
    btnRefreshIngest?.classList.add("hidden");
    repoTitle.textContent = "Select a repository";
    repoTitle.removeAttribute("title");
    setAnalyzeUi("Use Switch repo to choose a repo", "muted");
    return;
  }

  ctx = {
    repoFullName: String(raw.repoFullName),
    defaultBranch: String(raw.defaultBranch || "main"),
  };
  repoTitle.textContent = ctx.repoFullName;
  repoTitle.setAttribute("title", ctx.repoFullName);

  if (platformMode) {
    setAnalyzeUi("Checking ingest status…", "running");
    startPlatformIngestPolling();
  } else {
    setAnalyzeUi("Standalone chat (Gemini + GitHub). Full graph: use gitlore.app", "muted");
  }

  await loadChatHistory();
}

init();
