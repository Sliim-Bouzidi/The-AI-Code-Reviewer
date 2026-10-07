# Deploying: Vercel (dashboard) + Railway (everything else)

```
Browser ─► Vercel (apps/web) ──REST/SSE──► Railway: api ◄── GitHub webhooks
                                              │  ▲
                              Railway: Postgres+pgvector, Redis
                                              ▼  │
                                         Railway: worker      Railway: mcp (optional)
```

## 1. Railway

Create a project, then add:

1. **Postgres with pgvector**: use Railway's "pgvector" template (plain Postgres lacks the extension).
2. **Redis**.
3. Three services from this GitHub repo (root directory `/`, builder Dockerfile). The root `Dockerfile` builds
   everything and its last stage is picked by the `SERVICE` variable:

| Service | `SERVICE` var | Config file (Settings → Config-as-code) | Public domain |
|---|---|---|---|
| api | `api` | `/railway.api.json` (runs migrations before each deploy) | yes |
| worker | `worker` | `/railway.worker.json` | no |
| mcp | `mcp` (optional) | `/railway.mcp.json` | yes |

Railway sets `PORT`; the api and mcp honour it. Generate a domain for `api` (Settings → Networking).

### Variables (set on api and worker unless noted)

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |
| `WEB_URL` (api) | `https://<your-app>.vercel.app` (dashboard origin, also used for redirects) |
| `CORS_ORIGINS` (api, optional) | extra origins, comma-separated |
| `API_PUBLIC_URL` (api) | `https://<api-domain>.up.railway.app` |
| `WEBHOOK_URL` (api) | `https://<api-domain>.up.railway.app/webhooks/github` |
| `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (api) | from the Clerk dashboard |
| `LLM_PROVIDER`, `LLM_MODEL`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `LLM_FALLBACK_*`, `OPENAI_COMPAT_*`, `EMBEDDING_MODEL`, `EMBEDDING_DIM` (api + worker) | see `.env.example` |
| `GITHUB_APP_*` (optional) | only if reusing an app; otherwise use "Create GitHub App" in the dashboard |
| `CODEREVIEW_API_URL` (mcp) | `https://<api-domain>.up.railway.app` |

Do **not** deploy the `smee` container. Do not use the paste-your-Clerk-keys page in production, use env vars
(the config volume is not shared between Railway services).

## 2. Vercel

Import the repo, then:

- **Root Directory**: `apps/web`, and enable **Include source files outside of the Root Directory**.
- Install/build commands come from `apps/web/vercel.json` (pnpm install at the repo root, turbo build of the web app and its packages).
- Variables: `NEXT_PUBLIC_API_URL` = the Railway api URL, `NEXT_PUBLIC_MCP_URL` = the Railway mcp URL (if used),
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`.
- In Clerk, add the Vercel domain to the allowed origins / redirect URLs.

## 3. GitHub App

Open the deployed dashboard and click "Create GitHub App": the manifest flow uses `WEBHOOK_URL`, so the app is
created pointing at Railway. Create a **new** app for production; the local one points at smee/localhost.

## Order

Postgres + Redis → api (migrates) → worker → Vercel → set `WEB_URL`/`API_PUBLIC_URL` to the final domains → GitHub App.
