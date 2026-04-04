# GitLore

GitLore helps developers understand a codebase through **git history**, **pull requests**, and **review context**. It combines a React frontend with a Node (Hono) backend, **MongoDB** for storage, **GitHub OAuth** for sign-in, and optional **Google Gemini** for narratives, explanations, and **knowledge-graph Q&A**.

---

## Features

- **GitHub sign-in** — Session-based auth; the API acts on behalf of the logged-in user’s token (where applicable).
- **Code insights** — Explore repositories in the app: narratives tied to history, search, analysis, and review-style explanations (Gemini-backed where configured).
- **Knowledge graph (per repo)** — Ingest **merged PRs** into structured **knowledge nodes** (decision, problem, quotes, issues, embeddings). Visualize relationships and run **chat** grounded in retrieved nodes.
- **Retrieval + chat** — Chat uses a **three-tier** search (Atlas **vector** search when configured, MongoDB **full-text**, then **regex** fallback), optional **in-memory** vector similarity, then **Gemini** synthesis with strict “nodes-only” instructions. Automatic **429** retries and **model fallbacks** for free-tier quotas.

---

## Tech stack

| Layer | Stack |
|--------|--------|
| Frontend | React 18, Vite 5, TypeScript, Tailwind CSS, TanStack Query, CodeMirror |
| Backend | Node 18+, Hono 4, TypeScript, MongoDB driver, Octokit GraphQL, Google Generative AI |
| Data | MongoDB (`gitlore` database): users, caches, `knowledge_nodes`, `knowledge_progress`, etc. |

---

## Repository layout

```
GitLore/
├── Backend/          # Hono API (PORT from env, default 3001)
│   ├── src/
│   │   ├── server.ts
│   │   ├── routes/   # auth, repo, ingest, chat, analyze, explain, search, …
│   │   ├── lib/      # mongo, gemini, ingest, github, …
│   │   └── middleware/
│   └── .env.example
├── Frontend/         # Vite dev server on port 8080
│   ├── src/
│   └── vite.config.ts  # proxies /api, /auth, /health → VITE_API_ORIGIN
└── README.md
```

---

## Prerequisites

- **Node.js** ≥ 18  
- **MongoDB** (Atlas or local) — connection string with access to a database named **`gitlore`** (created/used automatically)  
- **GitHub OAuth App** — callback URL must match how you run the frontend (see below)  
- **Gemini API key** (optional but recommended for narratives, PR extraction, embeddings, and knowledge-graph chat)

---

## Quick start

### 1. Clone and install

```bash
cd GitLore/Backend && npm install
cd ../Frontend && npm install
```

### 2. Configure the backend

Copy `Backend/.env.example` to `Backend/.env` and set at least:

- `MONGODB_URI` — MongoDB connection string  
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`  
- `SESSION_SECRET` — long random string  
- `GEMINI_API_KEY` — for AI features (ingest, chat, explain, etc.)

See **Environment variables** below for optional tuning (`PORT`, `CORS_ORIGIN`, model names, embedding models).

### 3. Configure the frontend (dev)

If the API is **not** on `http://127.0.0.1:3001`, create `Frontend/.env`:

```env
VITE_API_ORIGIN=http://127.0.0.1:3001
```

(`vite.config.ts` proxies `/api`, `/auth`, and `/health` to this origin.)

### 4. GitHub OAuth callback

For local dev with Vite on **port 8080**, set:

```env
GITHUB_CALLBACK_URL=http://localhost:8080/auth/github/callback
```

Register the same **Authorization callback URL** in your GitHub OAuth app settings. Ensure `CORS_ORIGIN` in the backend includes your frontend origin (default in `.env.example` includes `http://localhost:8080`).

### 5. Run in development

**Terminal 1 — API**

```bash
cd GitLore/Backend
npm run dev
```

**Terminal 2 — UI**

```bash
cd GitLore/Frontend
npm run dev
```

Open **http://localhost:8080**. Sign in with GitHub, select a repo, and use **Overview** for the knowledge graph and chat.

### 6. Production-style run

```bash
cd GitLore/Backend && npm run build && npm start
cd GitLore/Frontend && npm run build && npm run preview
```

Point `VITE_API_ORIGIN` / deployment URLs and `CORS_ORIGIN` at your real origins.

---

## Environment variables

