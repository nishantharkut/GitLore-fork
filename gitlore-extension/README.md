# GitLore Chrome Extension (standalone)

Runs **entirely in the browser**. No GitLore backend or local Node server is required.

| Feature | How it works |
|--------|----------------|
| **GitHub sign-in** | OAuth 2.0 **PKCE** against GitHub. **Client ID** required; **client secret** optional in Settings (local only) if GitHub’s token step requires it — never commit secrets to the repo. |
| **Repositories** | GitHub REST API with the user token. |
| **Knowledge graph** | Built from the **Git Trees** API (folders + files, up to 500 paths), visualized with D3. |
| **Chat** | **Google Gemini** (`gemini-2.5-flash`) with repo file list + README excerpt as context. Add a **Gemini API key** in settings (from [Google AI Studio](https://aistudio.google.com/apikey)). |

The web app’s backend (ingest, MongoDB, PR-based graph) is **not** used here; this extension is intentionally separate while following similar UX (connect → pick repo → graph → chat).

## One-time setup

### 1. GitHub OAuth App

1. GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**.
2. **Authorization callback URL**: `https://<EXTENSION_ID>.chromiumapp.org/`
   - Load this extension unpacked, copy the ID from `chrome://extensions`, replace `<EXTENSION_ID>`.
3. Save and copy the **Client ID** (public). Optionally generate a **client secret** and keep it private.
4. In the extension **Settings**, paste the **Client ID**. If authorization succeeds but token exchange fails, paste the **client secret** in the optional field (stored only in `chrome.storage.local`), then **Save settings** and try **Connect** again.
5. If a secret is ever leaked (screenshot, chat, etc.), **revoke it** on GitHub and create a new one.

### 2. Gemini (for chat)

Optional. In **Settings**, paste a **Gemini API key** so “Ask about this repository” works. Without a key, graph still works; chat shows a clear error until a key is added.

## Daily use

1. Click the GitLore icon → **Connect with GitHub** (browser OAuth window).
2. After login, pick a repo → **Analyze with GitLore** (opens the side panel).
3. **Build / refresh graph** to index the tree from GitHub.
4. Ask questions in the chat (requires Gemini key).

## Load unpacked

1. `chrome://extensions` → **Developer mode** → **Load unpacked** → select this `gitlore-extension` folder.
2. **Reload** the extension after changing `manifest.json` (permissions).

## Permissions

- `https://api.github.com/*` — repos, git trees, README.
- `https://github.com/*` — OAuth redirect pages inside `launchWebAuthFlow`.
- `https://generativelanguage.googleapis.com/*` — Gemini streaming.

## Vendored assets

```bash
npm install
npm run vendor
```

## Privacy

- GitHub token and Gemini key are stored in `chrome.storage.local` and used only in the service worker.
- Nothing is sent to GitLore’s servers unless you fork the code to add that yourself.
