# AI Code Review Platform (working name: `codereview`)

> Read this file first. It is the single source of truth for what we are building, how it fits together, and how to work in this repo.

---

## 1. Goal

Build an **AI-powered code review tool** similar to Greptile / CodeRabbit that:

1. Automatically reviews GitHub pull requests and posts inline comments.
2. Understands the **wider codebase** (not only the diff) using embeddings and static analysis.
3. Exposes itself to **AI agents (Claude Code, etc.) through an MCP server**, so a developer can type a slash command like `/mcp__codereview__review` and get a review of their local changes before they push.

**This is a university project, not a production product.** The goal is a working demo that clearly shows the real mechanism end to end. Prefer simple, working, explainable solutions over scale, polish or edge-case coverage.

---

## 2. Scope

### In scope (MVP / demo)
- GitHub App: receive PR webhooks, fetch diffs, post a PR review with inline comments.
- Index one or a few small repos (chunk code, embed, store in pgvector).
- Review pipeline: Tree-sitter parsing + Semgrep + LLM + validation/ranking.
- REST API consumed by the dashboard and the MCP server.
- Dashboard: login, connect GitHub, repo list with enable toggle, reviews list, review detail, per-repo settings.
- MCP server with tools and prompts (slash commands) for Claude Code.
- A small eval set (5-10 PRs with known issues) to show the quality of results.

### Out of scope (for now)
- Multi-tenant scaling, billing, teams/orgs, SSO.
- GitLab / Bitbucket.
- Fine-tuned models, premium models, self-hosted LLMs.
- Real-time collaboration, in-app code editor.
- Perfect security hardening (but do not commit secrets or log private code).

### Demo constraints
- Run on **free-tier LLMs** (Gemini via Google AI Studio, OpenRouter free models). Free tiers have tight rate limits, so the pipeline must queue, rate-limit and retry.
- Test only on **public or our own repos** (free tiers may use prompts for training).

---

## 3. Team modules

The project has 5 parts. Each person owns one, and they meet at the **API contract** (section 9).

| # | Module | Owns |
|---|---|---|
| 1 | **Git integration** | GitHub App, webhooks, Octokit, installations, posting PR comments, `/api/repos` |
| 2 | **Indexer / context engine** | Cloning, Tree-sitter chunking, embeddings, pgvector search |
| 3 | **Review engine** | Worker pipeline, prompts, Semgrep, validation/ranking, LLM provider layer |
| 4 | **Dashboard** | Next.js app, Clerk auth, pages, settings UI |
| 5 | **MCP server + Core API contracts** | MCP tools/prompts, API keys, shared types (Zod), API docs |

---

## 4. Architecture

```
                         ┌──────────────────────────┐
                         │   Next.js Dashboard      │
                         │   (Clerk auth, shadcn)   │
                         └────────────┬─────────────┘
                                      │ REST
GitHub ── webhooks ──►  ┌─────────────▼─────────────┐  ◄── REST ── MCP Server ◄── Claude Code
(PR events)             │       NestJS Core API     │              (tools + slash commands)
                        └───┬───────────┬───────┬───┘
                            │           │       │
                    ┌───────▼──┐  ┌─────▼────┐  └──► GitHub API (Octokit)
                    │ Postgres │  │  Redis   │
                    │+pgvector │  │ (BullMQ) │
                    └───────▲──┘  └─────┬────┘
                            │           │ jobs
                            │     ┌─────▼──────────────┐
                            └─────┤  Workers (Node/TS) │
                                  │  - indexer         │
                                  │  - reviewer        │
                                  └─────┬──────────────┘
                                        │
                      ┌─────────────────┼─────────────────┐
                      ▼                 ▼                 ▼
                 Tree-sitter         Semgrep          LLM provider
                (parse/chunk)     (static rules)   (Gemini / OpenRouter)
```

**Principles**
- Everything goes through the **Core API**. Dashboard, MCP server and workers are clients of the same data.
- The webhook handler does almost nothing: verify signature, dedupe, enqueue, return `200` fast.
- Heavy work (indexing, reviewing) happens in **BullMQ workers**.
- **One language (TypeScript)** across all apps so code and types are shared.

---

