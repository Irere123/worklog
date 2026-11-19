# Deploying Worklog

Worklog runs as three processes and a database. Each process has its own image, built from this repo and published to GitHub's container registry by CI.

```
 browser, webhooks, agents
        │  HTTPS
        ▼
 ┌─ web ─────────────────────┐   the only public service
 │ Caddy: the built web app, │   /v1, /api/auth, /hooks, /oauth,
 │ and the API's paths ──────┼──▶ /docs, /openapi.json
 └───────────────────────────┘            │  private network
                                          ▼
 ┌─ api ────────────────┐      ┌─ worker ────────────────────┐
 │ Bun: REST, SSE,      │      │ Bun: ingestion, automations, │
 │ webhooks, sign-in    │      │ cron, Discord's Gateway      │
 └──────────┬───────────┘      └──────────────┬───────────────┘
            └───────────── Postgres ──────────┘  (data and the job queue)
```

| Image | Built from | Runs | Health |
| --- | --- | --- | --- |
| `ghcr.io/irere123/worklog-web` | `apps/web/Dockerfile` | Caddy with the static app; plain HTTP on 8080, or HTTPS itself when given a host name | `GET :8081/health` (and `/health` on the site) |
| `ghcr.io/irere123/worklog-api` | `apps/api/Dockerfile`, target `api` | `bun src/index.ts` on 4000; `bun scripts/migrate.ts` for the migrate step | `GET :4000/health` |
| `ghcr.io/irere123/worklog-worker` | `apps/api/Dockerfile`, target `worker` | `bun src/worker.ts`; serves only its health check on 4001 | `GET :4001/health` |

- **The API and the worker build from one Dockerfile,** so the two can't run different code against the same database. Their images hold the API's production dependencies only (about 90 MB of them), and run as a non-root user.
- **The browser sees one origin.** `web` passes the API's paths to `api`, so the session cookie and event streams need no CORS, and the API needs no public address. It flushes event streams and the assistant's replies as they're written, serves the app's files precompressed (Brotli, gzip), caches hashed files for good and never the HTML, answers `/` with the prerendered front page and any other deep link with the shell, and a missing `/assets/` file with a 404.
- **Health checks ask the database.** `/health` on the API and the worker answers 503 once Postgres stops answering, and names the running release.
- **Migrations are their own step:** `bun scripts/migrate.ts` (`bun run db:migrate`), run once per deploy before the new processes start, so a migration that fails stops the rollout while the old version keeps serving. The processes also migrate at startup (a no-op after the step), so a setup without it still works. Keep migrations additive (add, then backfill, then remove in a later release): during a rollout, and after a rollback, the old code runs against the new schema.
- **Shutdown drains.** On SIGTERM the API stops taking requests, gives open ones 10 seconds, then cuts event streams (browsers reconnect with `Last-Event-ID` and miss nothing), closes the database and flushes telemetry. The worker lets running jobs finish. Give the API 30 seconds and the worker 2 minutes before a hard kill; both setups below do.
- **A worker whose job runner stops exits,** so the platform restarts it instead of leaving a process that looks alive and takes no jobs.
- **Production refuses to start half set up:** without `WORKLOG_SECRET_KEY`, `AUTH_SECRET` and `PUBLIC_URL`, the processes exit with what's missing.

## Railway

`.railway/railway.ts` describes the project: Postgres and the `api`, `worker` and `web` services, each built from its Dockerfile when a commit to `main` touches its paths and its GitHub checks have passed. It's applied with the Railway CLI's `railway config plan` and `railway config apply`.

### The first time

