# One Dockerfile for the whole monorepo. Each compose service picks a target:
#   api, worker, web, mcp, migrate, smee
# syntax=docker/dockerfile:1


FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

# ---- install dependencies (cached until a package.json / lockfile changes)
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/mcp/package.json apps/mcp/
COPY packages/db/package.json packages/db/
COPY packages/llm/package.json packages/llm/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

# ---- build every package and app
FROM deps AS build
COPY . .
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- runtime targets
FROM build AS migrate
CMD ["pnpm", "--filter", "@codereview/db", "migrate"]

FROM build AS api
EXPOSE 4000
CMD ["pnpm", "--filter", "@codereview/api", "start"]

FROM build AS web
ENV NODE_ENV=production
EXPOSE 3000
# Clerk keys are read at request time (env or pasted on the setup page). Clerk then needs an
# encryption key to pass them to server components: generate one per container start if none is set.
CMD ["sh", "-c", "export CLERK_ENCRYPTION_KEY=\"${CLERK_ENCRYPTION_KEY:-$(node -e 'process.stdout.write(require(`crypto`).randomBytes(32).toString(`hex`))')}\"; exec pnpm --filter @codereview/web start"]

FROM build AS mcp
EXPOSE 4100
CMD ["pnpm", "--filter", "@codereview/mcp", "start"]

# The worker also needs git (cloning repos to index) and Semgrep (static analysis).
FROM build AS worker
RUN apt-get update \
 && apt-get install -y --no-install-recommends git python3 python3-pip \
 && pip3 install --no-cache-dir --break-system-packages semgrep \
 && rm -rf /var/lib/apt/lists/*
CMD ["pnpm", "--filter", "@codereview/worker", "start"]

# Forwards GitHub webhooks to the API through a smee.io channel (no ngrok / port forwarding needed).
FROM node:22-slim AS smee
RUN npm install -g smee-client
COPY scripts/smee.mjs /smee.mjs
CMD ["node", "/smee.mjs"]

# Default stage for builders that do not set a target (Railway cannot pick a --target): one image with
# git + Semgrep that starts whichever app the SERVICE variable names (api | worker | mcp).
# docker compose ignores this stage and uses its own targets.
FROM worker AS final
CMD ["sh", "-c", "exec pnpm --filter @codereview/${SERVICE:-api} start"]