## 5. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js (App Router), React, shadcn/ui, Tailwind | |
| Data fetching | TanStack Query | caching, loading/error states |
| Auth | Clerk (GitHub social login) | dashboard only; MCP uses API keys |
| Core API | NestJS | `@nestjs/bullmq`, class-validator or Zod |
| Queue | BullMQ + Redis | retries, backoff, rate limiting |
| Database | PostgreSQL + **pgvector** | relational data + embeddings in one DB |
| ORM | Drizzle | native pgvector support |
| GitHub | GitHub App + Octokit (`@octokit/app`) | installation tokens, webhooks |
| Code parsing | tree-sitter (Node bindings) | chunk by function/class |
| Static analysis | Semgrep CLI | called via `child_process` |
| LLM | Gemini (AI Studio) + OpenRouter free models | behind a provider interface |
| Embeddings | Gemini embedding model | dimension set via env |
| MCP | `@modelcontextprotocol/sdk` (TypeScript) | stdio + Streamable HTTP |
| Validation | Zod | shared schemas in `packages/shared` |
| Monorepo | pnpm workspaces + Turborepo | |
| Local infra | Docker Compose (Postgres, Redis) | |
| Dev tunnel | smee.io or ngrok | local GitHub webhooks |
| CI | GitHub Actions | lint, typecheck, tests |
| Observability (optional) | Langfuse (LLM traces), Sentry | |

---

## 6. Repository structure

```
codereview/
├── apps/
│   ├── web/          # Next.js dashboard
│   ├── api/          # NestJS core API + webhook endpoint
│   ├── worker/       # BullMQ workers (indexer, reviewer)
│   └── mcp/          # MCP server
├── packages/
│   ├── db/           # Drizzle schema, migrations, client
│   ├── shared/       # Zod schemas, shared types, constants
│   └── llm/          # LLM provider interface + implementations
├── evals/            # sample PRs + expected findings
├── docker-compose.yml
├── CLAUDE.md
└── turbo.json
```

---

## 7. Review pipeline

Triggered by a GitHub `pull_request` event (`opened`, `synchronize`, `reopened`) or by the MCP `review_diff` tool.

1. **Webhook**: verify `X-Hub-Signature-256`, dedupe on `X-GitHub-Delivery`, enqueue `review` job, return `200`.
2. **Fetch**: worker gets an installation token, downloads the PR diff and changed file contents. Skip lockfiles, generated files, binaries, and paths in `ignored_paths`.
3. **Parse**: Tree-sitter extracts changed functions/classes and their imports/calls.
4. **Static analysis**: run Semgrep on changed files, producing deterministic findings.
5. **Context retrieval**: for each changed hunk, embed it and run a pgvector similarity search, and also fetch definitions of called/imported symbols. Cap context size.
6. **LLM review**: one call per file (or hunk group) with a strict **JSON schema** output: `file, line_start, line_end, severity, category, message, suggestion, confidence`. Validate with Zod, and retry once on malformed output.
7. **Validation / ranking**:
   - verify the line numbers exist in the diff,
   - merge duplicates (LLM + Semgrep),
   - drop low confidence and pure nitpicks (based on `strictness`),
   - rank by severity, cap at `max_comments` per PR.
8. **Persist** the review and findings in Postgres.
9. **Post** a single GitHub PR review with inline comments plus a short summary.

### Indexing (separate job, `index_repo`)
- Shallow-clone repo, walk files, skip ignored paths.
- Chunk with Tree-sitter by symbol (fallback: fixed-size windows with overlap).
- Embed chunks, upsert into `code_chunks` keyed by `content_hash` so unchanged chunks are not re-embedded.
- Incremental re-index on push: only changed files.
- Delete the clone after indexing. Never log source code.

---

## 8. Database schema

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id text UNIQUE NOT NULL,
  email text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  github_installation_id bigint UNIQUE NOT NULL,
  account_login text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE repositories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid REFERENCES installations(id) ON DELETE CASCADE,
  github_repo_id bigint UNIQUE NOT NULL,
  full_name text NOT NULL,                -- "owner/name"
  default_branch text,
  enabled boolean DEFAULT false,
  index_status text DEFAULT 'none',       -- none | indexing | ready | failed
  last_indexed_sha text
);

CREATE TABLE repo_settings (
  repo_id uuid PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
  strictness text DEFAULT 'medium',       -- low | medium | high
  custom_rules jsonb DEFAULT '[]',        -- [{ "rule": "no console.log in src/", "severity": "low" }]
  ignored_paths text[] DEFAULT '{}',
  max_comments int DEFAULT 15
);

CREATE TABLE pull_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id uuid REFERENCES repositories(id) ON DELETE CASCADE,
  number int NOT NULL,
  title text,
  author text,
  head_sha text,
  base_sha text,
  status text,                            -- open | closed | merged
  UNIQUE (repo_id, number)
);

CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_id uuid REFERENCES pull_requests(id) ON DELETE CASCADE,  -- nullable for local MCP reviews
  repo_id uuid REFERENCES repositories(id) ON DELETE CASCADE,
  head_sha text,
  trigger text NOT NULL,                  -- webhook | mcp
  status text NOT NULL,                   -- queued | running | completed | failed
  provider text,
  model text,
  tokens_in int,
  tokens_out int,
  duration_ms int,
  summary text,
  error text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid REFERENCES reviews(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  line_start int NOT NULL,
  line_end int,
  severity text NOT NULL,                 -- critical | high | medium | low | info
  category text NOT NULL,                 -- bug | security | performance | style | maintainability
  source text NOT NULL,                   -- llm | semgrep
  message text NOT NULL,
  suggestion text,
  confidence real,
  posted boolean DEFAULT false,
  github_comment_id bigint
);

CREATE TABLE code_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id uuid REFERENCES repositories(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  symbol text,
  language text,
  start_line int,
  end_line int,
  content text NOT NULL,
  content_hash text NOT NULL,
  commit_sha text,
  embedding vector(768)                   -- must match EMBEDDING_DIM / model
);
CREATE INDEX ON code_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON code_chunks (repo_id, file_path);

CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  name text,
  prefix text NOT NULL,                   -- first chars, shown in the UI
  key_hash text NOT NULL,                 -- store a hash only, never the raw key
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE webhook_deliveries (
  delivery_id text PRIMARY KEY,           -- idempotency for GitHub retries
  event text,
  received_at timestamptz DEFAULT now()
);
```

Always record `provider`, `model`, tokens and duration per review. It is cheap now and useful for the demo.

---

## 9. REST API (the contract)

Base path `/api`. Dashboard routes use the Clerk session; MCP routes use `Authorization: Bearer <api_key>`. All request/response shapes live as Zod schemas in `packages/shared`.

### Repos & settings
```
GET    /api/repos                      list connected repos
POST   /api/repos/:id/enable           { enabled: boolean }
POST   /api/repos/:id/index            trigger (re)indexing
GET    /api/repos/:id/settings
PUT    /api/repos/:id/settings
```

### Reviews & findings
```
GET    /api/repos/:id/reviews          paginated review history
GET    /api/reviews/:id                review + findings
GET    /api/stats                      { totalReviews, totalFindings, activeRepos }
POST   /api/reviews/diff               review a raw diff (used by MCP)  → { reviewId }
GET    /api/reviews/:id/status         queued | running | completed | failed
```

### Search & rules (used by MCP)
```
POST   /api/repos/:id/search           { query, limit } → ranked code chunks
GET    /api/repos/:id/rules            effective review rules
GET    /api/repos/:id/prs/:number/findings
```

### GitHub
```
GET    /api/github/install-url         URL for the "Connect GitHub" button
GET    /api/github/callback            Setup URL: receives installation_id, saves it
POST   /webhooks/github                webhook endpoint (signature-verified, no auth)
```

### API keys
```
GET    /api/keys
POST   /api/keys                       → returns the raw key ONCE
DELETE /api/keys/:id
```

---

## 10. MCP server (`apps/mcp`)

Goal: use the reviewer **from inside Claude Code**, exactly like Greptile's MCP, with tools the agent can call and slash commands the human can type.

### Transports
- **stdio** for local dev and the demo (simplest).
- **Streamable HTTP** at `/mcp` for a remote deployment.

### Auth
API key generated in the dashboard, sent as `CODEREVIEW_API_KEY` (stdio, env) or `Authorization: Bearer ...` (HTTP). The MCP server only talks to the Core API, never directly to the DB or GitHub.

### Tools (callable by the agent)

| Tool | Input | What it does |
|---|---|---|
| `review_diff` | `{ diff: string, repo?: string }` | Reviews a raw git diff (local uncommitted/branch changes), returns findings |
| `get_pr_review` | `{ repo: string, pr_number: number }` | Returns the AI findings on a PR so the agent can fix them |
| `search_codebase` | `{ repo: string, query: string, limit?: number }` | Semantic search over the indexed repo |
| `get_review_rules` | `{ repo: string }` | Returns the repo's custom rules so the agent follows them |
| `explain_finding` | `{ finding_id: string }` | Longer explanation and suggested fix for one finding |
| `list_repos` | `{}` | Connected repos (so the agent can pick a valid `repo`) |

Tool results should be **compact, structured text/JSON**: file, line, severity, message, suggestion. Do not dump whole files.

### Prompts = slash commands
MCP **prompts** show up in Claude Code as slash commands named `/mcp__<server>__<prompt>`. With the server registered as `codereview`:

| Slash command | Prompt behaviour |
|---|---|
| `/mcp__codereview__review` | Tells the agent to run `git diff` (staged + unstaged), call `review_diff`, then summarize the findings by severity |
| `/mcp__codereview__review_pr` (arg: `pr_number`) | Calls `get_pr_review`, lists findings |
| `/mcp__codereview__fix_findings` (arg: `pr_number`) | Calls `get_pr_review`, then fixes each finding in the working tree, one at a time, and shows the diff |
| `/mcp__codereview__search` (arg: `query`) | Calls `search_codebase` and explains the results |

Optional shortcut: add a thin wrapper in the consuming repo at `.claude/commands/review.md` so the user can just type `/review`, with a body like:
`Run git diff, send it to the codereview MCP tool review_diff, and summarize the findings by severity.`

### Registering the server in Claude Code
```bash
# Local (stdio)
claude mcp add codereview \
  --env CODEREVIEW_API_URL=http://localhost:4000 \
  --env CODEREVIEW_API_KEY=crk_xxxxx \
  -- node apps/mcp/dist/stdio.js

