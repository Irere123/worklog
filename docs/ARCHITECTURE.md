# Worklog architecture

```
 clients: web · Expo · Slack · Discord · CLI/agents · custom integrations
        │  REST (OpenAPI 3.1)      │ SSE /v1/events         │ signed webhooks /hooks/*
        ▼                          ▼                        ▼
 ┌──────────────────────────── apps/api (Bun + Hono) ────────────────────────────┐
 │ http/routes/* zod-openapi routes, one file per resource → docs + typed SDKs   │
 │ http/hooks.ts /hooks/apps/{provider} (an app's) · /hooks/{connection} (pasted)│
 │ http/oauth.ts install and app-creation redirects; http/auth.ts keys, sessions │
 │                                                                               │
 │ connectors/   GitHub · Gitea · Slack · Discord · webhook (no-code) · custom:  │
 │               receive · normalize · app install · sync · sources · directory  │
 │ ingest/       inbox → lanes → ledger → identity · gates · merge · effects;    │
 │               apps · installs · lifecycle · sync · health · token errors      │
 │ work/         activity (one write path) · board (Fizzy rules, drift) ·        │
 │               attention · manual logs (+ AI structuring) · snapshots · members│
 │ automations/  routines: brief · digest · check · consolidate · custom;        │
 │               briefs (data → prose) · delivery (email, Slack, Discord, hooks) │
 │ agent/        the loop, one-shot calls, prompts/*.md, tools/ (one per file)   │
 │               memory: profile · facts · journal · nightly consolidation       │
 │ events.ts     sequenced event log, live fan-out, relay across processes       │
 │ jobs/         Graphile Worker: lanes per connection · sync · cron schedule    │
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
- **Events after writes.** Changes publish to `events` (with a `seq`), then to live SSE subscribers. Private items carry an `audienceId`. Clients resume with `Last-Event-ID`; events are pruned after 7 days. Every API process reads new events four times a second, so it also relays what workers and other replicas publish. It reads rather than LISTENs: Postgres commits transactions that NOTIFY one at a time, so a NOTIFY on every insert would queue up every write that publishes. For the same reason a webhook whose lane already has a drain waiting to start doesn't queue another (Graphile Worker NOTIFYs on each job added): it locks the waiting one until it commits.

## The activity stream

Ingestion is a pipeline, not a set of webhook handlers. See [CONNECTORS.md](CONNECTORS.md) for what each tool sends and how to add one.

- **Two ways in.** An instance's app (a GitHub App, a Slack app) has one webhook URL, `/hooks/apps/{provider}`; the installation each delivery names picks its connection. A hand-configured connection has its own, `/hooks/{connectionId}`. Both verify the signature, then store the raw delivery and its job in one statement and answer at once.
- **Lanes.** A delivery's partition (its repo, its channel) hashes to one of 16 lanes per connection. A lane is drained by one job at a time, in order, live deliveries before pages of history; different lanes run in parallel. A delivery that fails is retried with backoff on its own, so one bad payload doesn't hold up the lane. Every minute a sweep queues a drain for any lane with a delivery left waiting over a minute, since queuing a drain can lose a race with that drain starting, and unlocks a drain whose worker died, to run again (locked over five minutes, when a drain hands over after twenty seconds; Graphile Worker would keep its lane locked for four hours).
- **Deliveries commit with their effects.** A delivery's events, their effects and its new status commit together, without waiting for the disk: lost in a crash, the delivery is still pending and runs again. New deliveries waiting in a lane share one transaction and one lookup of the people they name, so a busy lane pays for one commit, not one each; if any of them fails, the transaction rolls back and each is tried on its own, so only the one that failed waits for a retry. People are resolved before the transaction opens, so it holds no lock on anyone's identity.
- **Exactly once.** Event ids come from the source's own ids (scoped to the connection for the generic connectors, whose ids their owners choose), and `ingested_events` records every event that did something, including those merged into a burst. A retry, a redelivery or a sync re-reading a webhook's event changes nothing.
- **Bursts span their events,** whichever order they arrive in: a backfill reads history newest first, so the merge window looks both ways and a burst's times only widen.
- **Order doesn't matter for requests.** Resolving a review request records when (`attention_resolutions`), so a request that arrives later but happened earlier doesn't reopen it.
- **Sync.** Connectors that can read the provider's API backfill `BACKFILL_DAYS` on install and catch up daily, into the same inbox. History records activity; only what happened in the last `BACKFILL_NOTIFY_HOURS` may notify or add cards. The daily run also asks each app which installations it still has, since Discord never says when its bot is removed.
- **Sockets.** What a provider only sends over a socket (Discord's Gateway) comes in through one worker process per server, elected with an advisory lock, into the same inbox.
- **Counters off the hot path.** Sightings and last-delivery times add up per process and are written every two seconds (`ingest/tally.ts`), so a busy bot's identity row isn't what every event waits on.

Replays rebuild activity from the inbox, which keeps deliveries for `INBOUND_RETENTION_DAYS` (90 by default), lane by lane on the lane's own queue.

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
raiseAttention ─▶ open (consideredAt = null)          follow_up ─▶ snoozed until the time asked for
                    │  check (every 30 min in active hours; pulled to +3 min by urgent items,
                    │         or to the moment a follow-up wakes)
                    ▼
     follow-ups the member asked for ──────────────────────────────────────────▶ push
     gates: muted kind? · priority · thread cooldown · daily cap · min gap · sender quota (at raise)
                    │
          ┌─────────┴──────────┐
     digest (+reason)     classifier (fast model, structured) ─▶ push (+reason) ─▶ notifications log
          │                                                              │
   midday/afternoon digest, morning brief       feedback, dismissals ─▶ mutedKinds ─▶ metrics
```

