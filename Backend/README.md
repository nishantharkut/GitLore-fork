# GitLore Backend

Hono + MongoDB API for GitLore. This commit completes the backend stack: `POST /api/analyze`, `/api/explain`, `/api/search` (Gemini + embeddings), plus `/test/real-*` helpers.

Set `GEMINI_API_KEY` in `.env` for AI routes. Prior PRs in this stack added foundation, OAuth, and repository/guardrails/narrate routes.

## Run

```bash
cd Backend
npm install
cp .env.example .env
```

Fill all variables in `.env.example`, then `npm run dev` (default port `3001`).
