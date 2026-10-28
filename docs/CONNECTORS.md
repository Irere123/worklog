# Connectors and the activity stream

Everything Worklog does depends on the activity stream: the board, briefs, "what is X working on", the assistant's answers. Noise or wrong attribution makes the whole product useless, so ingestion is built around one rule: **only record work that moved, credited to the right person, and be able to explain every decision.**

## Supported tools

| Tool | What Worklog picks up | How |
| --- | --- | --- |
| **GitHub** | PRs, reviews, issues, comments, pushes, releases. Review requests reach the reviewer; issues can become cards. Recent history on install, and a daily catch-up. | The server's GitHub App (one click), or a webhook + secret |
| **Slack** | Work updates from the channels you choose, @mentions, edits and deletes; `/log`, `/worklog`, and `@worklog` in any thread. People are linked by their Slack email. | The server's Slack app (one click), or your own app's secrets |
| **Discord** | Work updates from the channels you choose and @mentions (through the server's app); `/log`, `/now`, `/ask`, `/brief`; delivery of briefs to a channel. | The server's Discord app (one click), or your own app's secrets (commands only) |
| **Gitea / Forgejo** | Same as GitHub, for self-hosted forges. Recent history and a daily catch-up with a token. | A bot user's token: Worklog creates the webhooks. Or a webhook + secret |
| **Anything with webhooks** | Map payloads to events with rules: GitLab, Sentry, CI, deploy bots. | `webhook` connector, no code |
| **Your own code** | Push events from scripts and sync jobs. | `custom` connector + an `ingest` key |
| **Agents** | Progress reports with _working / needs you / finished / failed_. | `POST /v1/activities` |

`GET /v1/connectors` lists every connector and what it needs.

## Installing through an app

A provider app has one webhook URL, so each Worklog server registers its own, once; every workspace on the server then installs it with one click.

1. **Register the app** (once per server, an admin):
   - **GitHub:** `POST /v1/apps/github/manifest` returns a link. GitHub creates the app with the right webhook, permissions and redirects, hands its credentials back, and goes straight on to installing it. From the next start it also signs people in with GitHub, unless `GITHUB_CLIENT_ID` says otherwise; the same goes for the Slack and Discord apps.
   - **Slack:** create an app at api.slack.com with the scopes in `GET /v1/apps`, point Event Subscriptions at `webhookUrls.events`, slash commands at `webhookUrls.commands` and the redirect at `callbackUrl`, then `PUT /v1/apps/slack` with its client id, client secret and signing secret.
   - **Discord:** create an application in the developer portal, set its Interactions Endpoint URL to `webhookUrls.interactions` and add `callbackUrl` as a redirect, then `PUT /v1/apps/discord` with its client id, client secret, public key and bot token. Installing registers the slash commands.
   - Or set the app's variables in the environment (`GITHUB_APP_*`, `SLACK_*`, `DISCORD_*`; see `.env.example`). The server follows them: change a secret there and restart.
2. **Install it:** `POST /v1/apps/{provider}/install` returns the provider's install page. Approving there creates the connection and starts reading `BACKFILL_DAYS` of history.
3. **Choose what counts:** `GET /v1/connections/{id}/sources` lists the repos or channels, `PUT` picks them, and their history is read too.

**Security:**

- Every link carries a random, single-use state bound to the admin who asked for it, valid for an hour.
- The redirect's own parameters are never trusted: GitHub's `installation_id` is checked against the installations the returning user can manage, and Slack's team and Discord's server come from exchanging the code with the app's secret.
- One installation feeds one workspace.
- Uninstalling on the provider's side revokes the connection, drops its tokens and tells whoever installed it. Its activity stays.
- On a server with several workspaces, registering an app also takes the setup secret.

## Managed webhooks (Gitea, Forgejo)

Forges have no apps. Give the connection a `token` for a bot user who administers the chosen `repos`, and leave out `webhookSecret`. Worklog creates each repo's webhook itself, with a secret of its own, and the daily catch-up recreates one that's gone and turns one the forge disabled back on. How each hook stands shows in health, as `hook:<repo>`. Gitea and Forgejo refuse to deliver to private addresses by default: a Worklog on the same network needs the forge's `webhook.ALLOWED_HOST_LIST` set.

## The pipeline

```
tool ──webhook──▶ /hooks/apps/{provider} (the server's app: routed by installation)
             or ▶ /hooks/{connectionId}[/{channel}] (configured by hand)
                    │ 1. receive   verify signature · store the raw delivery and its job together · ack fast
                    ▼
               lanes: 16 per connection, by repo or channel; in order within a lane, parallel across lanes;
                      what's waiting in a lane commits together, and one that fails is retried alone
                    │ 2. normalize connector turns one delivery into canonical events (a pure function)
                    │ 3. identity  actor → identity (recorded even if unknown) → member (links · sign-in · email)
                    │ 4. gate      bot policy · ignored kinds · importance score
                    │ 5. ledger    each event once, merged into a burst or not
                    │ 6. link      card refs (closes #3, WL-12, issue keys)
                    │ 7. merge     bursts within a window become one activity (commits, comments, replies)
                    │ 8. persist   activities (+ provenance: connection, raw delivery, identity, thread)
                    ▼ 9. effects   signals → attention · issues → cards · agent states → the human they work for

provider API ──sync──▶ the same inbox (backfill on install, daily catch-up): history records activity;
                       only the last BACKFILL_NOTIFY_HOURS may notify or add cards
```

Each stage is visible from the API:

| Question | Endpoint |
| --- | --- |
| Is this connection producing signal? Why were things skipped? Is a wrong secret rejecting deliveries? How far behind is it? | `GET /v1/connections/{id}/health` |
| What exactly arrived, and what happened to each delivery? | `GET /v1/connections/{id}/deliveries` |
| Which accounts haven't been matched to anyone? | `GET /v1/identities?unlinked=true` |
| Match an account to a person; their past activity is re-attributed | `PATCH /v1/identities/{id}` |
| Catch up from the provider's API now | `POST /v1/connections/{id}/sync` |
| Rebuild activity after changing settings or fixing a connector (from deliveries kept for `INBOUND_RETENTION_DAYS`) | `POST /v1/connections/{id}/replay` |
| Deliveries for installations no connection claims | `GET /v1/apps` (`unrouted`) |

Pausing a connection (`PATCH /v1/connections/{id}` with `status: "paused"`) stops it recording; commands and briefs through it still work, and resuming catches up from the provider's API where it can.

A connection that usually hears from its tool every day and goes quiet for four days raises an attention item for whoever installed it: that's how a disabled webhook or a rotated secret shows up.

## The canonical event (schema v1)

Every connector emits `WorklogEvent`s (`apps/api/src/connectors/types.ts`). The shape follows Activity Streams 2.0: an actor does a kind of thing to an object, inside a container.

| Field | Meaning |
| --- | --- |
| `id` | Built from the source's own ids and timestamps, never the delivery id. Redeliveries, replays and duplicate hooks then land on the same row. |
| `kind` | `noun.verb`: `pr.opened`, `pr.merged`, `review.submitted`, `comment.created`, `issue.closed`, `code.pushed`, `message.posted`, `release.published`, `deploy.finished`, `agent.task`… |
| `actor` | `{ id, handle?, name?, bot? }`. The `id` is the most stable one the source has: GitHub numeric id, Slack `U…`. |
| `object` / `container` | What it's about (PR, issue, message) and where it happened (repo, channel). |
| `thread` | Groups related events, e.g. everything on `github:acme/api#7`. It also scopes attention items. |
| `cardRefs` | `externalKeys` (`github:acme/api#3`) and `numbers` (from `WL-12` in titles, branches and messages). |
| `signals` | Who this asks something of: `review_requested`, `mentioned`, `assigned`, `review_result`, `resolve`. |
| `board` | Effects for issue trackers: `upsert_card`, `close_card`, `reopen_card`, `assign_card`. |
| `coalesce` | `{ key, windowMinutes, units, template }`. Merges bursts, e.g. `Pushed {n} commit{s} to acme/api:main`. |
| `op` | `update` / `delete` apply edits and deletions made at the source. A deleted Slack message must not linger. |
| `hidden` | Signals and effects only, not shown in the stream (an assignment is a nudge, not news). |
| `agent` | `{ onBehalfOf, state: working \| needs_you \| finished \| failed }`. |
| `importance`, `visibility`, `data` | A hint from 0 to 1 (the pipeline adjusts it); team or private; anything else. |

## Noise rules

**Shared by every connector** (`ingest/quality.ts`; per-connection settings `bots` and `ignoreKinds`):

- **Bots:** by default only a bot's PRs, releases and deploys are kept, scored at 0.3× importance. Bots can never raise high-priority attention. An account linked to a Worklog _agent_ member is a teammate, not a bot.
- **Importance:** base scores by kind. A release is 0.9, a merge 0.8, a decision log 0.8, a push 0.3, a chat message 0.25. Briefs rank by importance.
- **Self-signals:** nobody gets an attention item for their own action.

**GitHub, Gitea and Forgejo:**

- **Dropped:**
  - draft PRs, PR syncs, edits and labels;
  - empty review comments (their inline comments arrive separately);
  - force-pushes, tag pushes and branch deletions;
  - merge commits on the default branch, because the PR merge already records them;
  - stars, forks and CI statuses.
- **Merged into one activity:** commits per branch per person (60 min), and comments per thread per person (30 min).
- **Effects:**
  - review requests reach the reviewer; submitting the review resolves the request and tells the author;
  - a closed PR resolves outstanding review requests, even when a bot closed it: a bot's event isn't recorded, but what it changes (a resolved request, a closed card) still applies, once;
  - issues become cards in Maybe? when the connection has a `boardId` (it must be one of the workspace's boards in use; once archived it takes no more cards).
- **@mentions by login** reach the account last seen with that login, as well as one linked by login.

**Slack:**

- DMs are never ingested.
- Messages count as work only in opted-in `channels`, and only with substance. "ok", "thanks 🙏" and emoji-only messages are dropped; short news like "deployed v2.3" or "blocked on keys" is kept.
- Thread replies merge per person per thread.
- @mentions always reach people, at normal priority, wherever the bot can see them.
- Edits and deletions are applied, to the attention items they raised too; an edit or deletion inside a burst takes the burst's text, which can't say which line was whose. A change that leaves the text as it was (a link preview arriving) changes nothing. Private channels stay private.
- `@worklog …` in a channel is answered to the person who asked alone (the answer can hold what's private to them), and isn't recorded as a post. Whoever it names is what it's about (`ask @sam`), so nobody is pinged.

**Discord:** with the server's app, messages come over the Gateway, a socket one worker process keeps open (whichever takes its lock; another takes over if it goes). A dropped socket resumes from the last message stored, so nothing sent meanwhile is lost. The same rules as Slack apply: work updates only from the chosen channels and only with substance, mentions everywhere the bot reads, replies to one message merged per person, edits and deletions applied, bots and webhooks dropped, and a channel hidden from @everyone private to the author, unless the server's member role reads it (on a server that hides most channels from @everyone, the role most of them let in). The bot needs the **Message Content** intent (Bot → Privileged Gateway Intents); without it the Gateway refuses, and the worker logs why. The bot leaving a server revokes its connection at once; the daily catch-up also asks which servers it's still in, as it asks GitHub which installations still exist.

**Backfill and catch-up:**

- **GitHub** (an app installation, or a connection's `token`): PRs, reviews and their inline comments, issue and PR comments, issues, releases, and pushes (the 100 most recent per repo per run, from the repository's activity, each with its commits).
- **Gitea and Forgejo** (a connection's `token`, for a bot user who administers `repos`): issues, PRs, comments, releases, and pushes from the repository's activity feed (Gitea and Forgejo 1.21 and later). Their review webhooks are mapped live; the API's reviews aren't read back.
- **Slack:** the chosen channels' messages, the replies in threads they started, and new replies in the 200 most recent threads it has seen with replies, however old their first message.
- **From webhooks only:** replies in a Slack thread the sync never saw with replies.

## Identity: credit goes to the right person

- **Every actor gets an `identities` row,** matched or not. Unknown people are still recorded, and linking them later re-attributes their history.
- **Matching order:**
  1. the stable id;
  2. a login placeholder created by a manual link (upgraded to the stable id the first time the account is seen);
  3. the account someone **signed in with** (GitHub, Slack or Discord), so signing in is all attribution needs, for what the account did before too;
  4. for Slack, the account's email from the directory, when exactly one person in the workspace has it.
- **A login reused after a rename never inherits someone else's identity:** only placeholders are upgraded.
- **Namespaces are scoped:** `github`, `slack`, `discord`, `gitea:git.example.com`, `webhook:{connectionId}`. Generic connectors cannot claim the built-in ones (one held from before they were reserved falls back to the connection's own), and their event ids count within their connection: two in a workspace can use the same ids.
- **Only acting counts as being seen.** Being mentioned or assigned names an account without changing it or its count.

## Adding a tool

### 1. No code: the `webhook` connector

For any tool that sends webhooks (self-hosted GitLab, Sentry, Jenkins, a deploy bot):

```jsonc
POST /v1/connections
{
  "provider": "webhook",
  "name": "GitLab (self-hosted)",
  "secrets": { "secret": "<token or HMAC secret>" },
  "settings": {
    "verify": { "type": "token", "header": "X-Gitlab-Token" },  // or hmac-sha256 | standard-webhooks
    "eventType": { "header": "X-Gitlab-Event" },
    "deliveryId": { "header": "X-Gitlab-Event-UUID" },
    "identityNamespace": "gitlab:git.example.com",
    "rules": [{
      "when": { "eventType": "Merge Request Hook", "equals": { "object_attributes.action": "merge" } },
      "emit": {
        "kind": "pr.merged",
        "id": "mr:{{project.path_with_namespace}}!{{object_attributes.iid}}:merged",
        "title": "Merged MR {{project.path_with_namespace}}!{{object_attributes.iid}}: {{object_attributes.title}}",
        "url": "{{object_attributes.url}}",
        "thread": "gitlab:{{project.path_with_namespace}}!{{object_attributes.iid}}",
        "actor": { "id": "{{user.id}}", "handle": "{{user.username}}", "name": "{{user.name}}" }
      }
    }]
  }
}
```

**Signature options:**

- `hmac-sha256`: header, optional prefix, hex or base64;
- `token`: a shared secret in a header;
- `standard-webhooks`: the `webhook-id`, `webhook-timestamp` and `webhook-signature` headers used by GitLab 19+ and Svix-based services, with replay protection.

**Safety:** unsigned webhooks are refused unless `allowUnsigned` is set. Templates only read values; nothing executes.

### 2. A script: the `custom` connector plus the push API

Create a `custom` connection and an agent member with an `ingest`-only API key, then push canonical events:

```bash
curl -X POST $WORKLOG/v1/connections/$CONN/events \
  -H "authorization: Bearer $INGEST_KEY" -H "idempotency-key: sync-2026-10-26T09" -H 'content-type: application/json' \
  -d '{"events":[{"id":"PAY-12:closed","kind":"ticket.closed","occurredAt":"2026-10-26T08:00:00Z",
                 "actor":{"id":"acc-1"},"title":"Closed PAY-12: Retry failed invoices","url":"https://jira.acme/PAY-12"}]}'
```

These events get the same identity matching, noise rules, merging and signals as the built-in connectors.

### 3. Agents reporting their own work

Coding agents (Cursor, Grok Bot, Claude Code, OpenCode, your own) are members with API keys. They report with `POST /v1/activities`:

```json
{
  "kind": "agent.task",
  "title": "Should I also bump the retry limit to 5?",
  "thread": "cursor:bc-123",
  "state": "needs_you",
  "url": "https://github.com/acme/api/pull/31"
}
```

- `onBehalfOf` defaults to the human the agent belongs to.
- **Notification rules by state:**
  - `needs_you` pings that human (high priority);
  - `failed` is normal priority;
  - `finished` waits for the digest;
  - `working` never notifies.
- One thread is one attention item that always reflects the agent's latest state.

### 4. A code connector

Implement `Connector` (`apps/api/src/connectors/types.ts`) in `apps/api/src/connectors/<name>.ts` and register it in `apps/api/src/connectors.ts`:

```ts
export const linearConnector: Connector = {
  id: "linear",
  name: "Linear",
  description: "...",
  secrets: [{ key: "webhookSecret", required: true, description: "..." }],
  settings: [{ key: "boardId", description: "..." }],
  endpoints: { webhook: "" },
  identityNamespace: () => "linear",
  receive(req, keys) {
    /* verify signature with keys.secrets; return { type: "event", deliveryId, eventType, payload, partition } */
  },
  normalize({ eventType, payload, receivedAt }, conn) {
    /* pure: return { events } or { events: [], ignored: "why" } */
  },
};
```

- **`normalize` stays pure** (no database, no network). Test it against recorded payloads, as `test/ingestion.test.ts` does for GitHub and Slack, so every mapping and every noise rule has a fixture.
- **`normalize` never throws.** A payload is only signature-verified, so parse it with a schema (zod) whose wrong-typed fields read as missing, and fall back to the delivery's time when a date doesn't parse: a throw, or an event Postgres can't store, fails the whole delivery on every attempt. Add the connector's payloads to `test/fuzz.test.ts`, which breaks them at random and checks what comes out.
- **`partition`** is the repo or channel the delivery concerns: its deliveries are processed in order, others in parallel.
- **Optional capabilities**, each tested against a scripted provider API (`routedFetch` in `test/harness.ts`):
  - `app`: install through the server's app. `completeInstall` must verify the installation belongs to whoever came back, never trust the redirect alone.
  - `sync`: read history into the inbox page by page, with a cursor. A page is normalized like a delivery, and its events must get the same ids the webhooks give them; GitHub's sync rebuilds webhook-shaped payloads for exactly that.
  - `sources`: what a connection can watch, and the settings that record a choice.
  - `enrich`: look up an account first seen in events (its email links it to a member).
  - `interact` and `followUp`: answer commands at once, and finish slow answers as a job.
- **Provider calls** go through `call()` in `connectors/http.ts`, which turns a refused token into `revoked` (the connection is revoked and its installer told) and a rate limit into a retry at the right time.