The fields that drive this live on `attention_items`: `consideredAt`, `disposition`, `reason`, `pushedAt`, `digestedAt`, `actedAt` and `actions`. Every push is recorded in `notifications`, and every rating in `attention_feedback`.

- **Follow-ups.** The owner's assistant can bring something back to its owner at a time they choose (`follow_up`: "remind me Thursday"). It's an attention item that stays snoozed until then and pulls the check to that moment; when it wakes, the check pushes it whatever the day's budget and without asking the model, since the member asked for it. It still waits for their active hours, and a check that runs before then is never scheduled past it. Only the member it's for can raise one, so the assistant can't reach anyone else this way. `my_attention` lists the ones still to come, and dismissing one cancels it.
- **Snoozing asks for it back.** A snoozed item, a follow-up included, is reconsidered by the check when it wakes, as if new, instead of only waiting for the next digest.
- **Learning what not to push.** A kind of ping is held for the digest when its member said so ("less like this", or "not useful" three times in two weeks) or showed it: the last three pushed were all dismissed, and nothing of that kind was acted on. It only ever moves pings to the digest, never drops them, and a ping marked useful, or any item of that kind acted on (in Worklog, or closed at its source, like a PR reviewed on GitHub), undoes it.

## The assistant

- **Two modes,** fixed per conversation:
  - **owner:** the full toolset, including writes: remember, log work, create and move cards, comment, resolve or answer attention items, give feedback, set follow-ups.
  - **teammate:** read-only, team-visible data, plus `leave_note_for_owner`.

  The mode is decided by _who asks_. The toolset and the queries enforce it; it is not left to the prompt.

