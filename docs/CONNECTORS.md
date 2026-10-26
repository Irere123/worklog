# Connectors and the activity stream

Everything Worklog does depends on the activity stream: the board, briefs, "what is X working on", the assistant's answers. Noise or wrong attribution makes the whole product useless, so ingestion is built around one rule: **only record work that moved, credited to the right person, and be able to explain every decision.**

## Supported tools

| Tool | What Worklog picks up | How |
| --- | --- | --- |
| **GitHub** | PRs, reviews, issues, comments, pushes, releases. Review requests reach the reviewer; issues can become cards. | Webhook + secret |
| **Slack** | Work updates from the channels you choose, @mentions, edits and deletes; `/log`, `/worklog`, and `@worklog` in any thread. | Slack app |
| **Discord** | `/log`, `/now`, `/ask`, `/brief`, and delivery of briefs to a channel. | Interactions URL |
| **Gitea / Forgejo** | Same as GitHub, for self-hosted forges. | Webhook + secret |
| **Anything with webhooks** | Map payloads to events with rules: GitLab, Sentry, CI, deploy bots. | `webhook` connector, no code |
| **Your own code** | Push events from scripts and sync jobs. | `custom` connector + an `ingest` key |
| **Agents** | Progress reports with _working / needs you / finished / failed_. | `POST /v1/activities` |

`GET /v1/connectors` lists every connector and what it needs.

## The pipeline

```
tool ──webhook──▶ /hooks/{connectionId}[/{channel}]
                    │ 1. receive   verify signature · store raw delivery (inbound_events) and its job together · ack fast
                    ▼
               job queue (Graphile Worker on Postgres: in order per connection, retries with backoff)
                    │ 2. normalize connector turns one delivery into canonical events (pure function)
                    │ 3. identity  actor → identity (recorded even if unknown) → member (links · sign-in accounts)
                    │ 4. gate      bot policy · ignored kinds · importance score
                    │ 5. link      card refs (closes #3, WL-12, issue keys)
                    │ 6. merge     bursts within a window become one activity (commits, comments, replies)
                    │ 7. persist   activities (+ provenance: connection, raw delivery, identity, thread)
                    ▼ 8. effects   signals → attention · issues → cards · agent states → the human they work for
```

Each stage is visible from the API:

| Question | Endpoint |
| --- | --- |
| Is this connection producing signal? Why were things skipped? | `GET /v1/connections/{id}/health` |
| What exactly arrived, and what happened to each delivery? | `GET /v1/connections/{id}/deliveries` |
| Which accounts haven't been matched to anyone? | `GET /v1/identities?unlinked=true` |
| Match an account to a person; their past activity is re-attributed | `PATCH /v1/identities/{id}` |
| Rebuild activity after changing settings or fixing a connector | `POST /v1/connections/{id}/replay` |

## The canonical event (schema v1)

Every connector emits `WorklogEvent`s (`apps/api/src/ingest/types.ts`). The shape follows Activity Streams 2.0: an actor does a kind of thing to an object, inside a container.

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
  - a closed PR resolves outstanding review requests;
  - issues become cards in Maybe? when the connection has a `boardId`.

**Slack:**

- DMs are never ingested.
- Messages count as work only in opted-in `channels`, and only with substance. "ok", "thanks 🙏" and emoji-only messages are dropped; short news like "deployed v2.3" or "blocked on keys" is kept.
- Thread replies merge per person per thread.
- @mentions always reach people, at normal priority, wherever the bot can see them.
- Edits and deletions are applied, and private channels stay private.

**Discord:** commands and delivery only. Reading channel messages needs a Gateway bot, which is on the roadmap.

## Identity: credit goes to the right person

- **Every actor gets an `identities` row,** matched or not. Unknown people are still recorded, and linking them later re-attributes their history.
- **Matching order:**
  1. the stable id;
  2. a login placeholder created by a manual link (upgraded to the stable id the first time the account is seen);
  3. the account someone **signed in with** (GitHub, Slack or Discord), so signing in is all attribution needs.
- **A login reused after a rename never inherits someone else's identity:** only placeholders are upgraded.
- **Namespaces are scoped:** `github`, `slack`, `discord`, `gitea:git.example.com`, `webhook:{connectionId}`. Generic connectors cannot claim the built-in ones.

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

Implement `Connector` (`apps/api/src/ingest/types.ts`) and register it in `apps/api/src/connectors/registry.ts`:

```ts
export const linearConnector: Connector = {
  id: "linear",
  name: "Linear",
  description: "...",
  secrets: [{ key: "webhookSecret", required: true, description: "..." }],
  settings: [{ key: "boardId", description: "..." }],
  endpoints: { webhook: "" },
  identityNamespace: () => "linear",
  receive(req, conn) {
    /* verify signature; return { type: "event", deliveryId, eventType, payload } */
  },
  normalize({ eventType, payload, receivedAt }, conn) {
    /* pure: return { events } or { events: [], ignored: "why" } */
  },
};
```

`normalize` must stay pure (no database, no network). Test it against recorded payloads, as `test/ingestion.test.ts` does for GitHub and Slack, so every mapping and every noise rule has a fixture.