# Remote (HTTP)
claude mcp add --transport http codereview https://<host>/mcp \
  --header "Authorization: Bearer crk_xxxxx"
```

### Implementation notes
- Use `@modelcontextprotocol/sdk` with Zod input schemas.
- `review_diff` is asynchronous under the hood: POST the diff, then poll `/api/reviews/:id/status` until done (with a timeout, ~60-120 s) and return the result.
- Keep tool descriptions precise, because the agent uses them to decide when to call a tool.
- Never write to stdout in stdio mode except protocol messages (log to stderr).

---

## 11. LLM strategy (free tier)

We are students on free tiers, so the app must be **model-agnostic**.

- `packages/llm` exposes one interface, e.g. `generateJson<T>({ system, prompt, schema }) → T`.
- Implementations: Gemini (AI Studio) and OpenRouter (OpenAI-compatible). The active one comes from env (`LLM_PROVIDER`, `LLM_MODEL`). **Do not hardcode model names** in business logic.
- Wrap calls with the BullMQ rate limiter, exponential backoff, and a provider fallback (Gemini → OpenRouter).
- Free/small models are weaker at structured output: always validate with Zod and retry once with the validation error in the prompt.
- Use Semgrep and cheap heuristics first so the LLM only handles what needs it.
- Keep context small: changed hunks + top-k retrieved chunks + called symbols.
- Upgrading to a better model later should be a config change only.

---

## 12. Requirements

### Functional
- FR1: A user can sign in with GitHub and connect their repos via the GitHub App.
- FR2: A user can enable/disable reviews per repo and configure strictness, ignored paths and custom rules.
- FR3: On a PR event, the system posts an inline review on GitHub within a few minutes.
- FR4: Findings are stored and viewable in the dashboard with severity, category, file, line and suggestion.
- FR5: A repo can be indexed and semantically searched.
- FR6: A developer can generate an API key and use the MCP server from Claude Code.
- FR7: Via MCP, a developer can review local changes, fetch PR findings, and search the codebase.

### Non-functional
- NFR1: Webhook endpoint responds in under 3 seconds (all work is queued).
- NFR2: Jobs are idempotent and retried with backoff; GitHub redelivery must not create duplicate reviews.
- NFR3: Secrets only in env vars; never commit keys; never log source code.
- NFR4: API keys stored hashed; GitHub tokens are short-lived installation tokens.
- NFR5: Everything runs locally with `docker compose up` + `pnpm dev`.
- NFR6: Strict TypeScript, shared Zod schemas, lint + typecheck in CI.

---

## 13. Environment variables

```bash
# Core
DATABASE_URL=postgres://postgres:postgres@localhost:5432/codereview
REDIS_URL=redis://localhost:6379
API_PORT=4000

# GitHub App
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=        # PEM, with \n escaped
GITHUB_WEBHOOK_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

# LLM
LLM_PROVIDER=gemini            # gemini | openrouter
LLM_MODEL=
GEMINI_API_KEY=
OPENROUTER_API_KEY=
EMBEDDING_MODEL=
EMBEDDING_DIM=768              # must match the vector(...) column