- **Append-only history.** Model messages are stored verbatim and replayed verbatim. Per-turn context (the time, who is asking) goes into the user message. That keeps Anthropic prompt caching effective (enabled through OpenRouter, with the provider pinned for cache locality) and satisfies the preserved-thinking checks.
- **One turn at a time, in order.** A message joins its conversation's line (`turn_queue`) and waits there for the turn before to finish, so it reads that answer instead of being answered beside it by a model that never saw it, and messages sent in a row are answered in the order they came. The turn holds a lease (`turn_until`) that outlasts the longest turn, and a place in line older than the longest wait is dropped, so a process that dies mid-turn or mid-wait holds no one up for long. A streamed turn gives the conversation back only once its stream has settled and the turn is stored, whatever error it hit on the way.
- **Sending again is safe.** A client can give each message an id (`clientMessageId`, or useChat's message id on `/chat`). It's stored with the message, unique within the conversation, and checked once the turn is taken: a message sent again, say after a dropped connection, gets the first answer back, even if it arrived while that answer was still being written, instead of a second model call and a duplicate in the transcript.
- **What a conversation starts with:** the instructions hold the constitution, then the rules for this owner and mode, then the owner's voice, then their memory page, then the conversation's recap, if it has one. Most stable comes first. The memory page is the digest (owners get the one built from all their memory, teammates the team-only one) followed by what memory learned and forgot since it was written. The conversation keeps the page its first turn took (`memory_page`) until its next summary, or until it's picked up again after two hours, when the provider's cache has lapsed anyway; what memory learns meanwhile, in this conversation or another, reaches the model as short notes in its newest message, each change once (`memory_seen_at`). So the instructions change only when the owner edits their voice or the conversation is compacted, and the prefix stays cacheable. Memory is framed as what the assistant knows about its owner, never as instructions. A conversation's first turn, and the first after two hours away, also lists what's in flight: for owners only, their open attention items and the follow-ups still to come; for anyone, the owner's golden and active cards.
- **Every turn says where it came from:** the time, who's asking and the channel the message came through (the Worklog API, Slack or Discord) lead the newest message, so the assistant can tell a question typed in Slack from one an app or a script sent. Automation posts in the inbox are marked as such.
- **The record keeps what was typed.** The model gets each message with the time, who's asking and those lists and notes around it; the stored `text`, which clients show and memory passes read, is only what the person typed. Nothing has to be parsed back out, so text someone else wrote (a card title in the open loops, a teammate's note) can't pass for the owner's words.
- **Automatic review.** A write the owner's teammates will see (commenting, moving or creating a card, answering an attention item's question, a team-visible work log) runs only once a separate, fast model has read what the owner typed in the conversation and found they asked for it. What the assistant read on the way (comments, messages, tool results) can't ask for anything, so an instruction planted in a card comment isn't acted on. Blocked, unsure, failed or slow, the write becomes a request in the owner's attention list (`assistant.approval`) with Allow and Deny: their tap runs exactly what was proposed, with no model in between, and saying yes in the conversation works too. The assistant can't answer its own requests. What only the owner sees (memory, private logs, follow-ups, their own attention list) isn't checked. The writes live in one place (`agent/actions.ts`), shared by the tools and by approvals.
- **Routines it suggests:** `propose_routine` turns something the owner keeps asking for into a routine (a custom automation on a daily or weekly schedule). It always waits for their Allow, even when they asked, since it will run again and again on its own.
- **Stopping and interrupting.** `POST /v1/conversations/{id}/stop` asks the running turn to stop; the process running it checks every half second and aborts the model call, wherever it runs, and the transcript records that it stopped. A message sent with `interrupt: true` stops the running turn first, then answers, seeing whatever the stopped turn stored.
- **Helpers.** `look_into` hands a question that needs many lookups to a helper with a fresh context and the same read-only tools; only its short report comes back, so the conversation stays small. A lookup too big for the conversation (over about 3,000 tokens) keeps its first results and says how to narrow the search, and every tool's definition stays under 4,000 characters (a test checks).
- **Usage and the cache.** Each turn records its input, cached input and output tokens on its last message (`usage`); `GET /v1/assistant/usage` reports them and the share the cache served. A client can call `POST /v1/conversations/{id}/warm` when someone opens a conversation or starts typing: the prompt is sent ahead with a one-token request, at most once every four minutes, so the provider has its start cached when the message arrives.
- **Replaying ratings.** `POST /v1/ratings/{id}/replay` asks a rated reply again from the same point in its conversation with today's prompts, memory and model, with lookups only, and returns both answers; `bun run ratings:replay <workspace>` does it for a workspace's unhelpful ratings, the inner loop of checking a change against what people flagged.
- **Tool errors say what to do next:** a tool pointed at something that isn't there answers with how to find it ("use search_cards to find the card's number"), not just that it failed.
- **Cache misses are logged.** A turn that replays history the provider should still have cached (the last message under four minutes ago) but reads none of it from the cache logs a warning naming the conversation: its prefix changed under it, which is a bug to look into rather than a cost to accept.
- **Constitution and voice.** [`constitution.md`](../apps/api/src/agent/prompts/constitution.md) is who every assistant is: what it's for, the order it weighs things in when they conflict (privacy and permission, then honesty, then the owner's wishes, then helpfulness), the lines it never crosses, and why. It reasons rather than lists rules, so the model can handle cases nobody wrote down. Briefs and custom automations start from it too, since they also speak for the owner. The attention check and memory upkeep don't: they write nothing in the assistant's voice. The voice is the owner's own instructions (`PUT /v1/voice`); the constitution wins where they conflict. Every save is kept (`GET /v1/voice/history`). Teammate conversations follow the voice too, so it counts as team-visible. Neither is ever written by the assistant: no tool touches them, so text planted in a Slack message or a comment can't persist itself into the instructions. The constitution shapes judgment only; privacy is still enforced by the queries.
- **Settling.** Every append puts off a job (`conversation:settle`) until the conversation has been quiet for ten minutes, so it runs once the person has likely stepped away: it compacts the conversation if it needs it, then learns from it (see [Memory](#memory)). Neither runs while someone waits on a reply, and neither changes the prompt's cached prefix between their turns. A conversation that never goes quiet for that long (an inbox pinged every few minutes) still settles once its oldest unlearned message is an hour old. The delay counts on the database's clock, which Graphile Worker schedules by.
- **Compaction.** When the replayed messages pass about 64k tokens, settling folds the older ones into the recap and stops replaying them. Past twice that it doesn't wait for quiet (`conversation:compact` runs at once), since the replay would crowd the model's window. The newest ~16k tokens stay verbatim, starting at a user turn, and every message stays stored. The recap keeps open loops, decisions and identifiers in separate fields and copies identifiers exactly, because summaries lose the details a conversation depends on. Without AI, the older messages are just dropped from the replay.
- **Inbox.** Briefs and pings are also written into the owner's inbox conversation, so replying "tell me more about #12" has context. Compaction keeps it bounded.
- **Ratings.** Whoever is in a conversation can rate a reply helpful or unhelpful and say why (`PUT /v1/conversations/{id}/messages/{messageId}/rating`); rating again replaces it. In an owner's own conversation the rating is learned from when the conversation settles, like anything else they say there. A teammate's never shapes the owner's memory. Every rating is kept with the reply and the message it answered (`GET /v1/ratings`), as the cases to check prompt and model changes against.
- **Untrusted content.** Every prompt marks ingested text as data, not instructions. Outbound text is sanitized against the URLs present in its source data.
- **Two tiers of model calls, each with a timeout:**
  - **main:** chat, briefs, routines, helpers, replays.
  - **fast:** checks, log structuring, consolidation, the memory pass after a conversation, automatic review.

## Memory

| Kind | Analogue in OpenClaw | Written by |
| --- | --- | --- |
| `profile` | `USER.md` | you (`POST /v1/memories`), the assistant (`remember`), the pass after a conversation, nightly consolidation |
| `fact` | `MEMORY.md` | the same four |
| `journal` | `memory/YYYY-MM-DD.md` | nightly consolidation, one entry per day and visibility |
| `digest` | — | nightly consolidation: a page of all of it, one per visibility, that conversations start with |

OpenClaw's `SOUL.md` has no memory kind here: it's split into the constitution and the owner's voice (see [The assistant](#the-assistant)), which the assistant can't write.

- **Two passes:** consolidation runs once over team-visible activity, producing team memory without ever seeing private memory, and once over private activity plus what the owner said to their own assistant, producing private memory. Teammate-mode tools only query `visibility = 'team'`.
- **Learning the same day:** when one of the owner's own conversations settles, a pass over what they said since the last one (`learned_through_seq`), and how they rated replies, adds, replaces or forgets lines, so a preference told in the morning shapes the afternoon's answers rather than waiting for the night. Like the nightly pass it learns only from the owner's own words: not the assistant's replies, not what Worklog added around a message, and not teammates' conversations. The transcript it reads is JSON with who said each thing, so a reply quoting "Emma: …" can't pass for Emma. What it learns is private, and it writes each line as a statement about the owner, never as an instruction to the assistant. The nightly pass then skips what the same-day pass already read.
- **Only lines a pass was shown:** every pass (after a conversation, nightly, the weekly tidy) may only replace or retire lines it was shown, so a pass over team activity can't touch a private line, and nothing planted in a message can aim one at a line it never saw.
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
- **Cron:** Graphile Worker's crontab (`jobs/tasks.ts`) looks for due automations and for lanes with deliveries left waiting every minute, runs the entropy sweep and the check for connections gone quiet hourly, and event and delivery pruning, the catch-up sync and re-sealing secrets daily. Each run fires once across all workers, and the scheduled tasks share one queue, so they never overlap. Two sweeps stay off it, so nothing there can hold them up: the one for lanes, every minute, and one every five minutes that unlocks any job locked over an hour, whose worker died, with its queue (a person's automations, a connection's sync, the scheduler's own).
- **Runs fan out.** The minute's check doesn't run what is due: it queues a job for each, so a morning's briefs, which wait on a model for seconds each, run on every worker at once. A person's automations queue behind each other. Queuing one moves its next run 15 minutes out, so two schedulers never take the same one and one whose job is lost comes due again then; a worker that dies mid-run holds its job until Graphile frees stale locks, after four hours. A job retried after its run finished doesn't run it again.
- **Quiet is allowed.** A scheduled brief whose window has nothing in it (nothing anyone did, nothing waiting, nothing drifting, no new or closed cards) records a quiet run instead of sending "nothing happened". A digest with nothing new is skipped, and the check and custom automations can decide there is nothing worth saying. Run by hand, a brief always comes.
- **Failure handling:** an attention item after 3 consecutive failures; the automation is disabled after 10.
- **Deployment:** run it in the API process (`RUN_SCHEDULER=true`) or as a separate worker (`bun run worker`).

## Configuration

See [`apps/api/.env.example`](../apps/api/.env.example). Production requires `WORKLOG_SECRET_KEY`, which encrypts connection secrets and app credentials at rest with AES-256-GCM. Each sealed value names its key, so the key can be rotated: set the new one, move the old one to `WORKLOG_SECRET_KEYS_PREVIOUS`, and `bun run secrets:reseal` (or the nightly run) moves everything to the new key.

## Running Postgres

- **Migrations run at startup.** The API and the worker take the same advisory lock, so only one of them migrates. An index on an existing table is built `CONCURRENTLY`, so ingest keeps writing while it builds.
- **Connections:** each process keeps its own pool (`DATABASE_POOL_SIZE`, 20 by default); keep it above `WORKER_CONCURRENCY` (8), since every running job holds one while it writes. PgBouncer is optional; if you add it, use session pooling, because Graphile Worker `LISTEN`s and migrations hold a session lock.
- **Scale:** lanes of different repos and channels run in parallel up to `WORKER_CONCURRENCY` per process, and each worker process (`bun run worker`) adds its own CPU: a worker is bound by its JavaScript (building queries costs more than running them), and API processes scale the same way behind a load balancer. Postgres is the one part that doesn't scale out, so the write paths avoid what serializes it: no NOTIFY for realtime events or for a webhook whose lane already has a drain waiting, one statement per acknowledgement, deliveries waiting in a lane committed together without waiting for the disk.
- **Measured** with `bun scripts/bench-ingest.ts`, against a scratch database, on a small 6-core machine that also runs Postgres. 5,000 people in 10 workspaces, half of what happens involving members, half GitHub (pushes, comments, review requests, reviews) and half Slack (updates, thread replies, mentions, chatter), sent over HTTP to API processes, with workers in their own processes:
  - **Steady, for ten minutes:** 60 webhooks a second, one API process, two workers. 36,000 deliveries, all done on the first attempt, in each of two runs; the backlog never above 250 and gone within a second of the stream stopping; acknowledged in 0.1 s at the median and 0.5–0.8 s at the 95th percentile, done 0.6 s after arriving at the median and about 3 s at the 95th. Memory flat after warming up: about 190 MB per API process, 210 MB per worker. CPU per delivery: about 13 ms in the API, 27 ms in the workers, 21–25 ms in Postgres.
  - **A worker killed mid-run:** the same stream for 25 minutes, one of the two workers killed outright (SIGKILL) at minute 5 and replaced. All 90,000 deliveries done, none needing another attempt (what the killed worker was doing rolled back) and no event recorded twice; the lanes it held waited the five minutes until the sweep unlocked them, so that 1% was done in about 1.5 minutes instead of under a second. Memory flat for the 25 minutes.
  - **Retention:** the nightly prune removes a million deliveries and two million ledger entries past `INBOUND_RETENTION_DAYS` in about 40 seconds, in batches that leave ingestion running; a day at 5,000 people is about half that.
  - **Bursts:** two API processes acknowledge about 320 a second; a worker works through a backlog at about 100 a second (150 for GitHub alone), since deliveries waiting together share a transaction.
- **Capacity for a team of 5,000,** as an estimate: 70 to 100 deliveries a person a working day (about 20 from GitHub, the rest messages in channels the bot is in) is 350,000 to 500,000 a day, peaking around 35 to 50 a second. At the measured costs that is under a core each for the API processes and Postgres and about one and a half for workers; two API replicas, two or three workers and a 4-core Postgres leave room for bursts, which wait in the inbox (`backlog` in health) and drain at a worker's burst rate.
- **Busy tables:** `identities`, `inbound_events` and `attention_items` are updated constantly. They leave free space on each page and vacuum early (migration `0002_tune_autovacuum`). Watch `n_dead_tup` and `last_autovacuum` in `pg_stat_user_tables`; an autovacuum running for hours needs tuning.
- **Extensions:** memory recall needs `pg_trgm` (migration `0004_pg_trgm`). It ships with Postgres and is trusted, so the database owner can create it.
- **Slow queries:** enable `pg_stat_statements` and set `log_min_duration_statement` (for example `500ms`) to see which queries to look at. Read plans with `EXPLAIN`; `EXPLAIN ANALYZE` runs the query.
