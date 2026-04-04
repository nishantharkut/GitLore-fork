/**
 * Side panel: chat (markdown), knowledge graph in full overlay (D3 + Prism).
 */
import { marked } from "../vendor/marked.esm.js";
import * as api from "../utils/api-client.js";
import * as githubApi from "../utils/github-api.js";
import * as storage from "../utils/storage.js";

marked.setOptions({
  gfm: true,
  breaks: true,
});

const d3 = globalThis.d3;
const Prism = globalThis.Prism;

const SESSION_KEY = "sidePanelRepo";

const $ = (id) => document.getElementById(id);

const repoTitle = $("repoTitle");
const analyzeStatus = $("analyzeStatus");
const btnAnalyze = $("btnAnalyze");
const btnOpenGraph = $("btnOpenGraph");
const btnCloseGraph = $("btnCloseGraph");
const graphOverlay = $("graphOverlay");
const graphWrap = $("graphWrap");
const graphSvg = $("graphSvg");
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

/** @type {{ nodes?: unknown[], edges?: unknown[] } | null} */
let lastGraphPayload = null;

/** @type {Array<Record<string, unknown>>} */
let allReposForPicker = [];

let repoPickerWired = false;

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

const TYPE_COLORS = {
  file: "#38bdf8",
  class: "#a78bfa",
  function: "#4ade80",
  api: "#fb923c",
  api_endpoint: "#fb923c",
  module: "#22d3ee",
  default: "#94a3b8",
};

function isGraphOverlayOpen() {
  return graphOverlay && !graphOverlay.classList.contains("hidden");
}

function openGraphOverlay() {
  if (!graphOverlay) return;
  graphOverlay.classList.remove("hidden");
  graphOverlay.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => {
    if (lastGraphPayload) renderGraph(lastGraphPayload);
  });
}

function closeGraphOverlay() {
  if (!graphOverlay) return;
  graphOverlay.classList.add("hidden");
  graphOverlay.setAttribute("aria-hidden", "true");
}

/**
 * Render Markdown to DOM (GFM: headings, lists, bold/italic, code, links, tables).
 * @param {string} raw
 */
