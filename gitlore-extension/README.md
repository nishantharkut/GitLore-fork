# GitLore Chrome Extension

## Platform mode (same backend as the web app)

If you run the **GitLore backend** locally or remotely:

1. In extension **Settings**, set **GitLore backend URL** (e.g. `http://localhost:3001`) and **Save**. For `localhost` / `127.0.0.1`, Chrome asks for **optional** access to those origins — approve it so ingest/chat can reach your API. After an extension update, **Save settings** (or **Index current GitHub tab**) again if local calls fail until permission is granted.
2. In `GitLore/Backend/.env`, set **`CHROME_EXTENSION_CORS_ORIGINS=chrome-extension://YOUR_EXTENSION_ID`** (from `chrome://extensions` → Details).
3. **Connect with GitHub** (device flow). The extension calls **`POST /auth/github/exchange-token`** to obtain the same signed session as the web app.
4. Open a **`github.com/owner/repo`** tab, open the popup, click **Index current GitHub tab → backend**. That starts **`POST /api/repo/:owner/:name/ingest`** (merged PRs → Mongo knowledge graph).
5. Open the **side panel**: chat uses **`POST /api/repo/:owner/:name/chat`** (server-side Gemini + graph), like the website.

For a **remote** HTTPS API, add that origin to `manifest.json` `host_permissions` (or `optional_host_permissions` + a runtime `chrome.permissions.request` in the popup, same pattern as localhost).

## Standalone mode (no backend)

Runs **only in the browser** if you leave **GitLore backend URL** empty.

| Feature | How it works |
|--------|----------------|
| **GitHub sign-in** | **[OAuth 2.0 Device Flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)** — you enter a short code on `github.com/login/device`. **No `chromiumapp.org` callback** and no `chrome.identity` redirect. |
| **Repositories** | GitHub REST API with the user token. |
| **Graph** | Not in the extension — use the **web app** for the full knowledge graph. |
| **Chat** | **Google Gemini** with repo file list + README excerpt. Add a **Gemini API key** in settings ([Google AI Studio](https://aistudio.google.com/apikey)). |
| **Floating launcher** | After sign-in, a draggable **GitLore** button appears on **github.com** only. It opens the same panel UI in a floating iframe. |

**UI theme** (side panel + popup) matches the GitLore web app: warm dark background (`#08080a` / `#0f0f12`), gold accent (`#c9a84c`), **Inter** body, **Space Grotesk** headings, **JetBrains Mono** for repo paths and code. The floating FAB on github.com uses the same colors; system fonts may substitute there because Google Fonts are not injected on GitHub pages.

## One-time setup

### 1. GitHub OAuth App

1. GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App** (or open an existing app).
2. **Authorization callback URL**: GitHub requires a value. Use any **placeholder** you like, e.g. `http://localhost:3000/callback` — **device flow does not redirect there**.
3. **Enable device flow** on that same OAuth app page (required since 2022). If you skip this, GitHub returns errors like *Device Flow must be explicitly enabled for this App*. Profile → **Settings** → **Developer settings** → **OAuth Apps** → your app → turn on the device-flow option → **Update application**.
4. Copy the **Client ID** (public). Optionally generate a **client secret**; if GitHub’s token step fails without it, paste the secret in the extension **Settings** (stored only in `chrome.storage.local`).
5. In the extension **Settings**, paste the **Client ID**, **Save settings**.
6. Click **Connect with GitHub**: a **user code** appears and a GitHub tab opens. Enter the code at **github.com/login/device**, authorize, then return to the popup — it will finish automatically.

If a secret is ever leaked, **revoke** it on GitHub and create a new one.

### 2. Gemini (standalone chat only)

Optional if you use **standalone** mode. **Platform** mode uses the server’s `GEMINI_API_KEY`.

## Daily use

**Platform:** Backend URL set → open a repo on GitHub → popup → **Index current GitHub tab → backend** → side panel for status + chat.

**Standalone:** Connect → pick a repo → **Analyze with GitLore** → chat (needs Gemini key in settings). Full graph: web app only.

## Load unpacked

1. `chrome://extensions` → **Developer mode** → **Load unpacked** → select this `gitlore-extension` folder.
2. **Reload** the extension after changing `manifest.json` (permissions).

## Permissions

- `https://api.github.com/*` — repos, git trees, README.
- `https://github.com/*` — device OAuth (`/login/device/code`, `/login/oauth/access_token`, user flow), and the **floating launcher** content script (no blanket `https://*/*` host access).
- `https://generativelanguage.googleapis.com/*` — Gemini streaming.
- **`http://localhost/*` and `http://127.0.0.1/*`** — **optional** host permissions; granted when you **Save** a local backend URL or use **Index current GitHub tab** (keeps the default install footprint smaller for store review).
- `tabs` — open GitHub device page, notify tabs when sign-in state changes for the float button.

## Vendored assets

```bash
npm install
npm run vendor
```

## Privacy

- GitHub token and Gemini key are stored in `chrome.storage.local` and used only in the service worker.
- Nothing is sent to GitLore’s servers unless you fork the code to add that yourself.