# MCP
CODEREVIEW_API_URL=http://localhost:4000
CODEREVIEW_API_KEY=
```

---

## 14. Local development

```bash
pnpm install
docker compose up -d                 # postgres (with pgvector) + redis
pnpm --filter db migrate             # run Drizzle migrations
pnpm dev                             # runs web, api, worker, mcp via turbo
npx smee -u https://smee.io/<channel> -t http://localhost:4000/webhooks/github
```

Semgrep must be installed locally (`pip install semgrep` or `brew install semgrep`) for the worker.

---

## 15. Demo plan

1. Show the dashboard: log in, connect GitHub, enable a repo, index it.
2. Open a PR with a planted bug and a planted security issue on that repo.
3. Show the webhook → queue → worker flow (logs or Langfuse trace).
4. Show the inline comments the bot posted on the PR, and the same findings in the dashboard.
5. In Claude Code: make a local change, type `/mcp__codereview__review`, and show the findings.
6. Run `/mcp__codereview__fix_findings` to show the agent fixing issues from the review.
7. Show the eval results: precision on the sample PR set.

---

## 16. Conventions for Claude Code

- Read this file before making architectural changes. If you need to deviate, say so and update this file.
- TypeScript strict mode everywhere. Shared types and Zod schemas live in `packages/shared`. Do not duplicate them.
- DB access only through `packages/db`. Schema changes go through Drizzle migrations.
- All LLM calls go through `packages/llm`. Never call a provider SDK directly from business code.
- Keep modules small and independently testable. Respect module ownership (section 3); do not refactor another module's internals without asking.
- Prefer simple and working over clever. This is a demo.
- Never commit secrets. Never log source code or tokens.
- Write a short test for each pipeline stage (parsing, validation/ranking, line-number checks).
- Before finishing a task: run lint, typecheck and tests.

---

## 17. Future work (post-demo)

- Better models (swap via env), prompt tuning driven by the eval set.
- Call-graph / cross-file dependency context.
- Learning from dismissed/accepted comments per repo.
- GitLab support, team workspaces, usage limits and billing.
- OAuth-based MCP auth (spec-compliant) instead of API keys.
- Sandbox test execution for validating findings.

---

## 18. Implementation status and deviations (keep this current)

### Built
- `packages/shared`: Zod schemas for every API shape, queue names, job payloads, env helpers.
- `packages/db`: Drizzle schema for all tables in section 8, first migration, `migrate` script (creates the `vector` extension first).
- `packages/llm`: `generateJson` (Zod validation, one retry with the error, backoff on 429/5xx, provider fallback), Gemini + OpenRouter over plain `fetch`, Gemini embeddings, call throttling.
- `apps/api`: every route in section 9, API-key + Clerk auth guard, webhook (signature, dedupe, enqueue), installation sync.
- `apps/worker`: review pipeline steps 2 and 4-9, indexer (`index-repo` job).
- `apps/mcp`: the 6 tools and 4 prompts, stdio and Streamable HTTP.

### Added after the first demo
- **Containers:** one root `Dockerfile` with a target per service (`api`, `worker`, `web`, `mcp`, `migrate`, `smee`); `docker-compose.yml` runs the whole stack (`docker compose up --build`), migrations run automatically, the worker image has git + Semgrep. Host ports are configurable (`WEB_HOST_PORT`, `API_HOST_PORT`, ...).
- **One-click GitHub App:** the dashboard's "Create GitHub App" uses GitHub's manifest flow (`POST /api/setup/github-app`, `GET /api/github/manifest-callback`). Credentials are stored in the `github_app` table and read through `getGithubAppConfig` (packages/db); `GITHUB_APP_*` env vars are only a fallback. The `smee` container creates a webhook channel and writes it to a shared volume (`/data/smee-url`), which the manifest uses as the webhook URL (or `WEBHOOK_URL`/`SMEE_URL`).
- **Agent visibility:** the worker adds an "eyes" reaction and an "AI Code Review" check run on the PR (best effort, needs the app's `checks: write` permission), and writes one `review_events` row per pipeline stage. `GET /api/reviews/:id/events` returns the timeline shown on the review page.
- **Real-time updates (SSE + Redis Pub/Sub):** the worker writes to Postgres first (source of truth), then publishes to Redis channels `notify:user:<userId>` and `review:<reviewId>` (`CHANNELS` in packages/shared). The API's `RealtimeService` holds one Redis subscriber and fans messages out to SSE connections: `GET /api/notifications/stream` and `GET /api/reviews/:id/stream` (ready event on connect, heartbeat every 25 s, unsubscribes when the last listener leaves). The dashboard reads them with `fetch` (`useEventStream`), because `EventSource` cannot send the Clerk `Authorization` header; on every (re)connect it re-reads the DB to catch up, and falls back to slow polling while the stream is down.
- **Notifications:** `notifications` table (migration 0003). The worker notifies the repo owner (or the MCP requester) when a review completes or fails for good, and when indexing finishes or fails. Bell + toasts in the dashboard header. No browser push when the dashboard is closed.
- **Tree-sitter** (via WebAssembly: `web-tree-sitter` + `tree-sitter-wasms`, no native build): `apps/worker/src/index/symbols.ts`. Used for symbol-based chunking when indexing and for pipeline step 3 (changed functions and what they call; their definitions are pulled from the index as context). TypeScript/JS, Python, Go, Java, Ruby and Rust have grammars; other languages fall back to line windows.
- **Incremental re-index:** a `push` webhook on the default branch of an indexed repo enqueues an `index-repo` job with `paths`/`removed`; only those files are re-chunked.
- **Evals:** `evals/` has 6 cases (5 planted-bug diffs + a clean change); `pnpm eval` reports recall, precision and false alarms against the running API.
- **CI:** `.github/workflows/ci.yml` (build, typecheck, test, docker build).

### Not built yet
- Langfuse/Sentry.

### Deviations from the sections above
- Everything is ESM (`"type": "module"`, `module: NodeNext`): relative imports need the `.js` extension. Packages compile to `dist/` with `tsc`; apps import them from `dist`, so run `pnpm build` (or `pnpm dev`, which builds first) after changing a package.
- `reviews.user_id` was added: who requested an MCP review (those have no repo/PR to check ownership on).
- `installations.user_id` is null until the Connect GitHub callback runs (the webhook can arrive first).
- Extra route `GET /api/findings/:id` (for the MCP `explain_finding` tool).
- Extra env vars: `GITHUB_APP_SLUG`, `WEB_URL`, `AUTH_DEV_BYPASS`, `LLM_FALLBACK_MODEL`, `LLM_MIN_INTERVAL_MS`, `SEMGREP_CONFIG`, `MCP_PORT`.
- The index queue is named `index-repo` (BullMQ queue names), the job is still "index_repo" conceptually.
- LLM providers are called over HTTP directly instead of through their SDKs.
- Besides Gemini and OpenRouter, `LLM_PROVIDER` / `LLM_FALLBACK_PROVIDER` accept `openai`: any OpenAI-compatible endpoint (`OPENAI_COMPAT_BASE_URL` + `OPENAI_COMPAT_API_KEY`), e.g. NVIDIA NIM or Groq, whose free tiers are far larger than Gemini's ~20 review calls/day. Embeddings still use Gemini only.
- `pnpm db:migrate` is the root alias for `pnpm --filter db migrate`.
- `GEMINI_BASE_URL` (optional) points the Gemini provider at another host; used only to replay recorded answers in tests.

### Verified on 2026-10-04
- Real Gemini (`gemini-3.5-flash`) answered the review prompt with schema-valid JSON and found both planted issues; `gemini-embedding-001` returns 768-dim vectors through `batchEmbedContents`. `gemini-flash-latest` returned 503 (overloaded) on three attempts.
- MCP `review_diff` -> API -> queue -> worker -> findings in Postgres -> back to MCP works, using that recorded Gemini answer.
- Never run for real yet: anything GitHub (webhook from a real PR, posting comments, cloning), indexing + pgvector search, Semgrep, Clerk login, OpenRouter fallback.

### Verified on 2026-10-04 (later)
- Real PR review end to end on `Sliim-Bouzidi/Nexora` PR #1: GitHub App install -> webhook via smee -> worker -> 8 inline comments posted (all 4 planted issues found). Semgrep skipped (not installed).
- `apps/web` dashboard exists: overview, repositories (enable/index), repo reviews + settings, review detail, API keys. UI components copied from `next-shadcn-dashboard-starter` (shadcn base-nova, Base UI, Tabler icons).
- Dashboard was exercised in a browser against the real API in dev-bypass mode. Clerk keys were added afterwards and sign-in works; `AUTH_DEV_BYPASS` must be `false` for the API to require a Clerk session.
- `apps/web` reads the root `.env` (see `next.config.ts`). `start.bat` starts database, webhook forwarder and `pnpm dev` (output in `dev.log`).
- Known gap: repos connected while in dev-bypass mode belong to the `dev-user`; after enabling Clerk the signed-in user must reconnect GitHub to see them.
