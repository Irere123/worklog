# syntax=docker/dockerfile:1.7

# The web app, served by Caddy, which also passes the API's paths through to the API (Caddyfile).
# Built from the repo root (`docker build -f apps/web/Dockerfile .`), since the lockfile is there.
# Keep BUN_VERSION with `packageManager` in package.json, which CI reads.
ARG BUN_VERSION=1.4.4

FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app
# Every workspace's manifest, which a frozen install checks against the lockfile.
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# --ignore-scripts: the only install script wires git hooks, and there's no repo here.
# No cache mount: Railway only accepts one whose id is a service's, hard-coded.
RUN bun install --frozen-lockfile --ignore-scripts --filter @worklog/web
COPY apps/web apps/web
RUN bun run --filter @worklog/web build \
    && bun apps/web/scripts/precompress.ts apps/web/dist/client

FROM caddy:2-alpine AS web
# Caddy's binary may bind 80 and 443 without root, so it runs as its own user, which owns only
# where Caddy keeps certificates and state.
RUN addgroup -S web && adduser -S -G web -H web \
    && chown -R web:web /data /config
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist/client /srv
ENV SITE_ADDRESS=:8080 \
    API_UPSTREAM=api:4000
USER web
EXPOSE 8080 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8081/health"]