### Backend (`Backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | Yes | MongoDB connection string |
| `GITHUB_CLIENT_ID` | Yes* | OAuth client ID |
| `GITHUB_CLIENT_SECRET` | Yes* | OAuth client secret |
| `GITHUB_CALLBACK_URL` | Yes* | Must match GitHub app callback (e.g. `http://localhost:8080/auth/github/callback`) |
| `SESSION_SECRET` | Yes | Secret for session signing |
| `GEMINI_API_KEY` | For AI | PR extraction, embeddings, chat synthesis, explain/narrate flows |
| `PORT` | No | API port (default **3001**) |
| `NODE_ENV` | No | `development` / `production` |
| `CORS_ORIGIN` | No | Comma-separated allowed origins (default includes localhost:8080) |
| `FRONTEND_URL` | No | Optional; redirect hints if not derived from callback |
| `GEMINI_GENERATION_MODEL` | No | Default text model (default **gemini-2.5-flash-lite**) |
| `GEMINI_CHAT_MODEL` | No | Override model for knowledge-graph chat only |
| `GEMINI_CHAT_MODEL_FALLBACKS` | No | Comma-separated models tried on 429 after the primary chat model |
| `GEMINI_EMBEDDING_MODELS` | No | Comma-separated embedding model names to try |
| `GITHUB_PAT` | No | Optional fallback token for server-side GitHub calls |

\*Required for OAuth flows used by the app.

Full comments and examples: **`Backend/.env.example`**.

### Frontend (`Frontend/.env`)

| Variable | Description |
|----------|-------------|
| `VITE_API_ORIGIN` | Backend base URL for Vite proxy (default `http://127.0.0.1:3001`) |

Never put `GEMINI_API_KEY` or `GITHUB_CLIENT_SECRET` in the frontend.

---

## Knowledge graph & MongoDB

### Ingest

- Trigger **Build Knowledge Graph** from the **Overview** UI (or `POST /api/repo/:owner/:name/ingest` with a JSON body; optional `limit` 1–50, default 30).
- Ingestion runs in the background; progress is stored in **`knowledge_progress`**.
- Nodes are stored in **`knowledge_nodes`** (unique per `repo` + `pr_number`).

### Indexes

On startup the backend creates indexes including:

- Text index **`knowledge_text_search`** on `knowledge_nodes` (title, summary, problem, decision, full_narrative, topics, pr_author).  
  If you change indexed fields, you may need to **drop** the old text index in Atlas/shell and restart so MongoDB can recreate it.

### Vector search (optional)

For the **vector** tier in chat (and efficient semantic retrieval), configure a MongoDB Atlas **vector index** on `knowledge_nodes.embedding` whose **dimensions** match your embedding model (often **768** — confirm in Atlas UI and Gemini embedding docs). Without Atlas vector search, the backend can fall back to **in-memory** similarity over a capped set of documents.

---

## API overview (authenticated `/api/*`)

All `/api/*` routes use session auth except as noted. Examples:

| Area | Examples |
|------|-----------|
| Repo | Repo metadata and GitHub-backed operations under `/api/repo/...` |
| Ingest | `POST /api/repo/:owner/:name/ingest`, status/progress endpoints |
| Chat | `GET /api/repo/:owner/:name/chat/status`, `POST /api/repo/:owner/:name/chat` |
| Legacy / core | Analyze, explain, search, narrate, guardrails — see `Backend/src/routes/` |

Public: `GET /health`, OAuth under `/auth/*`, test routes under `/test/*` as configured.

---

## Frontend routes

| Path | Purpose |
|------|---------|
| `/` | Landing |
| `/app` | Main app / repo workspace |
| `/overview` | Overview & knowledge graph experience |
| `/patterns` | Patterns UI |

---

## Troubleshooting

- **CORS / cookies** — Backend `CORS_ORIGIN` must list your exact browser origin; use `credentials: true` compatible origins (no `*` with cookies).
- **Proxy / wrong API** — Set `VITE_API_ORIGIN` to the host:port where Hono listens (`PORT` in `.env`).
- **Gemini 429 / quota** — Free tier is per model and per minute/day; the chat route can fall back to other models via `GEMINI_CHAT_MODEL_FALLBACKS`. Reduce ingest frequency or enable billing if you need higher limits.
- **API key invalid / expired** — Regenerate in [Google AI Studio](https://aistudio.google.com/apikey) and update `GEMINI_API_KEY`.
- **Chat returns no matches** — Run ingest for the repo; try different wording; check that `knowledge_nodes` has documents for that `repo` key.
- **Text search oddities** — After changing text index fields, drop `knowledge_text_search` and restart the server.

---

## Scripts reference

**Backend:** `npm run dev` · `npm run build` · `npm start` · `npm run type-check`

**Frontend:** `npm run dev` · `npm run build` · `npm run preview` · `npm run lint` · `npm test`

---

## Documentation in-repo

Implementation notes and follow-ups for the knowledge graph feature live next to this repo in the parent workspace as **`KNOWLEDGE_GRAPH_IMPLEMENTATION.md`** and **`KNOWLEDGE_GRAPH_FOLLOWUP.md`** (paths may vary if you cloned only `GitLore`).

---

## License

No license file is included in this repository; add one if you intend to open-source or distribute the project.