function renderRichText(raw) {
  const frag = document.createDocumentFragment();
  try {
    const html = marked.parse(String(raw), { async: false });
    const wrapper = document.createElement("div");
    wrapper.className = "md-root";
    wrapper.innerHTML = html;
    while (wrapper.firstChild) frag.appendChild(wrapper.firstChild);
  } catch {
    const p = document.createElement("p");
    p.textContent = String(raw);
    frag.appendChild(p);
  }
  return frag;
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
 * @param {{ nodes?: unknown[], edges?: unknown[] }} data
 */
function renderGraph(data) {
  if (!d3 || !graphSvg) return;
  lastGraphPayload = {
    nodes: Array.isArray(data.nodes) ? data.nodes : [],
    edges: Array.isArray(data.edges) ? data.edges : [],
  };

  if (!isGraphOverlayOpen()) {
    return;
  }

  const rawNodes = lastGraphPayload.nodes;
  const rawEdges = lastGraphPayload.edges;

  const wrap = graphWrap;
  const width = Math.max(220, (wrap && wrap.clientWidth) || graphSvg.clientWidth || 400);
  const height = Math.max(220, (wrap && wrap.clientHeight) || graphSvg.clientHeight || 320);

  d3.select(graphSvg).selectAll("*").remove();

  if (rawNodes.length === 0) {
    const g = d3
      .select(graphSvg)
      .attr("viewBox", `0 0 ${width} ${height}`)
      .append("g");
    g.append("text")
      .attr("x", width / 2)
      .attr("y", height / 2)
      .attr("text-anchor", "middle")
      .attr("fill", "#64748b")
      .attr("font-size", 12)
      .text("No graph nodes yet — use Build / refresh graph.");
    return;
  }

  /** @type {Array<{ id: string, label: string, type: string }>} */
  const nodes = rawNodes.map((n, idx) => {
    const o = /** @type {Record<string, unknown>} */ (n);
    const id = String(o.id ?? o.name ?? idx);
    const label = String(o.label ?? o.title ?? o.id ?? idx);
    const type = String(o.type ?? "default");
    return { id, label, type };
  });

  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const links = rawEdges
    .map((e) => {
      const o = /** @type {Record<string, unknown>} */ (e);
      let s = o.source;
      let t = o.target;
      if (s && typeof s === "object" && "id" in /** @type {object} */ (s)) {
        s = /** @type {{ id: string }} */ (s).id;
      }
      if (t && typeof t === "object" && "id" in /** @type {object} */ (t)) {
        t = /** @type {{ id: string }} */ (t).id;
      }
      const sid = String(s);
      const tid = String(t);
      if (!nodeById.has(sid) || !nodeById.has(tid)) return null;
      return { source: sid, target: tid };
    })
    .filter(Boolean);

  const simulation = d3
    .forceSimulation(nodes)
    .force(
      "link",
      d3
        .forceLink(links)
        .id((d) => /** @type {{ id: string }} */ (d).id)
        .distance(50)
    )
    .force("charge", d3.forceManyBody().strength(-120))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius(28));

  const svg = d3.select(graphSvg).attr("viewBox", `0 0 ${width} ${height}`);

  const g = svg.append("g");

  const link = g
    .append("g")
    .attr("stroke", "#475569")
    .attr("stroke-opacity", 0.6)
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("stroke-width", 1.5);

  const node = g
    .append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .call(
      d3
        .drag()
        .on("start", (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
    );

  node
    .append("circle")
    .attr("r", 10)
    .attr("fill", (d) => TYPE_COLORS[d.type] || TYPE_COLORS.default);

  node
    .append("text")
    .attr("dx", 14)
    .attr("dy", 4)
    .attr("fill", "#e2e8f0")
    .attr("font-size", 10)
    .text((d) => (d.label.length > 32 ? `${d.label.slice(0, 30)}…` : d.label));

  simulation.on("tick", () => {
    link
      .attr("x1", (d) => /** @type {{ x: number }} */ (d.source).x)
      .attr("y1", (d) => /** @type {{ y: number }} */ (d.source).y)
      .attr("x2", (d) => /** @type {{ x: number }} */ (d.target).x)
      .attr("y2", (d) => /** @type {{ y: number }} */ (d.target).y);

    node.attr("transform", (d) => `translate(${d.x},${d.y})`);
  });
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

async function runAnalyze() {
  if (!ctx) return;
  btnAnalyze.disabled = true;
  try {
    setAnalyzeUi("Fetching repository tree from GitHub…", "running");
    const res = await api.buildLocalGraph({
      repoFullName: ctx.repoFullName,
      branch: ctx.defaultBranch || "main",
    });
    const gd = res.graphData;
    renderGraph({
      nodes: gd && Array.isArray(gd.nodes) ? gd.nodes : [],
      edges: gd && Array.isArray(gd.edges) ? gd.edges : [],
    });
    setAnalyzeUi(`Graph ready (${res.fileCount} files indexed)`, "ok");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not build graph";
    setAnalyzeUi(msg, "error");
  } finally {
    btnAnalyze.disabled = false;
  }
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
  if (geminiKeyNotice) geminiKeyNotice.classList.toggle("hidden", hasGemini);
  if (chatInput) {
    chatInput.placeholder = hasGemini
      ? "e.g. What does the auth module do?"
      : "Add a Gemini API key in the popup Settings to enable chat…";
    chatInput.disabled = !hasGemini;
  }
  const sendBtn = chatForm?.querySelector('button[type="submit"]');
  if (sendBtn instanceof HTMLButtonElement) sendBtn.disabled = !hasGemini;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.gitloreSettings) return;
  (async () => {
    const s = await storage.getSettings();
    applyGeminiKeyUi(!!(s.geminiApiKey || "").trim());
  })();
});

btnOpenGraph?.addEventListener("click", openGraphOverlay);
btnCloseGraph?.addEventListener("click", closeGraphOverlay);
graphOverlay?.addEventListener("click", (e) => {
  if (e.target === graphOverlay) closeGraphOverlay();
});
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
    return;
  }
  if (e.key === "Escape" && isGraphOverlayOpen()) closeGraphOverlay();
});

chatForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!ctx) return;
  const s0 = await storage.getSettings();
  if (!(s0.geminiApiKey || "").trim()) return;
  const text = chatInput.value.trim();
  if (!text) return;

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
    repoTitle.textContent = "Sign in from the GitLore extension popup.";
    setAnalyzeUi("Not signed in", "error");
    return;
  }

  const settings = await storage.getSettings();
  applyGeminiKeyUi(!!(settings.geminiApiKey || "").trim());
  setupRepoPickerUI();

  const hasRepoCtx = raw && typeof raw === "object" && raw.repoFullName;

  if (!hasRepoCtx) {
    ctx = null;
    lastGraphPayload = { nodes: [], edges: [] };
    repoTitle.textContent = "Select a repository";
    setAnalyzeUi("Use Switch repo to choose a repo", "muted");
    return;
  }

  ctx = {
    repoFullName: String(raw.repoFullName),
    defaultBranch: String(raw.defaultBranch || "main"),
  };
  repoTitle.textContent = ctx.repoFullName;

  const cached = await storage.getCachedGraph(ctx.repoFullName);
  if (cached && cached.graphData) {
    const gd = /** @type {{ nodes?: unknown[], edges?: unknown[] }} */ (cached.graphData);
    lastGraphPayload = {
      nodes: Array.isArray(gd.nodes) ? gd.nodes : [],
      edges: Array.isArray(gd.edges) ? gd.edges : [],
    };
    setAnalyzeUi(`Graph ready (${lastGraphPayload.nodes.length} nodes)`, "ok");
  } else {
    lastGraphPayload = { nodes: [], edges: [] };
    setAnalyzeUi("Open Knowledge graph to build", "muted");
  }

  await loadChatHistory();

  btnAnalyze.addEventListener("click", () => runAnalyze());

  window.addEventListener("resize", () => {
    if (isGraphOverlayOpen() && lastGraphPayload) renderGraph(lastGraphPayload);
  });
}

init();