1. **Install the Railway CLI** ([docs](https://docs.railway.com/guides/cli)), then `railway login`. Give Railway's GitHub app access to this repository.
2. **Create the project and link this checkout:** `railway init` (or create it in the dashboard), then `railway link` from the repo root.
3. **Set the shared variables** (Project Settings → Shared Variables). Never put them in `.railway/railway.ts`: it's in git, and the SDK's `randomString` is a hash of its label, which anyone can recompute.

   | Shared variable | Value |
   | --- | --- |
   | `WORKLOG_SECRET_KEY` | `openssl rand -hex 32`. It encrypts connection secrets at rest; keep a copy somewhere safe. Rotate it as [ARCHITECTURE.md](ARCHITECTURE.md#configuration) describes. |
   | `AUTH_SECRET` | `openssl rand -hex 32` |
   | `PUBLIC_URL` | `https://` and the web service's domain: your custom domain, or the Railway domain from step 5 (set it then). |

4. **Apply:** `railway config plan` shows what will be created; `railway config apply` creates it. The services build and deploy.
5. **Give `web` a domain:** its Settings → Networking → Generate Domain, or add your custom domain there and point its DNS as shown. If `PUBLIC_URL` was waiting on it, set it now and redeploy `api` and `worker`. Leave `api` and `worker` without a public domain: they're reached over the private network.
6. **Turn on backups:** the Postgres service's Backups tab, with a daily schedule.
7. **Check it:** open the domain, create the first workspace, and look at `api`'s deploy logs for "Worklog API started". For a server only your team uses, set `SIGNUP=closed` on `api`, so strangers who sign in can't start workspaces of their own.

### From then on

- **Deploys:** merge to `main`. CI checks the code, builds the three images, starts them together against Postgres and probes them; Railway waits for those checks (`checkSuites`) before building, so what deploys is what CI tested. `api` runs migrations as its pre-deploy step; each service keeps serving until its replacement passes its health check.
- **Integrations** (AI, email, file storage, GitHub, Slack, Discord, Tinybird): set the variable as a shared variable, add its name to `INTEGRATIONS` in `.railway/railway.ts`, commit, then `railway config apply`. [`apps/api/.env.example`](../apps/api/.env.example) lists them all.
- **The GitHub App:** one app serves every workspace on the server, so teams install it with one click from Settings → Connections. Create it once, against the deployed domain:
  1. `bun run github-app --url https://your-domain` from a checkout, and open the address it prints in a browser on the same machine (over SSH, forward the port first, or paste back the address GitHub leaves you on). GitHub asks you to confirm the app's name; `--org acme` creates it under an organization, and `--private` limits installs to its owner.
  2. Set each line of the `github-app.env` it writes as a shared variable, then delete the file.
  3. Their names are already in `INTEGRATIONS`: `railway config apply`, and `api` and `worker` restart with the app. Every workspace admin now sees **Install** on GitHub.

- **Rolling back:** redeploy an earlier deployment from the service's Deployments tab. Migrations don't roll back, which is why they stay additive.
- **Scaling:** the API is stateless (events reach every replica through Postgres) and Graphile Worker shares jobs safely between workers, so both take `replicas` in `.railway/railway.ts`. Each process opens up to `DATABASE_POOL_SIZE` (20) connections; keep the total under Postgres's `max_connections` (100 on Railway's), with room for the migrate step and your own sessions.

## Docker Compose (self-hosting)

`compose.yaml` runs the same images with Postgres, a one-shot migrate step and daily backups. The API is published nowhere: only `web` faces out.

```bash
cp .env.compose.example .env        # fill in the required settings
docker compose up -d                # web on http://127.0.0.1:8080, for a proxy on this machine
```

For a server facing the internet, point a domain's DNS at it, set `WORKLOG_DOMAIN` and `PUBLIC_URL` in `.env`, and let the web server take ports 80 and 443 and get its own certificate:

```bash
docker compose -f compose.yaml -f compose.https.yaml up -d
```

- **Images:** while the repository is private, its images are too: `docker login ghcr.io` with a token that can read packages, or build this checkout with `docker compose up -d --build`. `WORKLOG_VERSION` picks a published tag (`latest`, `1.2.0`, `sha-9fceb02`).
- **Upgrading:** `docker compose pull && docker compose up -d`. The migrate step runs first; the API and the worker start only once it succeeds.
- **Backups:** a compressed `pg_dump` every day into `./backups`, kept 14 days (`BACKUP_*` in `.env`). Copy them off the machine too. To restore one into a fresh stack: `docker compose up -d postgres`, then `docker compose exec -T postgres pg_restore -U worklog -d worklog --clean --if-exists < backups/worklog-….dump`, then `docker compose up -d`.
- **The GitHub App:** create it as for Railway, with `bun run github-app --url <PUBLIC_URL>` from a checkout, and add the lines of the `github-app.env` it writes to `.env`. `docker compose up -d` picks them up.
- **Logs:** `docker compose logs -f api worker`. Each container's log is capped at five 10 MB files.

## Email that reaches the inbox

Worklog sends sign-in links, invites and briefs. The templates already do their part: a written plain-text twin, no images or tracking, a `List-Unsubscribe` header on scheduled mail. Most of what decides spam or inbox is the domain, though:

- **Send from your own domain.** Set `MAIL_FROM` to an address on a domain you control, such as `Worklog <worklog@mail.example.com>`. A subdomain keeps Worklog's reputation apart from your team's own mail.
- **Verify it with your provider.** Resend (or your SMTP provider) gives you SPF and DKIM records to add to DNS; mail isn't signed until they're live.
- **Add a DMARC record,** at least `v=DMARC1; p=none; rua=mailto:you@example.com` on `_dmarc.<domain>`. Gmail and Yahoo reject bulk mail without one.
- **Check one.** Send yourself a sign-in link and open "Show original" in Gmail: SPF, DKIM and DMARC should all say `PASS`.

## Building the images yourself

From the repo root, since the lockfile is there:

```bash
docker build -f apps/api/Dockerfile --target api -t worklog-api .
docker build -f apps/api/Dockerfile --target worker -t worklog-worker .
docker build -f apps/web/Dockerfile -t worklog-web .
```

Pass `--build-arg WORKLOG_RELEASE=$(git rev-parse --short HEAD)` to name the release in health checks and telemetry.

## CI/CD

- **`.github/workflows/ci.yml`,** on every pull request and push to `main`:
  - `check`: commit messages, format, lint, typecheck, tests, colour contrast, and the web build.
  - `images`: builds the three images, then starts them together against Postgres the way production does (migrate, then the API, worker and web) and probes them through the web server: health, the app and a deep link, a missing asset's 404, Brotli and cache headers, the API's 401, an event stream arriving unbuffered, HTTPS served by Caddy as its own user, production refusing to start without its secrets, and every container stopping within its grace period.
  - `publish` (pushes only, once both pass): pushes the images to GHCR as `latest` (from `main`), `sha-<commit>`, and the version for a `v1.2.0` tag.
- **`.github/workflows/tinybird.yml`,** when `tinybird/` changes: builds the project on Tinybird Local, and from `main` deploys it to Tinybird Cloud once the repository has the `TINYBIRD_HOST` and `TINYBIRD_DEPLOY_TOKEN` secrets (a workspace admin token, not the append token the API uses).
