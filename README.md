# AI Code Reviewer

An AI reviewer for GitHub pull requests. It reads the diff **and** the surrounding codebase (Tree-sitter + pgvector + Semgrep), asks an LLM for findings, and posts them as inline comments on the PR. The same engine is available inside Claude Code through an MCP server.

You can watch it work in three places: the PR on GitHub (an "AI Code Review" check run), the dashboard (live pipeline timeline) and the worker log.

## Run it (Docker, 4 steps)

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/), a free [Clerk](https://dashboard.clerk.com) application for sign-in (enable GitHub as a sign-in method), and a free [Gemini API key](https://aistudio.google.com/apikey).

Sign-in is **required**. The first time you open the dashboard it asks for the two Clerk keys: paste them and sign-in works immediately, no `.env` edit or rebuild.

```bash
git clone https://github.com/Sliim-Bouzidi/The-AI-Code-Reviewer.git
cd The-AI-Code-Reviewer
cp .env.example .env          # Windows: copy .env.example .env
# optional: put keys in .env instead of pasting them in the dashboard
docker compose up --build
```

Open **http://localhost:3000** and follow the dashboard:

1. **Create GitHub App & connect.** One click. GitHub shows a single confirmation page; the app's keys are saved for you (nothing to copy into `.env`). The compose stack already created a public webhook URL for it.
2. **Pick the repositories** to install it on.
3. On the **Repositories** page, turn reviews **on** for a repo (optionally click *Index* so the reviewer knows the whole codebase).
4. **Open a pull request** on that repo. The bot reacts with 👀 and starts an "AI Code Review" check, then posts inline comments. Open the review in the dashboard to see each pipeline step live.

**Recommended: add a second free AI provider.** Gemini's free tier allows only about 20 review calls a day. Any OpenAI-compatible provider works as a fallback, for example NVIDIA NIM (free key at https://build.nvidia.com/settings/api-keys, ~40 requests/minute) or Groq (https://console.groq.com/keys, no card). In `.env`:

```
OPENAI_COMPAT_BASE_URL=https://integrate.api.nvidia.com/v1
OPENAI_COMPAT_API_KEY=your-nvidia-key
LLM_FALLBACK_PROVIDER=openai
LLM_FALLBACK_MODEL=z-ai/glm-5.3
```

The first `docker compose up --build` takes a few minutes (it builds the images). Later starts take seconds.

### What runs

| Container | What it is |
|---|---|
| `postgres` | PostgreSQL 16 + pgvector (code embeddings and all data) |
| `redis` | BullMQ job queues |
| `migrate` | applies database migrations, then exits |
| `api` | NestJS Core API + GitHub webhook endpoint (port 4000) |
| `worker` | review + indexing pipelines (Tree-sitter, Semgrep, LLM) |
| `web` | Next.js dashboard (port 3000) |
| `mcp` | MCP server over HTTP (port 4100) |
| `smee` | forwards GitHub webhooks to the API through a smee.io channel |

Stop everything with `docker compose down` (add `-v` to also delete the database).

### Troubleshooting

- **Nothing happens when I open a PR.** The repo must be *enabled* on the Repositories page, and the PR must not be a draft. Check `docker compose logs smee api worker`.
- **"No public webhook URL yet".** The `smee` container could not create a channel (no internet?). Set `SMEE_URL` in `.env` to a channel from https://smee.io/new and restart.
- **Reviews fail with an LLM error.** Check `GEMINI_API_KEY`; free keys are rate limited, so the pipeline spaces its calls out (`LLM_MIN_INTERVAL_MS`).
- **Port already in use.** Stop whatever uses 3000, 4000, 5432 or 6379 (for example a local `pnpm dev`).

## Use it from Claude Code (MCP)

Create an API key on the dashboard's **API Keys** page, then:

```bash
claude mcp add --transport http codereview http://localhost:4100/mcp \
  --header "Authorization: Bearer crk_xxxxx"
```

Slash commands: `/mcp__codereview__review` (review your local changes), `/mcp__codereview__review_pr`, `/mcp__codereview__fix_findings`, `/mcp__codereview__search`.

## How a review works

1. **Webhook:** verify the signature, dedupe, enqueue, answer `200`.
2. **Fetch** the PR diff; skip lockfiles, generated files and ignored paths.
3. **Parse** the changed files with Tree-sitter: which functions changed and what they call.
4. **Static analysis** with Semgrep.
5. **Context:** similar code from pgvector plus the definitions of the functions the change calls.
6. **LLM review:** one call per file with a strict JSON schema, validated with Zod.
7. **Validate and rank:** check line numbers, merge duplicates, apply strictness, cap the comment count.
8. **Persist** findings in Postgres, **post** one PR review and finish the check run.

Each step is written to `review_events`, which is what the dashboard timeline shows.

## Automatic Test Generation (Java JUnit 5 + Mockito)

Automatically generates unit tests for modified Java methods in Pull Requests and validates them in a secure Docker sandbox.

```
Automatic Test Generation
├── Java Context Extraction (Tree-sitter)
├── LLM JUnit 5 / Mockito Generation
├── Docker Sandbox Isolation (eclipse-temurin:21-jdk-alpine)
├── Test Execution Validation
├── BullMQ Worker Pipeline
├── NestJS API & Next.js Dashboard
└── GitHub PR Summary Comment (Idempotent)
```

1. **Java Context Extraction:** Tree-sitter parses modified `.java` files and extracts method signatures, parameters, return types, and method code.
2. **LLM Generation:** Uses structured Zod validation to generate JUnit 5 + Mockito unit tests covering normal, edge case, and error scenarios.
3. **Docker Sandbox Execution:** Compiles and executes tests inside an ephemeral, network-isolated container (`--network none`, `--memory 512m`, `--cpus 1`, `--security-opt no-new-privileges`).
4. **Persistence & Exposure:** Stores execution status (`PASSED`, `FAILED`, `REJECTED`, `TIMEOUT`) in PostgreSQL, exposed via NestJS API & Next.js Dashboard.
5. **GitHub Integration:** Posts/updates an idempotent summary comment on the Pull Request (`<!-- ai-code-review-test-generation -->`).


## Develop without Docker

```bash
pnpm install
docker compose up -d postgres redis smee     # databases + webhook tunnel only
pnpm db:migrate
pnpm dev                                      # web, api, worker, mcp
```

For the tunnel to reach `pnpm dev` on your machine, set `SMEE_TARGET=http://host.docker.internal:4000/webhooks/github` in `.env` before starting `smee`, and `SMEE_FILE=` pointing at a local file is not needed: set `WEBHOOK_URL` to your smee channel instead.

Other commands: `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm cr repos` (terminal client), `pnpm eval` (quality check below).

## Quality check (evals)

`evals/` holds small diffs with planted bugs plus one clean change. With the stack running:

```bash
pnpm eval
```

It sends each diff through the API and prints recall (planted issues found), precision (findings that hit a planted issue) and false alarms on the clean change.

## Project layout

```
apps/web      Next.js dashboard          apps/api     NestJS API + webhooks
apps/worker   review + index pipelines   apps/mcp     MCP server
packages/db   Drizzle schema + migrations
packages/llm  provider interface (Gemini, OpenRouter)
packages/shared  Zod schemas and shared types
evals/        planted-bug diffs          scripts/     CLI + eval runner
```

See [CLAUDE.md](CLAUDE.md) for the full architecture and conventions.
