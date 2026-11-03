# syntax=docker/dockerfile:1.7

# The API and the worker: built from the repo root (`docker build -f apps/api/Dockerfile .`),
# since the lockfile is there. Two targets from one build, so the two processes can never run
# different code against the same database: `worker`, and `api` (last, the default, and what
# Railway builds). Keep BUN_VERSION with `packageManager` in package.json, which CI reads.
ARG BUN_VERSION=1.4.4

FROM oven/bun:${BUN_VERSION} AS deps
WORKDIR /app
# Every workspace's manifest, which a frozen install checks against the lockfile.
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# --ignore-scripts: the only install script wires git hooks, and there's no repo here.
# --omit=peer: Bun installs a package's optional peers whenever the lockfile has them, and Better
# Auth's (drizzle-kit, Vite, TanStack Start) and Drizzle's (PGlite) would triple the image. The
# API's own dependencies cover every peer it uses.
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --ignore-scripts --production --omit=peer --filter @worklog/api

FROM oven/bun:${BUN_VERSION}-slim AS runtime
# What a deployment reports as its release in health checks and telemetry. Railway also sets
# RAILWAY_GIT_COMMIT_SHA, which the processes read when this is empty.
ARG WORKLOG_RELEASE=""
ENV NODE_ENV=production \
    WORKLOG_RELEASE=${WORKLOG_RELEASE}
WORKDIR /app
COPY --from=deps --chown=bun:bun /app/node_modules ./node_modules
COPY --from=deps --chown=bun:bun /app/apps/api/node_modules ./apps/api/node_modules
COPY --chown=bun:bun package.json ./
COPY --chown=bun:bun apps/api/package.json apps/api/tsconfig.json apps/api/
COPY --chown=bun:bun apps/api/drizzle apps/api/drizzle
COPY --chown=bun:bun apps/api/scripts apps/api/scripts
COPY --chown=bun:bun apps/api/src apps/api/src
USER bun
WORKDIR /app/apps/api

FROM runtime AS worker
ENV WORKER_PORT=4001
EXPOSE 4001
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["bun", "-e", "fetch(`http://127.0.0.1:${process.env.WORKER_PORT}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "src/worker.ts"]

FROM runtime AS api
ENV PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["bun", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "src/index.ts"]
