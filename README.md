<h1 align="center">GitLore</h1>
<p align="center"><strong>Your codebase's institutional memory.</strong></p>
<p align="center">GitLore turns your GitHub PR history into a searchable Knowledge Graph — every decision your team ever made, findable in seconds. Search it. Chat with it. Get cited answers. Works on the web, on GitHub via Chrome Extension, and in your CI via PR Intelligence webhooks.</p>
<p align="center"><em>Built at HackByte 4.0 — IIITDM Jabalpur, April 2026</em></p>

---

## The Problem

Your team has made hundreds of decisions across merged PRs — architecture choices, rejected alternatives, tradeoffs. But when a new developer asks "why do we use Redis here?", the answer is buried in PR #247 from 18 months ago.

**git blame** tells you WHO. **Copilot** tells you WHAT. **Nobody tells you WHY.** GitLore does.

---

## Features

**Core**
- **Knowledge Graph** — PR ingest, Gemini extraction, vector embeddings, 3-tier semantic search
- **Chat** — natural language questions, cited answers with PR references
- **Code Archaeology** — click any line, see full decision story from git history
- **Review Explainer** — pattern, fix, confidence for terse comments

**Automation**
- **PR Intelligence** — CodeRabbit-style: enable once, every new PR auto-commented with duplicate detection + KG context, posted as bot
- **Auto-Fix Reviews** — classify + fix trivial comments (extract → rule → AI), raise draft PR
- **SuperPlane** — event-driven Slack notifications for review explanations + KG updates

**Platform**
- **Chrome Extension** — floating chat button on GitHub, side panel, chat with KG without leaving GitHub
- **Voice** — English + Hindi TTS (ElevenLabs), WebRTC voice agent for hands-free Q&A
- **ArmorIQ Enforcement** — 18 tool actions, policy-based allow/deny, enforcement logging
- **Knowledge Suggestions** — zero-click related decisions while browsing files
- **Patterns** — static + repo-scanned anti-patterns with severity and category
- **Decision Search** — semantic search across all indexed decisions from navbar
- **KG Visualization** — interactive graph with node types, edge types, zoom, fullscreen
- **Repo Overview Dashboard** — health score, top anti-patterns, most changed files, stats

---

## Tech Stack

| Layer | Stack |
|-------|-------|
| **Frontend** | React, TypeScript, Tailwind, CodeMirror, GSAP, anime.js, react-markdown |
| **Backend** | Hono, Node.js, TypeScript, Zod |
| **AI/ML** | Gemini 2.5 Flash + Flash-Lite, text-embedding-004 (768-dim vectors) |
| **Database** | MongoDB Atlas + Atlas Vector Search |
| **APIs** | GitHub GraphQL + REST + OAuth + Webhooks, ElevenLabs TTS + Voice Agent |
| **Security** | ArmorIQ (intent enforcement) |
| **Automation** | SuperPlane (event-driven workflows) |
| **Deployment** | Vercel (frontend), Vultr (backend + services) |
| **Extension** | Chrome Extension (Manifest V3, side panel, service worker) |

---

## Architecture

```
User Layer:  Browser  |  Chrome Extension  |  GitHub Webhook  |  Voice Agent
                ↓               ↓                   ↓                ↓
Frontend:    React + TypeScript + Tailwind (Vercel)
             Overview | AppView | Chat | KG Viz | Voice | Patterns
                                    ↓
Backend:     Hono + Node.js + TypeScript (Vultr) — 35+ endpoints
             Auth | Analyze | Explain | Search | Chat | Ingest | Voice
             Webhook (PR Intel) | AutoFix | Enforcement
             gemini.ts | knowledgeSearch.ts | ingest.ts | githubApp.ts
             Middleware: Cookie + API Key Auth | CORS | Webhook Signature | Zod
                                    ↓
External:    Gemini 2.5 Flash | MongoDB Atlas | GitHub API | ElevenLabs | ArmorIQ
                                    ↓
Deployment:  Vercel (Frontend) | Vultr Cloud (Backend) | MongoDB Atlas M0
```

**Data Flow Pipelines:**
- **KG Ingest**: GitHub GraphQL → Gemini Extract → Embed → MongoDB
- **Chat Query**: Question → Embed → 3-Tier Search → Gemini Synthesis
- **Code Archaeology**: Line Click → Blame → Commit → PR → Reviews → Narrative
- **PR Intelligence**: PR Opened → File Overlap + KG Search → Auto-Comment
- **Auto-Fix**: Classify → Extract/Rule/AI Fix → Validate → Draft PR
- **Voice**: TTS (EN/HI) + WebRTC Agent + Gemini Q&A

---

## Quick Start

### Prerequisites

- Node.js >= 18
- MongoDB Atlas account (free M0 tier works)
- GitHub OAuth App
- Gemini API key

### 1. Clone and Install

```bash
git clone https://github.com/Codealpha07/GitLore.git
cd GitLore/Backend && npm install
cd ../Frontend && npm install
```

### 2. Configure Backend

Copy `Backend/.env.example` to `Backend/.env` and set:

```env
GEMINI_API_KEY=your_key
MONGODB_URI=your_mongodb_atlas_uri
GITHUB_CLIENT_ID=your_oauth_client_id
GITHUB_CLIENT_SECRET=your_oauth_client_secret
GITHUB_CALLBACK_URL=http://localhost:8080/auth/github/callback
SESSION_SECRET=your_random_64_char_secret
PORT=3001
CORS_ORIGIN=http://localhost:8080
```

