# Worklog architecture

```
 clients: web · Expo · Slack · Discord · CLI/agents · custom integrations
        │  REST (OpenAPI 3.1)      │ SSE /v1/events         │ signed webhooks /hooks/*
        ▼                          ▼                        ▼
 ┌──────────────────────────── apps/api (Bun + Hono) ────────────────────────────┐
 │ api/routes/*  zod-openapi routes, one file per domain → docs + typed SDKs    │
 │ api/hooks.ts  /hooks/{connection}: verify → store raw → queue (any connector) │
 │ api/auth.ts   API keys (agents) or better-auth sessions (people) → member    │
 │                                                                               │
 │ board/        Fizzy rules: stages, golden tickets, entropy, drift + answers   │
 │ activity/     the work stream: one write path, which resets entropy          │
 │ work/         one person's work: manual logs (+ AI structuring) · snapshots   │
 │ attention/    "needs you": collapse, quotas, feedback, metrics                │
 │ briefs/       data gathering → model prose (or template)                      │
 │ automations/  scheduled jobs: brief · digest · check · consolidate · custom   │
 │ agent/        the loop, one-shot calls, prompts/*.md, tools/ (one per file)   │
 │ memory/       profile · facts · journal · nightly consolidation               │
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

- **One contract, many clients.** Routes are declared with zod schemas. Those same schemas validate requests, parse responses on the way out (`respond()`: dates to ISO strings, unlisted fields such as secrets dropped, a wrong shape fails before it leaves), and produce `/openapi.json`. Operation ids are stable and dotted (`card.close`), so a generated SDK reads naturally (OpenCode's pattern).
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

- **Append-only history.** Model messages are stored verbatim and replayed verbatim. Per-turn context (the time, who is asking) goes into the user message. That keeps Anthropic prompt caching effective (enabled through OpenRouter, with the provider pinned for cache locality) and satisfies the preserved-thinking checks.
- **What a conversation starts with:** the instructions hold the constitution, then the rules for this owner and mode, then the owner's voice, then their memory digest (owners get the one built from all their memory, teammates the team-only one), then the conversation's recap, if it has one. Most stable comes first. They change only when the owner edits their voice, the digest is rebuilt overnight or the conversation is compacted, so the prefix stays cacheable. A conversation's first turn also lists what's in flight: the owner's open attention items, for owners only, and their golden and active cards.
- **Constitution and voice.** [`constitution.md`](../apps/api/src/agent/prompts/constitution.md) is who every assistant is: what it's for, the order it weighs things in when they conflict (privacy and permission, then honesty, then the owner's wishes, then helpfulness), the lines it never crosses, and why. It reasons rather than lists rules, so the model can handle cases nobody wrote down. Briefs and custom automations start from it too, since they also speak for the owner. The attention check and memory upkeep don't: they write nothing in the assistant's voice. The voice is the owner's own instructions (`PUT /v1/voice`); the constitution wins where they conflict. Every save is kept (`GET /v1/voice/history`). Teammate conversations follow the voice too, so it counts as team-visible. Neither is ever written by the assistant: no tool touches them, so text planted in a Slack message or a comment can't persist itself into the instructions. The constitution shapes judgment only; privacy is still enforced by the queries.
- **Compaction.** When the replayed messages pass about 64k tokens, a job (`conversation:compact`) folds the older ones into the recap and stops replaying them. The newest ~16k tokens stay verbatim, starting at a user turn, and every message stays stored. The recap keeps open loops, decisions and identifiers in separate fields and copies identifiers exactly, because summaries lose the details a conversation depends on. Without AI, the older messages are just dropped from the replay.
- **Inbox.** Briefs and pings are also written into the owner's inbox conversation, so replying "tell me more about #12" has context. Compaction keeps it bounded.
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
| `digest` | — | nightly consolidation: a page of all of it, one per visibility, that conversations start with |

OpenClaw's `SOUL.md` has no memory kind here: it's split into the constitution and the owner's voice (see [The assistant](#the-assistant)), which the assistant can't write.

- **Two passes:** consolidation runs once over team-visible activity, producing team memory without ever seeing private memory, and once over private activity plus what the owner said to their own assistant, producing private memory. Teammate-mode tools only query `visibility = 'team'`.
- **Aliases and expiry:** every line can carry aliases (synonyms, @handles, #card numbers) and an `expiresAt` for time-bound knowledge ("on leave until Friday"). Expired lines stop being recalled.
- **Weekly tidy:** Sunday's run also reconciles each visibility on its own. It merges duplicates, turns repeated examples into one trait, keeps the newest of contradicting lines and retires what stopped being true. A rewrite must replace lines that exist; superseded lines stay as history.
- **History:** a replaced line records the line that replaced it (`supersededBy`; null when it was forgotten), so `GET /v1/memories/{id}/history` can walk a line's lineage both ways and show why the assistant believes something.
- **Export:** `GET /v1/memories/export` returns active memory as Markdown files under `team/` and `private/` (`profile.md`, `facts.md`, `digest.md`, `journal/<day>.md`), so the team half can be shared and the private half kept back. Lines come in the order they were learned and nothing depends on when the export ran, so committing each export to a git repo gives git's history without making git the store.
- **Recall:** each word of a query is matched on its own against content and aliases with `pg_trgm`'s `word_similarity`, so misspellings still match, and results are ranked with `strict_word_similarity`, which respects word boundaries. A member's memories are few, so there's no index.

## Delivery

Briefs, digests, pings and custom automations go to the owner's inbox and to the delivery targets they choose. Each target has a visibility, like memory and activity:

- **private:** only the owner reads it. Their own email address and a Slack DM to their own linked user start as private; anything else (a personal ntfy topic, say) can be marked private with `PATCH /v1/delivery-targets/{id}`.
- **team:** others might read it: a channel, a shared address, a webhook. Every target starts as team unless it's certainly private.

The inbox and private targets get the full message. Team targets get a version built from team-visible data only, so a brief posted to a channel can't carry a private log or memory into it:

- briefs and custom automations compose a second time from team-visible activity, team memory and team-visible attention, and the model is told others might read it. A custom automation's last result is left out too, because it was written from everything;
- an attention item is as visible as the activity that raised it, and one no activity raised (a teammate's note to the owner) stays private;
- pings keep their items but replace the model's "why now", which was written with private memory in view, with the plain reason.

The team version is only composed when there are team targets, and nothing is sent to them when it would be empty. A notification records both bodies (`body`, `teamBody`).

## Scheduling

- **Automations are rows** with a schedule (`daily` / `weekly` / `interval` with `activeHoursOnly`), evaluated on the member's local clock with DST handled.
- **Spreading load:** a deterministic per-automation jitter keeps jobs from all firing on the same minute.
- **Cron:** Graphile Worker's crontab (`jobs/tasks.ts`) runs due automations every minute, the entropy sweep hourly, and event and delivery pruning daily. Each run fires once across all workers, and the scheduled tasks share one queue, so they never overlap.
- **Failure handling:** an attention item after 3 consecutive failures; the automation is disabled after 10.
- **Deployment:** run it in the API process (`RUN_SCHEDULER=true`) or as a separate worker (`bun run worker`).

## Configuration

See [`apps/api/.env.example`](../apps/api/.env.example). Production requires `WORKLOG_SECRET_KEY`, which encrypts connector secrets at rest with AES-256-GCM.

## Running Postgres

- **Migrations run at startup.** The API and the worker take the same advisory lock, so only one of them migrates. An index on an existing table is built `CONCURRENTLY`, so ingest keeps writing while it builds.
- **Connections:** each process keeps its own pool of 10. PgBouncer is optional; if you add it, use session pooling, because Graphile Worker `LISTEN`s for new jobs and migrations hold a session lock.
- **Busy tables:** `identities`, `inbound_events` and `attention_items` are updated constantly. They leave free space on each page and vacuum early (migration `0002_tune_autovacuum`). Watch `n_dead_tup` and `last_autovacuum` in `pg_stat_user_tables`; an autovacuum running for hours needs tuning.
- **Extensions:** memory recall needs `pg_trgm` (migration `0004_pg_trgm`). It ships with Postgres and is trusted, so the database owner can create it.
- **Slow queries:** enable `pg_stat_statements` and set `log_min_duration_statement` (for example `500ms`) to see which queries to look at. Read plans with `EXPLAIN`; `EXPLAIN ANALYZE` runs the query.
