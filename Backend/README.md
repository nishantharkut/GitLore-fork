# GitLore Backend

Hono + MongoDB API for GitLore. This commit completes the backend stack: `POST /api/analyze`, `/api/explain`, `/api/search` (Gemini + embeddings), plus `/test/real-*` helpers.

Set `GEMINI_API_KEY` in `.env` for AI routes. Prior PRs in this stack added foundation, OAuth, and repository/guardrails/narrate routes.

## Run

```bash
cd Backend
npm install
cp .env.example .env
```

Set at least `MONGODB_URI`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`, and `SESSION_SECRET` to exercise OAuth. See `.env.example`.

CORS uses an explicit allowlist (not `*`) so cookies work once OAuth lands. Override with `CORS_ORIGIN` (comma-separated) if the frontend runs on another host or port.

`/test/env-check` is disabled when `NODE_ENV=production`.

See `.env.example` for variables required by later PRs.