Optional (for advanced features):
```env
# PR Intelligence Webhook
GITHUB_WEBHOOK_SECRET=your_webhook_secret
BACKEND_PUBLIC_URL=http://your-server:3001
SUPERPLANE_API_KEY=your_api_key
SUPERPLANE_SERVICE_USERNAME=your_github_username

# GitHub App Bot Identity
GITHUB_APP_ID=123456
GITHUB_APP_INSTALLATION_ID=12345678
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"

# Voice
ELEVENLABS_API_KEY=your_key
ELEVENLABS_VOICE_ID=your_voice_id
ELEVENLABS_AGENT_ID=your_agent_id
```

### 3. Configure Frontend

If the backend is not on `http://127.0.0.1:3001`, create `Frontend/.env`:
```env
VITE_API_ORIGIN=http://your-backend-url:3001
```

### 4. Run

**Terminal 1 — Backend:**
```bash
cd GitLore/Backend && npm run dev
```

**Terminal 2 — Frontend:**
```bash
cd GitLore/Frontend && npm run dev
```

Open **http://localhost:8080** → Sign in with GitHub → Select a repo → Build Knowledge Graph → Chat.

---

## Chrome Extension

The Chrome Extension adds a floating chat button on every GitHub repo page.

1. Open `chrome://extensions` → Enable Developer Mode
2. Click "Load unpacked" → Select `gitlore-extension/` folder
3. Click the extension icon → Enter your GitLore API URL → Save
4. Go to any GitHub repo → Click the floating button → Chat with the KG

---

## PR Intelligence (CodeRabbit-style)

Enable once, every new PR gets an automatic comment with duplicate detection and Knowledge Graph context.

1. Set `GITHUB_WEBHOOK_SECRET` and `BACKEND_PUBLIC_URL` in `.env`
2. Go to GitLore Overview → Click "Enable PR Intelligence"
3. Open a new PR → GitLore auto-comments with related PRs and past decisions

For bot identity (`gitlore[bot]` badge), configure the GitHub App env vars.

---

## Deployment

**Frontend → Vercel:**
```bash
cd Frontend && npm run build
# Deploy dist/ to Vercel
```

**Backend → Vultr (or any VPS):**
```bash
ssh root@YOUR_SERVER_IP
git clone https://github.com/Codealpha07/GitLore.git
cd GitLore/Backend
npm install
# Create .env with production values
npm run build && npm start
# Or use PM2: pm2 start dist/server.js --name gitlore-backend
```

Update `CORS_ORIGIN` to include your Vercel URL.
Update `GITHUB_CALLBACK_URL` to your production backend URL.

---

## Repository Layout

```
GitLore/
├── Backend/
│   ├── src/
│   │   ├── server.ts              # Hono app, route mounting
│   │   ├── routes/                # auth, analyze, explain, search, chat, ingest,
│   │   │                          # voice, guardrails, enforcement, autofix, webhooks
│   │   ├── lib/                   # gemini, mongo, github, githubApp, ingest,
│   │   │                          # knowledgeSearch, autofix, armorclaw, patternScanner
│   │   ├── middleware/            # auth (cookie + API key)
│   │   └── webhooks/github/       # signature, processPrWebhook, kgSearch, buildComment
│   └── .env.example
├── Frontend/
│   ├── src/
│   │   ├── pages/                 # Landing, Overview, AppView, Patterns, RepoSelect
│   │   ├── components/            # ChatPanel, KnowledgeDecisionsGraph, StoryVoiceModal,
│   │   │                          # IngestButton, PrIntelligenceButton, GuardrailsModal,
│   │   │                          # KnowledgeSuggestions, EnforcementLog, Navbar
│   │   ├── context/               # Auth, Repo, Theme, Toast, RouteTransition
│   │   └── lib/                   # gitloreApi, codemirror, parseUnifiedDiff
│   └── vite.config.ts
├── gitlore-extension/             # Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── background/                # Service worker (API calls)
│   ├── content/                   # Floating button on GitHub
│   ├── sidepanel/                 # Chat side panel
│   ├── popup/                     # Settings popup
│   └── utils/                     # Auth, storage, GitHub API helpers
└── README.md
```

---

## API Overview

All `/api/*` routes require authentication (cookie or `X-GitLore-API-Key` header).

| Area | Endpoints |
|------|-----------|
| **Auth** | `GET /auth/github`, `GET /auth/me`, `POST /auth/logout` |
| **Analysis** | `POST /api/analyze`, `POST /api/explain`, `POST /api/search` |
| **Knowledge Graph** | `POST /api/repo/:o/:n/ingest`, `GET /api/repo/:o/:n/ingest/status`, `POST /api/repo/:o/:n/chat` |
| **Voice** | `GET /api/voice/status`, `POST /api/voice/tts`, `POST /api/voice/gemini-voice-reply` |
| **Security** | `GET /api/guardrails`, `POST /api/guardrails/test`, `POST /api/enforcement/log` |
| **Auto-Fix** | `POST /api/repo/:o/:n/pulls/:n/auto-fix/classify`, `POST /api/repo/:o/:n/pulls/:n/auto-fix/apply` |
| **Webhook** | `POST /webhooks/github` (signature-verified, unauthenticated) |
| **Health** | `GET /health` |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| CORS errors | Add your frontend URL to `CORS_ORIGIN` in backend `.env` |
| Chat returns "no knowledge graph" | Run ingest first from Overview page |
| Gemini 429 / quota | Free tier limits — reduce ingest frequency or use `GEMINI_CHAT_MODEL_FALLBACKS` |
| Webhook not firing | Check `BACKEND_PUBLIC_URL` is reachable, verify webhook in repo settings |
| Chrome extension no button | Verify extension loaded in `chrome://extensions`, must be on a GitHub repo page |

---

## Team

Built by a team of 4 at HackByte 4.0, IIITDM Jabalpur, April 2026.

---

## License

MIT
