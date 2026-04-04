/**
 * Draggable floating launcher: after GitHub sign-in, shows a FAB that opens GitLore
 * (same side panel UI in an iframe). Host page CSS cannot leak in (Shadow DOM).
 */
(function gitloreFloatIife() {
  const STORAGE_POS = "gitloreFabPosition";
  const PANEL_URL = chrome.runtime.getURL("sidepanel/sidepanel.html");

  const host = document.createElement("div");
  host.id = "gitlore-float-root";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const wrap = document.createElement("div");
  wrap.className = "gitlore-float-host";

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL("content/float.css");
  shadow.appendChild(link);
  shadow.appendChild(wrap);

  const fab = document.createElement("button");
  fab.id = "gitlore-fab";
  fab.type = "button";
  fab.setAttribute("aria-label", "GitLore — open panel");
  fab.innerHTML = "Git<br/>Lore";

  const panel = document.createElement("div");
  panel.id = "gitlore-float-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "GitLore");

  const header = document.createElement("div");
  header.className = "gitlore-panel-header";
  const title = document.createElement("span");
  title.textContent = "GitLore";
  const hint = document.createElement("span");
  hint.className = "gitlore-panel-hint";
  hint.textContent = "Drag the round button to move it";
  const closeBtn = document.createElement("button");
  closeBtn.id = "gitlore-close-panel";
  closeBtn.type = "button";
  closeBtn.textContent = "Close";
  header.appendChild(title);
  header.appendChild(hint);
  header.appendChild(closeBtn);

  const iframe = document.createElement("iframe");
  iframe.id = "gitlore-panel-iframe";
  iframe.title = "GitLore";
  iframe.setAttribute("allow", "clipboard-read; clipboard-write");

  panel.appendChild(header);
  panel.appendChild(iframe);
  wrap.appendChild(fab);
  wrap.appendChild(panel);

  let panelOpen = false;
  let dragActive = false;
  let dragMoved = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startBottom = 0;

  function loadPosition() {
    try {
      const raw = localStorage.getItem(STORAGE_POS);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p.left === "number" && typeof p.bottom === "number") {
          fab.style.left = `${p.left}px`;
          fab.style.bottom = `${p.bottom}px`;
          fab.style.right = "auto";
          return;
        }
      }
    } catch {
      /* ignore */
    }
    fab.style.right = "20px";
    fab.style.bottom = "20px";
    fab.style.left = "auto";
  }

  function savePosition() {
    const rect = fab.getBoundingClientRect();
    const left = rect.left;
    const bottom = window.innerHeight - rect.bottom;
    try {
      localStorage.setItem(STORAGE_POS, JSON.stringify({ left, bottom }));
    } catch {
      /* ignore */
    }
  }

  function setFabVisible(on) {
    fab.classList.toggle("gitlore-fab-visible", on);
    if (!on) {
      panel.classList.remove("gitlore-panel-open");
      panelOpen = false;
    }
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    panel.classList.toggle("gitlore-panel-open", panelOpen);
    if (panelOpen && !iframe.getAttribute("src")) {
      iframe.src = PANEL_URL;
    }
  }

  function getSessionToken() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_SESSION" }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        if (response && response.ok && response.data && response.data.token) {
          resolve(response.data.token);
          return;
        }
        resolve(null);
      });
    });
  }

  async function refreshVisibility() {
    const token = await getSessionToken();
    setFabVisible(!!token);
  }

  fab.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    dragActive = true;
    dragMoved = false;
    const rect = fab.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startBottom = window.innerHeight - rect.bottom;
    fab.style.right = "auto";
    fab.style.left = `${startLeft}px`;
    fab.style.bottom = `${startBottom}px`;

    function onMove(ev) {
      if (!dragActive) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragMoved = true;
      const w = fab.offsetWidth;
      const h = fab.offsetHeight;
      let left = startLeft + dx;
      let bottom = startBottom - dy;
      left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
      bottom = Math.max(8, Math.min(window.innerHeight - h - 8, bottom));
      fab.style.left = `${left}px`;
      fab.style.bottom = `${bottom}px`;
    }

    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      dragActive = false;
      savePosition();
      if (!dragMoved) {
        togglePanel();
      }
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  closeBtn.addEventListener("click", () => {
    panelOpen = false;
    panel.classList.remove("gitlore-panel-open");
  });

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && panelOpen) {
        panelOpen = false;
        panel.classList.remove("gitlore-panel-open");
      }
    },
    true
  );

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "GITLORE_SESSION_CHANGED") {
      void refreshVisibility();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.githubAccessToken) {
      void refreshVisibility();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void refreshVisibility();
    }
  });

  void refreshVisibility();
})();
