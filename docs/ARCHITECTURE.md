# Worklog architecture

```
 clients: web · Expo · Slack · Discord · CLI/agents · custom integrations
        │  REST (OpenAPI 3.1)      │ SSE /v1/events         │ signed webhooks /hooks/*
        ▼                          ▼                        ▼
 ┌──────────────────────────── apps/api (Bun + Hono) ────────────────────────────┐
 │ api/routes/*  zod-openapi routes → one contract → docs + typed SDKs           │
 │ api/hooks.ts  /hooks/{connection}: verify → store raw → queue (any connector) │
 │ api/auth.ts   API keys (agents) or better-auth sessions (people) → member    │
 │                                                                               │
 │ board/        Fizzy rules: stages, golden tickets, entropy, drift nudges      │
 │ activity/     the work stream · manual logs (+ AI structuring) · snapshots    │
 │ attention/    "needs you": collapse, quotas, feedback, actions, metrics       │
 │ briefs/       data gathering → model prose (or template)                      │
 │ automations/  scheduled jobs: brief · digest · check · consolidate · custom   │
 │ agent/        assistant (owner / teammate modes), tools, models, streaming    │
 │ memory/       profile · facts · journal, visibility enforced in queries       │
 │ delivery/     email (Resend/SMTP/console) · Slack · Discord · webhook, sanitize│
 │ connectors/   GitHub · Gitea · Slack · Discord · webhook (no-code) · custom   │
 │ ingest/       pipeline: normalize · identity · gates · merge · effects        │
 │ events/bus.ts durable, sequenced event log + live fan-out                     │
 │ jobs/         Graphile Worker: queues per connection · cron schedule          │
 └───────────────────────────────────────────────────────────────────────────────┘
        │ db/queries/* (one file per area) → Drizzle ORM (one schema, one migration set)
        ▼
  Postgres (node-postgres), which also holds the Graphile Worker job queue
        │
  OpenRouter via the Vercel AI SDK v7 (main + fast model tiers)
```

## Principles

- **One contract, many clients.** Routes are declared with zod schemas. Those same schemas validate requests, serialize responses, and produce `/openapi.json`. Operation ids are stable and dotted (`card.close`), so a generated SDK reads naturally (OpenCode's pattern).
- **Everything is tenant-scoped.** Every request resolves to a member, and the member carries `workspaceId`. Services never take a workspace id from the client.
  - **People:** they sign in through better-auth (users, sessions, linked accounts). Their member row has a `userId`, and they pick a workspace with `x-worklog-workspace`.
  - **Agents and integrations:** they use API keys scoped `read`, `write` or `ingest`.
  - **Tenancy stays Worklog's:** workspaces, roles and agent members live in our own tables (better-auth users can't be agents).
  - **Invites:** a member with an email but no user is a pending invite, claimed on sign-in with that verified address.
- **Humans and agents are both members.** Every human gets a personal assistant (`agentProvider: "worklog"`, `ownerId` = the human). External agents are members with their own tokens. Board changes made by an assistant are attributed to the assistant, so the team can see which moves an agent made.
- **One write path per concept.** `recordActivity` (which also resets the card's entropy clock), `raiseAttention` (which collapses, applies quotas and triggers checks), `appendMessages` (append-only, row-locked).
- **Queries in one place, transactions that compose.** Every query lives in `db/queries/` and takes the pool or a transaction as its first argument, so any of them can run inside a transaction (Midday's layout). Domain code wraps related writes in `transact`, which gives callees a context bound to the transaction (Ecto's `Repo.transact`). Jobs commit with it, and events publish only after the commit.
- **Events after writes.** Changes publish to `events` (with a `seq`), then to live SSE subscribers. Private items carry an `audienceId`. Clients resume with `Last-Event-ID`; events are pruned after 7 days.

## The activity stream

Ingestion is a pipeline, not a set of webhook handlers. Every delivery is stored raw (`inbound_events`), then processed from the job queue in order per connection:

1. normalize: each connector translates a delivery into canonical events (a pure function);
2. identity resolution;
3. quality gates;
4. card linking;
5. burst merging;
6. persistence with provenance;
7. effects: attention, the board, and agent states.

Replays rebuild activity from the raw inbox, which keeps deliveries for `INBOUND_RETENTION_DAYS` (90 by default). A replay never reaches further back, so older activity stays as it is. See [CONNECTORS.md](CONNECTORS.md).

## The board (Fizzy rules)

| Stage | Meaning | API |
| --- | --- | --- |
| `triage` | "Maybe?": new cards land here, waiting for a decision | `DELETE /cards/{n}/triage` sends back |
| `active` | in one of the board's columns | `POST /cards/{n}/triage {columnId}` |
| `not_now` | postponed (manually or by entropy) | `POST` / `DELETE /cards/{n}/not_now` |
| `done` | closed | `POST` / `DELETE /cards/{n}/closure` |

- **Numbering:** cards are numbered per workspace.
- **Order:** there is no manual ordering. Golden tickets come first, then the most recently active cards.
- **Entropy:**
  - The period is the board's setting, otherwise the workspace's (30 days). Allowed values are 3, 7, 30, 90 and 365 days.
  - An hourly sweep moves stale active cards to `not_now`.
  - From 75% of the period onward, assignees get a "still on it?" item with one-click actions.

## Attention lifecycle

```
raiseAttention ─▶ open (consideredAt = null)
                    │  check (every 30 min in active hours; pulled to +3 min by urgent items)
                    ▼
     gates: muted kind? · priority · thread cooldown · daily cap · min gap · sender quota (at raise)
                    │
          ┌─────────┴──────────┐
     digest (+reason)     classifier (fast model, structured) ─▶ push (+reason) ─▶ notifications log
          │                                                              │
   midday/afternoon digest, morning brief                    feedback ─▶ mutedKinds ─▶ metrics
```

The fields that drive this live on `attention_items`: `consideredAt`, `disposition`, `reason`, `pushedAt`, `digestedAt`, `actedAt` and `actions`. Every push is recorded in `notifications`, and every rating in `attention_feedback`.

## The assistant

- **Two modes,** fixed per conversation:
  - **owner:** the full toolset, including writes: remember, log work, create and move cards, comment, resolve or answer attention items, give feedback.
  - **teammate:** read-only, team-visible data, plus `leave_note_for_owner`.

  The mode is decided by _who asks_. The toolset and the queries enforce it; it is not left to the prompt.

- **Append-only history.** Model messages are stored verbatim and replayed in full. The instructions are built only from values that don't change within a conversation, and per-turn context (the time, who is asking) goes into the user message. That keeps Anthropic prompt caching effective (enabled through OpenRouter, with the provider pinned for cache locality) and satisfies the preserved-thinking checks.
- **Inbox.** Briefs and pings are also written into the owner's inbox conversation, so replying "tell me more about #12" has context.
- **Untrusted content.** Every prompt marks ingested text as data, not instructions. Outbound text is sanitized against the URLs present in its source data.
- **Two tiers of model calls, each with a timeout:**
  - **main:** chat, briefs, custom automations.
  - **fast:** checks, log structuring, consolidation.

## Memory

| Kind | Analogue in OpenClaw | Written by |
| --- | --- | --- |
| `profile` | `USER.md` | you (`POST /v1/memories`), the assistant (`remember`), nightly consolidation |
| `fact` | `MEMORY.md` | the same three |
| `journal` | `memory/YYYY-MM-DD.md` | nightly consolidation, one entry per day and visibility |

Consolidation runs **twice**: once over team-visible activity (producing team memory, without ever seeing private memory) and once over private activity (producing private memory). Teammate-mode tools only query `visibility = 'team'`.

## Scheduling

- **Automations are rows** with a schedule (`daily` / `weekly` / `interval` with `activeHoursOnly`), evaluated on the member's local clock with DST handled.
- **Spreading load:** a deterministic per-automation jitter keeps jobs from all firing on the same minute.
- **Cron:** Graphile Worker's crontab (`jobs/worker.ts`) runs due automations every minute, the entropy sweep hourly, and event and delivery pruning daily. Each run fires once across all workers, and the scheduled tasks share one queue, so they never overlap.
- **Failure handling:** an attention item after 3 consecutive failures; the automation is disabled after 10.
- **Deployment:** run it in the API process (`RUN_SCHEDULER=true`) or as a separate worker (`bun run worker`).

## Configuration

See [`apps/api/.env.example`](../apps/api/.env.example). Production requires `WORKLOG_SECRET_KEY`, which encrypts connector secrets at rest with AES-256-GCM.

## Running Postgres

- **Migrations run at startup.** The API and the worker take the same advisory lock, so only one of them migrates. An index on an existing table is built `CONCURRENTLY`, so ingest keeps writing while it builds.
- **Connections:** each process keeps its own pool of 10. PgBouncer is optional; if you add it, use session pooling, because Graphile Worker `LISTEN`s for new jobs and migrations hold a session lock.
- **Busy tables:** `identities`, `inbound_events` and `attention_items` are updated constantly. They leave free space on each page and vacuum early (migration `0002_tune_autovacuum`). Watch `n_dead_tup` and `last_autovacuum` in `pg_stat_user_tables`; an autovacuum running for hours needs tuning.
- **Slow queries:** enable `pg_stat_statements` and set `log_min_duration_statement` (for example `500ms`) to see which queries to look at. Read plans with `EXPLAIN`; `EXPLAIN ANALYZE` runs the query.
