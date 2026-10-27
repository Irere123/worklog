# Activity ingestion: event model, noise control, pipeline and connectors

_Prepared 2026-10-26. Scope: the canonical event model, noise reduction and data quality, a reliable and scalable ingestion pipeline, connector extensibility (code and no-code), self-hosted forges, and a prioritized change list for Worklog's activity stream._

---

## 0. TL;DR

1. **Event model.**
   - Use CloudEvents 1.0 as the wire envelope, for ingest, export and outbound webhooks.
   - Use an Activity Streams–shaped `data` payload: actor → kind → object, plus target, container and thread.
   - Name verbs with CDEvents in mind (`change.reviewed`, `change.merged`, `ticket.closed`), and borrow OpenTelemetry's `vcs.*` attribute names for forge facts.
   - Inside Postgres, keep columns, not CloudEvents JSON.
   - The schema in §2.4 extends the `WorklogEvent` v1 already being written in `src/ingest/types.ts`. It adds `target`, `op` (upsert or delete), `revision`, `links`, `mentions`, `quality`, `source` refs and a `raw` pointer.
2. **Event ids must be semantic and deterministic,** for example `github:r612345/pr/42/review/2398765432`, not derived from a delivery id. Then a webhook, a redelivery, a backfill, a replay and a duplicate org-plus-repo webhook all converge on one row. The baseline code mixes delivery ids into several external ids (`pr:${ref}:${action}:${deliveryId}`), which breaks backfill dedupe.
3. **Noise: precision first.** The rules that matter most (§3):
   - **Bots:** detect by account type, numeric id and app attribution, never by login alone. Keep bot PRs and releases quietly and drop the rest. AI coding agents linked to agent members are teammates, not noise.
   - **Drafts:** shape the "now" snapshot but stay out of the feed until `ready_for_review`.
   - **Force pushes and rebases** never count as new commits. Only count `distinct` commits.
   - **A push to the default branch that came from a merged PR** is folded into `pr.merged`. Match `merge_commit_sha` to `after`, in either arrival order.
   - **Bursts coalesce:** commits per branch, comments per thread, a review together with its inline comments, Slack replies per thread root.
   - **Slack:** opted-in channels only. Drop acknowledgements ("ok", "thanks", 👍) but keep short keyword messages ("blocked", "deployed v2.3"). Honor edits and deletes.
   - **Identity:** key on the provider's stable id, not the login. Auto-link only at high confidence; send everything else to a review queue.
4. **Pipeline.**
   - At the edge: verify, store raw bytes in an inbox, enqueue in the same transaction, and return 200 within milliseconds.
   - In a worker, apply in order: normalize (pure), gate, resolve identities, write activities, apply effects.
   - Order processing per thread, so a resolve can't overtake a raise.
   - Replay stored events after fixing a connector, with a dry-run diff.
   - Reconcile GitHub by redelivering failed deliveries (3-day window) and polling `issues?since=`. Don't use the Events API.
   - Track health per connection: lag, failures, signature failures, silence, unknown-actor rate.
5. **Queue: keep the Drizzle-native `jobs` table already being written,** and add an ordering key, a dedupe key, attempt fencing and jitter (§4.3).
   - **pg-boss 12.38** now ships `fromBunSql`, `fromPglite` and `fromDrizzle` adapters. It works on Bun with PGlite [E], so it is a credible fallback.
   - **graphile-worker** needs `pg`. On PGlite it runs only through pglite-socket with `noPreparedStatements` [E]. Not recommended.
6. **P0 finding (production-only data bug).**
   - With Bun SQL and drizzle-orm 0.45.4, every `jsonb` value is stored as a JSON _string_, not an object. I reproduced this [E], and Bun issue oven-sh/bun#28819 is still open.
   - Reads through Drizzle hide it. Any SQL-side `->>`, jsonb index or external tool sees strings.
   - Tests on in-process PGlite cannot catch it.
   - Fix it before the inbox starts storing payloads (§4.6).
7. **Connectors come in two layers that share one pipeline:**
   - **(a)** A typed TypeScript `Connector` with a manifest, declarative `verify`, `parse`, a pure `normalize`, and optional `subscribe`, `backfill`, `stream`, `interact`, `deliver` and `test`.
   - **(b)** A declarative mapping connector for any webhook: signature presets (HMAC, Standard Webhooks, token) and RFC 9535 or JSON Pointer paths, with CEL for conditions and logic-less `{{ }}` titles.
   - Code connectors are installed by operators from npm with provenance. Declarative manifests are data, so workspace admins can install them.
8. **Forges.**
   - **Gitea and Forgejo** (and Codeberg) can share the GitHub mapper through a thin adapter. They send `X-Hub-Signature-256: sha256=…` and `X-GitHub-Event`, but they split reviews into separate event types, cap commits at 5 or 15, and have no `forced` or `created` flags.
   - **GitLab** needs its own mapper. Since 19.0 it signs webhooks with Standard Webhooks (`webhook-signature: v1,<b64>`); older versions send a plain `X-Gitlab-Token`.

---

## 1. How to read this brief

**Evidence labels:**

- **[P] Primary:** I (or a research sub-agent) read the official doc, spec or source code this session.
- **[E] Experiment:** reproduced by running code in a scratch directory outside the project this session.
- **[S] Secondary:** search snippet, third-party summary or community post.
- **[U] Unverified:** background knowledge or inference not re-checked this session. Treat it as a lead.

**Citation style:** works are cited by title and URL. Personal names are omitted under the organization's policy on personal data.

**Effort sizes** match the other research docs:

- **S:** about 1–2 dev-days.
- **M:** about 3–7 dev-days.
- **L:** more than 2 weeks.

**Codebase snapshot.**

- I read `apps/api/src/ingest/connectors/*`, `api/hooks.ts`, `work/activity.ts`, `team/members.ts`, `jobs/*` and `db/schema.ts`.
- The code changed **during** this research. Between 12:00 and 12:15 CET another session added:
  - `src/ingest/{types,quality,identity,effects}.ts`
  - `jobs/queue.ts`
  - the `inbound_events` and `jobs` tables
  - new `activities` and `identities` columns
- §5 reviews both the **baseline**, which is synchronous mapping inside the webhook request (what the brief describes), and the **in-progress** refactor as of 12:15. Names in the in-progress code may have moved since.
- I did not modify any project file.

---

## 2. Canonical event model

### 2.1 CloudEvents 1.0 as the envelope

**Status** [P]

- The latest core release is v1.0.2 (2022-02-06), and `specversion` stays `"1.0"`.
- **Required attributes:** `id`, `source` (URI-reference), `specversion` and `type`.
- **Optional attributes:** `datacontenttype`, `dataschema` (URI), `subject` and `time` (RFC 3339).
- "Producers MUST ensure that `source` + `id` is unique for each distinct event". Consumers may treat a repeated `source`+`id` as a duplicate.
- Attribute names are lowercase ASCII alphanumerics and SHOULD be ≤ 20 characters.
- In JSON, the payload goes in `data`, or `data_base64` for binary.
- Media types: `application/cloudevents+json`, and `application/cloudevents-batch+json` for batches.

**Extensions useful to Worklog** [P]. All of them are explicitly "no official standing" and may change.

| Extension | Attribute(s) | Use in Worklog |
| --- | --- | --- |
| recordedtime | `recordedtime` | When Worklog recorded the event, as distinct from `time` (when it happened). This is the CloudEvents name for `occurredAt` vs `recordedAt`. |
| partitioning | `partitionkey` | The thread key, which drives per-thread ordering in the queue. |
| dataref (claim check) | `dataref` | Points to the raw inbox row: `urn:worklog:inbound:inb_…#/review`. |
| sequence | `sequence` (a lexicographically orderable string per `source`) | The source revision, for last-writer-wins. Don't use `sequencetype`; it was removed after v1.0. |
| correlation | `correlationid`, `causationid` | Cross-thread grouping (a push and its merge; a PR and the issue it closes), and what caused what. This extension is in the repo but not listed in its README. |
| distributed-tracing | `traceparent`, `tracestate` | Trace an event from the webhook through the worker to SSE. |
| authcontext | `authtype`, `authid` | `authtype=service_account` for API-key ingest, `user` for humans. Informational only. |
| data-classification | `dataclassification` (`public`/`internal`/`confidential`/`restricted`) | A natural home for private-channel content. |

**Related standards** [P]

- CloudEvents SQL v1.0.0 (2024) defines filter expressions; consider it later for subscription filters.
- xRegistry, the CloudEvents event catalog and schema registry, is still at release candidates (rc4, 2026-08-19).

**How Worklog should use CloudEvents.** Use it at the boundaries, not as the storage format:

- **Ingest:** `POST /v1/events` accepting `application/cloudevents+json` and batches. This would sit alongside today's `POST /v1/activities`, for agents and CI that already emit CloudEvents.
- **Export:** SSE frames and outbound webhooks in CloudEvents structured mode, so consumers can use any CloudEvents SDK.
- **Inside:** keep normal columns (§6), and render the envelope on the way out.

### 2.2 Activity Streams 2.0 as the vocabulary

**Status** [P]

- AS2 Core and Vocabulary are W3C Recommendations (2017), maintained by a new Social Web WG.
- **Properties that matter:**
  - `actor`, `object`, `target` (the indirect object), `origin`, `result`, `instrument`
  - `context` ("intentionally vague", for grouping), `inReplyTo`
  - `generator` (the app that produced it), `attributedTo`, `tag`, `url`, `published`, `updated`
- **28 activity types,** including Create, Update, Delete, Add, Remove, Accept, Reject, Invite, Join, Leave, Offer, Question, Undo and View.

**Threading** [P]

- FEP-7888, "Demystifying the context property", is a DRAFT. It says `context` SHOULD resolve to a collection and is kept separate from `inReplyTo`.
- FEP-f228 (backfilling conversations) and FEP-171b (conversation containers) are also drafts.
- Lesson: model **thread** (the conversation, e.g. a PR or Slack thread root) separately from **parent** (what this replies to).

**ForgeFed** [P]

- An AS2 extension for forges, still a draft (snapshot 2025-06-18).
- **Activities:** `Push`, `Apply` (merge), `Resolve` (close a ticket), `Assign`, `Grant`.
- **Object types:** `Repository`, `Ticket`, `Patch`, `Commit`, `Branch`, `Review`, `ReviewThread`.
- Forgejo federation is "experimental" and off by default.
- It is useful as a vocabulary reference, not as a dependency.

### 2.3 Newer standards worth borrowing from

**CDEvents** (CD Foundation) [P]

- Latest is v0.5.1 (2026-04-15). It is pre-1.0, and v0.5.0 broke compatibility (snake_case → camelCase, `context.specversion`).
- **Source-control events:**
  - `dev.cdevents.change.created.0.4.0`
  - `change.reviewed`, `change.merged`, `change.abandoned` and `change.updated` (each `.0.3.0`)
  - `branch.created`/`deleted`
  - `repository.created`/`modified`/`deleted`
- **Ticket events** (added in v0.4.0, now `.0.2.0`): `ticket.created`, `ticket.updated` and `ticket.closed`, with fields `summary`, `ticketType`, `creator`, `assignees`, `priority`, `labels`, `resolution` and `updatedBy`.
- It has a CloudEvents binding, and `links`/`chainId` for connecting related events.
- **Caveat:** the `change` subject has no author or title, so Worklog needs its own fields.
- **Recommendation:** align Worklog's kind names and states so that a future CDEvents exporter is a mapping table, but don't adopt the format.

**OpenTelemetry semantic conventions, `vcs.*`** [P]

- These became Release Candidate in semconv v1.43.0 (2026-07-03).
- **Attributes:** `vcs.repository.url.full`, `vcs.repository.name`, `vcs.ref.head.name|revision|type`, `vcs.ref.base.*`, `vcs.change.id`, `vcs.change.title`, `vcs.change.state` (`open`, `wip`, `closed`, `merged`), `vcs.owner.name` and `vcs.provider.name` (`github`, `gitlab`, `gitea`, `bitbucket`).
- `cicd.*` (pipeline run state, result, URL) is also Release Candidate.
- **Recommendation:** use these exact keys in an `attrs` map on forge events. They are a ready-made, vendor-neutral dictionary, and agents emitting OTel can map 1:1.

**Standard Webhooks** [P]

- Headers: `webhook-id`, `webhook-timestamp` and `webhook-signature: v1,<base64>`, a space-separated list that allows key rotation.
- **Signing:**
  - The signed string is `id.timestamp.body`.
  - `v1` is HMAC-SHA256 with a `whsec_` secret. `v1a` is ed25519.
  - The reference library allows ±5 minutes of clock skew.
- **Adopters:** OpenAI, Anthropic, PagerDuty, Clerk, incident.io, Resend, Svix, Twilio and more. **GitLab 19.0+** also uses it (§7).
- **Recommendation:** use it as Worklog's _outbound_ webhook format and as a first-class _inbound_ preset.

**Others** (one line each)

- **AsyncAPI 3.x** [P]: publish Worklog's event catalog, one message per `kind`.
- **JSON Schema 2020-12** [P]: `dataschema` targets.
- **xAPI 2.0** [S]: actor–verb–object statements with `stored` vs `timestamp` and an `authority`. It confirms the shape, and nothing more.
- **schema.org Action** [P]: useful only for JSON-LD exports.
- **OCSF** [P]: security telemetry; not relevant.
- **UUIDv7** [U]: a fine choice for internal row ids, but not for event `id`s, which must be semantic.

### 2.4 Proposed schema: `worklog.activity` v1

This keeps the in-progress `WorklogEvent` (actor, kind, object, container, thread, signals, board, coalesce, importance, agent) and adds the fields the noise rules, replay and identity work need. A ★ marks fields to add before v1 freezes.

```ts
/** Schema major version. Bump only for breaking changes; additive fields are minor. */
export const ACTIVITY_SCHEMA = "urn:worklog:schema:activity:1"; // placeholder URI for CloudEvents `dataschema`

export type ActorRef = {
  /** Identity namespace: "github", "gitea:git.example.com", "gitlab:gitlab.example.com", "slack:T024BE7LD", "webhook:con_123". */
  ns: string; // ★ (today implied by the connection)
  /** The provider's most stable id: GitHub numeric id, Slack U…, GitLab user id. Never a login if an id exists. */
  id: string;
  handle?: string | null; // login/username; a hint for manual links and @mentions, not identity
  name?: string | null;
  /** user | bot | app (an integration acting as itself) | agent (AI coding agent) | unknown (ghost/deleted). */
  kind?: "user" | "bot" | "app" | "agent" | "unknown"; // ★ replaces `bot?: boolean`
  /** Only when the provider asserts it (Slack users:read.email); used for link suggestions, never displayed. */
  email?: string | null; // ★
};

export type ObjectRef = {
  /** pull_request | issue | review | comment | commit | push | message | thread | release | deploy | pipeline | log | incident … */
  type: string;
  /** Stable key; uses provider ids, not renameable names: "github:r612345/pr/42". */
  key: string;
  title?: string | null;
  url?: string | null;
  /** Current state of the object as of this event: open | draft | merged | closed | approved | changes_requested … */
  state?: string | null; // ★
  /** The object's author, when different from the actor (the PR author on a review event). */
  author?: ActorRef | null; // ★
};

export type ContainerRef = {
  type: "repository" | "channel" | "project" | "service" | "workspace";
  key: string;
  name?: string | null;
  url?: string | null;
};

export type ActivityEventV1 = {
  /** Deterministic, semantic and unique within the provider namespace. The dedupe key for webhooks, redeliveries, backfill and replay. */
  id: string;
  /** "<object>.<verb>", e.g. pr.opened, pr.merged, review.submitted, comment.created, message.posted. See the vocabulary table. */
  kind: string;
  /** upsert (default) or delete: tombstones for deleted messages and comments; edits are upserts with a higher revision. */
  op?: "upsert" | "delete"; // ★
  /** Source revision for last-writer-wins on edits/state changes (e.g. updated_at, Slack edited.ts). Zero-padded string. */
  revision?: string | null; // ★ (CloudEvents `sequence`)
  occurredAt: Date; // from the source payload, never the receive time when the source has one
  actor: ActorRef | null;
  /** For agent or automation work: the human it was done for. */
  agent?: {
    onBehalfOf?: ActorRef | null;
    state?: "working" | "needs_you" | "finished" | "failed";
  } | null;
  /** The app that produced it on the actor's behalf (GitHub performed_via_github_app, Slack app_id): AS2 `generator`. */
  generator?: { ns: string; id: string; name?: string | null } | null; // ★
  object: ObjectRef;
  /** What the object was added to or is about: review → PR, comment → issue, reply → thread root (AS2 `target`). */
  target?: ObjectRef | null; // ★
  container?: ContainerRef | null;
  /** The conversation it belongs to (AS2 `context`); also the queue partition key. `parent` is AS2 `inReplyTo`. */
  thread?: { key: string; parent?: string | null } | null; // ★ (today: `thread?: string`)
  /** Cross-thread grouping, e.g. "github:r612345/commit/9f2c…" shared by a merge and its push (CloudEvents correlationid). */
  correlationKey?: string | null; // ★
  title: string;
  body?: {
    text: string;
    format: "plain" | "markdown" | "slack_mrkdwn";
    truncated: boolean;
  } | null;
  url?: string | null;
  /** Typed links: closes/refs to issues and cards, commits, deploys, related URLs. */
  links?: {
    rel: "closes" | "refs" | "card" | "commit" | "deploy" | "related";
    key?: string;
    href?: string;
  }[]; // ★
  /** Everyone mentioned (resolved later to members). Signals stay the "asks something of someone" subset. */
  mentions?: ActorRef[]; // ★
  signals?: Signal[]; // as in src/ingest/types.ts
  board?: BoardEffect[]; // as in src/ingest/types.ts
  coalesce?: {
    key: string;
    windowMinutes: number;
    maxSpanMinutes?: number;
    units: number;
    template: string;
  } | null;
  /** Facts the gate and scorer use; set by the connector, so the gate stays connector-agnostic. */
  quality?: {
    bot?: boolean;
    automated?: boolean;
    draft?: boolean;
    forced?: boolean;
    trivial?: boolean;
    flags?: string[];
  }; // ★
  importance?: number; // connector hint, 0..1
  visibility?: "team" | "private" | "restricted"; // ★ restricted = private-channel content
  /** OpenTelemetry-style attributes (vcs.change.state, vcs.ref.head.name, cicd.pipeline.result …). */
  attrs?: Record<string, string | number | boolean>; // ★
  /** Where it came from; recorded on the activity for audit and replay. */
  source: {
    // ★
    connector: string;
    connectorVersion: string;
    connectionId: string;
    eventType: string;
    action?: string | null;
    deliveryId?: string | null;
    via: "webhook" | "redelivery" | "backfill" | "stream" | "api" | "replay";
  };
  /** Claim-check pointer to the raw delivery (CloudEvents `dataref`). */
  raw?: { inboundEventId: string; pointer?: string } | null; // ★
};
```

**Key rules**

1. **`id` is semantic, built from provider ids.** Some rename-safe templates:

   | Event         | `id` template                                      |
   | ------------- | -------------------------------------------------- |
   | PR opened     | `github:r{repo.id}/pr/{number}/opened`             |
   | PR merged     | `github:r{repo.id}/pr/{number}/merged`             |
   | Review        | `github:r{repo.id}/pr/{number}/review/{review.id}` |
   | Issue comment | `github:r{repo.id}/comment/{comment.id}`           |
   | Push          | `github:r{repo.id}/push/{ref}/{after}`             |
   | Slack message | `slack:{team}:{channel}:{ts}`                      |
   - `repository.full_name` changes on rename or transfer, so it goes in `container.name`, not the key.
   - Existing card `externalKey`s (`github:acme/api#42`) are rename-unsafe. Migrate them, or keep both forms in `links`.

2. **`activities.source` must be the provider namespace (`github`, `gitea:host`), not the connection id.** Then two overlapping connections dedupe on `(workspace, source, external_id)`. One example is an org webhook plus a repo webhook, which each deliver the same event with different delivery GUIDs [U]. The in-progress unique index already has this shape.
3. **`occurredAt` comes from the payload.** Use `merged_at`, `review.submitted_at`, `comment.created_at`, Slack `ts`, GitLab `object_attributes.updated_at`. The baseline uses `ctx.now()` throughout, which breaks backfill and replay ordering.
4. **Bodies are capped and typed.** Keep 2,000–4,000 characters with `truncated: true`, and keep the raw in the inbox.

**Vocabulary** (the `kind` set), mapped to standards so exporters are mechanical:

| `kind` | AS2 / ForgeFed | CDEvents | Notes |
| --- | --- | --- | --- |
| `pr.drafted` | Create (state=draft) | change.created | "now" snapshot only (§3.4) |
| `pr.opened` | Create / Offer | change.created | also emitted on `ready_for_review` |
| `pr.updated` | Update | change.updated | pushes to a PR branch, coalesced |
| `pr.merged` | Apply (ForgeFed) | change.merged |  |
| `pr.closed` | Reject | change.abandoned | closed without merge |
| `review.requested` | Invite | — | signal → attention |
| `review.submitted` | Create (Review), target = PR | change.reviewed | object.state = approved/changes_requested/commented |
| `comment.created` | Create (Note), inReplyTo | — | coalesced per thread |
| `issue.opened` / `issue.closed` / `issue.reopened` | Create / Resolve / Undo | ticket.created / closed / updated |  |
| `issue.assigned` | Assign (ForgeFed) | ticket.updated |  |
| `code.pushed` | Push (ForgeFed) | (branch.*) | direct pushes only (§3.5) |
| `release.published` | Create (Release) | — |  |
| `deploy.succeeded` / `deploy.failed` | — | (service/environment events) [U] | production only by default |
| `ci.failed` | — | (pipelineRun.finished) [U] | only on a PR head or the default branch |
| `message.posted` | Create (Note) | — | thread root; replies roll up into it |
| `log.entry` / `log.decision` / `log.blocker` / `log.win` | Create (Note), generator = worklog | — | manual logs |
| `agent.run.started` / `agent.run.finished` / `agent.needs_you` | — | — | agents as teammates |

### 2.5 Example: GitHub PR review (CloudEvents structured mode)

The input is a `pull_request_review` webhook with `action: submitted` and `review.state: changes_requested`.

```json
{
  "specversion": "1.0",
  "id": "github:r612345/pr/42/review/2398765432",
  "source": "urn:worklog:connection:con_01JB7Q9GH2",
  "type": "dev.worklog.review.submitted",
  "subject": "github:r612345/pr/42",
  "time": "2026-10-26T09:14:03Z",
  "datacontenttype": "application/json",
  "dataschema": "urn:worklog:schema:activity:1",
  "recordedtime": "2026-10-26T09:14:03.912Z",
  "partitionkey": "github:r612345/pr/42",
  "sequence": "2026-10-26T09:14:03Z",
  "dataref": "urn:worklog:inbound:inb_01JB7QA0XK#/review",
  "data": {
    "kind": "review.submitted",
    "op": "upsert",
    "occurredAt": "2026-10-26T09:14:03Z",
    "actor": {
      "ns": "github",
      "id": "583231",
      "handle": "octocat",
      "kind": "user"
    },
    "object": {
      "type": "review",
      "key": "github:r612345/pr/42/review/2398765432",
      "url": "https://github.com/acme/api/pull/42#pullrequestreview-2398765432",
      "state": "changes_requested"
    },
    "target": {
      "type": "pull_request",
      "key": "github:r612345/pr/42",
      "title": "Retry failed payments with backoff",
      "url": "https://github.com/acme/api/pull/42",
      "state": "open",
      "author": {
        "ns": "github",
        "id": "1234567",
        "handle": "payments-dev",
        "kind": "user"
      }
    },
    "container": {
      "type": "repository",
      "key": "github:r612345",
      "name": "acme/api",
      "url": "https://github.com/acme/api"
    },
    "thread": { "key": "github:r612345/pr/42" },
    "title": "Requested changes on acme/api#42: Retry failed payments with backoff",
    "body": {
      "text": "The retry loop needs a cap; see the inline notes.",
      "format": "markdown",
      "truncated": false
    },
    "url": "https://github.com/acme/api/pull/42#pullrequestreview-2398765432",
    "links": [{ "rel": "closes", "key": "github:r612345/issue/17" }],
    "signals": [
      {
        "type": "review_result",
        "who": { "ns": "github", "id": "1234567" },
        "state": "changes_requested"
      },
      {
        "type": "resolve",
        "who": { "ns": "github", "id": "583231" },
        "what": "review_requested"
      }
    ],
    "coalesce": null,
    "quality": { "bot": false, "automated": false },
    "importance": 0.65,
    "visibility": "team",
    "attrs": {
      "vcs.provider.name": "github",
      "vcs.change.id": "42",
      "vcs.change.state": "open",
      "vcs.ref.head.name": "fix/payment-retry",
      "vcs.ref.base.name": "main"
    },
    "source": {
      "connector": "github",
      "connectorVersion": "1.3.0",
      "connectionId": "con_01JB7Q9GH2",
      "eventType": "pull_request_review",
      "action": "submitted",
      "deliveryId": "72d3162e-cc78-11e3-81ab-4c9367dc0958",
      "via": "webhook"
    },
    "raw": { "inboundEventId": "inb_01JB7QA0XK", "pointer": "/review" }
  }
}
```

The `pull_request_review_comment` deliveries for the inline comments of this review carry `pull_request_review_id: 2398765432`. They fold into this activity (count and excerpt) instead of becoming their own items (§3.6).

### 2.6 Example: Slack message, with a thread roll-up

The root message is in opted-in `#eng-log`. Event `ts` `1793003643.000200` is 2026-10-26T08:34:03Z.

```json
{
  "specversion": "1.0",
  "id": "slack:T024BE7LD:C04ENGLOG:1793003643.000200",
  "source": "urn:worklog:connection:con_01JB7SLK01",
  "type": "dev.worklog.message.posted",
  "subject": "slack:T024BE7LD:C04ENGLOG:1793003643.000200",
  "time": "2026-10-26T08:34:03.000200Z",
  "datacontenttype": "application/json",
  "dataschema": "urn:worklog:schema:activity:1",
  "recordedtime": "2026-10-26T08:34:03.540Z",
  "partitionkey": "slack:T024BE7LD:C04ENGLOG:1793003643.000200",
  "dataref": "urn:worklog:inbound:inb_01JB7SM3QZ#/event",
  "data": {
    "kind": "message.posted",
    "op": "upsert",
    "revision": "1793003643.000200",
    "occurredAt": "2026-10-26T08:34:03.000200Z",
    "actor": { "ns": "slack:T024BE7LD", "id": "U061F7AUR", "kind": "user" },
    "object": {
      "type": "message",
      "key": "slack:T024BE7LD:C04ENGLOG:1793003643.000200",
      "url": "https://acme.slack.com/archives/C04ENGLOG/p1793003643000200"
    },
    "container": {
      "type": "channel",
      "key": "slack:T024BE7LD:C04ENGLOG",
      "name": "#eng-log"
    },
    "thread": { "key": "slack:T024BE7LD:C04ENGLOG:1793003643.000200" },
    "title": "Posted in #eng-log: Referral FHIR R4 mapping is on staging",
    "body": {
      "text": "Referral FHIR R4 mapping is on staging. <@U0G9QF9C6> can you smoke-test the consent flow?",
      "format": "slack_mrkdwn",
      "truncated": false
    },
    "mentions": [{ "ns": "slack:T024BE7LD", "id": "U0G9QF9C6" }],
    "signals": [
      {
        "type": "mentioned",
        "who": { "ns": "slack:T024BE7LD", "id": "U0G9QF9C6" },
        "excerpt": "can you smoke-test the consent flow?"
      }
    ],
    "quality": { "bot": false, "automated": false, "trivial": false },
    "importance": 0.35,
    "visibility": "team",
    "source": {
      "connector": "slack",
      "connectorVersion": "1.1.0",
      "connectionId": "con_01JB7SLK01",
      "eventType": "message",
      "action": null,
      "deliveryId": "Ev08MFMKH6",
      "via": "webhook"
    },
    "raw": { "inboundEventId": "inb_01JB7SM3QZ", "pointer": "/event" }
  }
}
```

A reply at `1793005361.004100` (09:02:41Z) normalizes to a **roll-up**, not a new feed item. The fields that differ:

```json
{
  "id": "slack:T024BE7LD:C04ENGLOG:1793005361.004100",
  "kind": "message.replied",
  "thread": {
    "key": "slack:T024BE7LD:C04ENGLOG:1793003643.000200",
    "parent": "slack:T024BE7LD:C04ENGLOG:1793003643.000200"
  },
  "target": {
    "type": "message",
    "key": "slack:T024BE7LD:C04ENGLOG:1793003643.000200"
  },
  "coalesce": {
    "key": "slack:T024BE7LD:C04ENGLOG:1793003643.000200",
    "windowMinutes": 1440,
    "maxSpanMinutes": 4320,
    "units": 1,
    "template": "{root} · {n} repl{ies} from {people}"
  },
  "quality": { "trivial": true }
}
```

The pipeline updates the root activity in place: count, participants, `updatedAt`, and the re-rendered title "Posted in #eng-log: Referral FHIR R4 mapping is on staging · 6 replies from 3 people". It then publishes `activity.updated`. A trivial reply ("thanks!") still counts toward the roll-up, but never shows as its own line.

---

## 3. Noise reduction and data quality

### 3.1 Principles

- **Precision over recall.** The brief, the attention list and the assistant all read the same stream, so one false item costs more than one missed item. Missing items can be recovered later by replay.
- **Three layers, each with a different job:**
  1. **Connector `normalize`** removes what is obviously not work for that source: stars, label edits, `channel_join`.
  2. **Shared `gate`** applies the workspace policy: bots, drafts, ignored kinds. The in-progress `src/ingest/quality.ts` already holds this layer.
  3. **Ranking** decides what surfaces where: importance at write time, relevance to the viewer at read time.
- **Never drop silently.** Each inbound delivery records its outcome per event: `kept`, `merged into act_…`, or `dropped: <reason>`. The in-progress `inbound_events.outcome` does this. That record answers "why didn't my PR show up?" and makes rules testable.
- **Policy changes reapply through replay** (§4.5), not through code paths that guess.

### 3.2 What the established tools do

| Tool | Bot handling | Drafts | Identity | Other rules |
| --- | --- | --- | --- | --- |
| **Swarmia** [P] | Detects bots by GitHub account type, a `[bot]` suffix, names starting or ending in "bot"/"ci", known accounts (github-actions, dependabot) and bot noreply emails. GitLab bots are marked by hand. Manual toggle; auto-detection never clears the mark. Bots are excluded from review metrics, review-request DMs and "From others", but bot PRs still count in throughput. | Treated like other PRs. An optional exclusion rule `Draft status is Draft` applies to "metrics, alerts, work log". | Auto-merges authors that share an email "and complement each other". Never merges bots or AI tools. Remembers rejected pairs. Suggests merges from emails, usernames and names. | Personal DMs "only … when an action is required". A daily team digest. Review-request alerts are crossed out once done. |
| **LinearB** [P] | Manual: support excludes bot addresses (in-product setting "planned"). | Labels or a title regex; draft time counts as coding time and is excluded from cycle time. | Auto-merge every 24 h. Confidence ≥ 95% merges automatically; 80–94% goes to an admin's Bulk Merge review. Merges are reversible. | Regex branch exclusion (`staging`, `develop`) and file-extension exclusion (lock files, bundles). |
| **Haystack** [P] | Ignores bot PRs automatically (method not documented). | "Ignores all pull requests in draft" by default; draft time becomes dev time once ready. | PRs by authors on no team are ignored. | Label exclusion rules remove PRs "from all calculations including … notifications". |
| **DX** [P] | — | — | Links by email by default. Notes that GitHub doesn't expose work emails, except Enterprise Cloud verified domains (`organizationVerifiedDomainEmails`), so it links by username or CSV/SCIM. Multiple accounts per person; an "unlinked users" filter. | — |
| **Jellyfish** | No public docs found [U]. |  |  |  |
| **Linear's GitHub integration** [P] | Not documented. | A "drafted" status trigger. | Links by issue ID in the branch name or PR title, or magic words in the title, description or commits. "Magic words in PR comments won't create links." `skip`/`ignore` before the ID opts out. | With several PRs per issue, status changes only when the _last_ one reaches the state. |
| **Slack AI recaps** [P] | Not documented. | — | — | Daily recap of channels you "visit often, but don't tend to participate in". After an absence it covers the days you were away. Cites sources, and only uses what you can access. |

What Worklog should take from them:

- Bots get detected and quieted, not deleted.
- Email linking is fine for suggestions; auto-linking needs a verified source.
- Remember rejected links.
- Digests beat per-event pings. Worklog already does this.
- Cite the source activity in every summary.

### 3.3 Bot and automation detection

**Facts** [P] unless marked:

- GitHub user objects carry `type` (`User`, `Bot` or `Organization`).
- Accounts checked in live API responses [P]:

  | Login                                | Numeric id | `type`   |
  | ------------------------------------ | ---------- | -------- |
  | `dependabot[bot]`                    | 49699333   | Bot      |
  | `github-actions[bot]`                | 41898282   | Bot      |
  | `renovate[bot]`                      | 29139614   | Bot      |
  | `web-flow` (committer on web merges) | 19864447   | **User** |
  | `ghost` (deleted users)              | 10137      | User     |

- **Logins are unreliable for bots.** `copilot-swe-agent[bot]` and `copilot-pull-request-reviewer[bot]` both report login `Copilot` without the suffix [P]. Machine users such as `renovate-bot` are type `User` [P].
- `performed_via_github_app` on issues and comments is non-null when an app acted with a _user_ token [P].
- "Don't assume `sender` always identifies the person who caused an event" [P].
- **Slack:** current apps' bot messages carry `bot_id` and `bot_profile`, and older ones `subtype: bot_message` [P].
- **Discord:** `author.bot` and `webhook_id` mark bot messages [U].

**Rules**

| # | Rule | Result |
| --- | --- | --- |
| B1 | `user.type == "Bot"` (GitHub, Gitea `type`) | `actor.kind = "bot"` |
| B2 | Login matches `/\[bot\]$/i` | bot |
| B3 | Numeric id in a shipped known-bot list (dependabot, renovate, github-actions, codecov, vercel …), keyed by **id** | bot |
| B4 | Machine-user heuristic: login or name matches `/(^ | [-_.])(bot | ci | automation | deploy | release)([-_.] | $)/i`, or the email is a bot noreply | **suggest** bot: set `identities.bot_source = 'heuristic'` and ask an admin; don't apply silently |
| B5 | `performed_via_github_app != null`, Slack `app_id` without `bot_id` (Workflow Builder), GitLab system notes [U] | `quality.automated = true`, `generator` set, actor stays the human |
| B6 | Commit committer `web-flow` / `noreply@github.com`, or a GitLab or Gitea system committer | never an actor; use the PR merger or pusher |
| B7 | `sender.id == 10137` (`ghost`) | `actor.kind = "unknown"`; don't attribute |
| B8 | An admin marks an identity as bot or not-bot | sticky override; auto-detection never clears it (Swarmia's rule) |
| B9 | **The identity is linked to a Worklog agent member** (Copilot, Claude, Devin…) | `actor.kind = "agent"`: **not noise.** Keep at normal importance, set `agent.onBehalfOf` to the human who assigned or triggered it, and never let it raise high-priority attention (the in-progress `cap()` already does this) |

**Policy** (the in-progress `bots: "quiet" | "drop" | "keep"` is the right shape):

- `quiet` is the default. Keep `pr.opened`, `pr.merged`, `release.published` and `deploy.*` at ×0.3 importance, and drop the rest.
- Coalesce per bot, repo and kind per day. "Dependabot opened 7 PRs in acme/api" becomes one line.
- Bots can raise attention only through explicit review requests, and then at most at `normal` priority.

### 3.4 Draft PRs

| Event | Action |
| --- | --- |
| `pull_request.opened` with `draft: true` | `pr.drafted`, importance 0.15, **not in the feed or briefs**. Shows in `now` ("drafting #42") and counts as card activity (resets entropy). No signals. |
| `ready_for_review` | `pr.opened` (the moment the team should notice), importance 0.6. Requested reviewers become signals now. |
| `converted_to_draft` | Update the object state; no activity. Close open `review.requested` attention items on that PR as `dismissed`, reason "back to draft". |
| `review_requested` while draft | Record the request, but defer the signal until `ready_for_review` [U: whether GitHub notifies reviewers on drafts]. |
| Gitea / Forgejo | `draft` comes from the WIP title prefix, and there is no `ready_for_review` [P]. Infer it from `edited` with `changes.title` losing the prefix. |
| GitLab | `object_attributes.draft` [P]; same rules. |

This combines Haystack (drafts hidden from metrics and notifications) with Linear (a "drafted" status). A draft is a strong "what is X working on" signal but weak team news.

### 3.5 Pushes: force pushes, rebases, and push-vs-merge dedupe

**Facts** [P]

- A push payload has `ref`, `before`, `after`, `created`, `deleted`, `forced`, `base_ref`, `compare`, `commits[]` (each with `distinct`), `head_commit`, `pusher` and `sender`.
- Payloads carry ≤ 2048 commits.
- No event fires for more than 3 tags or more than 5000 branches pushed at once.
- Payloads are capped at 25 MB.
- Merging in the UI creates commits with committer `web-flow`.
  - Squash commits end with `(#N)`.
  - Merge commits read `Merge pull request #N from …`.
  - Rebase-merge rewrites SHAs [P].
- The `pull_request.closed` payload has `merged` and `merge_commit_sha`.
- Commit caps differ: GitLab 20 (with `total_commits_count`), Gitea 5 and Forgejo 15 (with `total_commits`), Bitbucket 5 (with `truncated`) [P]. **Always count from the total field, never `commits.length`.**

**Rules**

| # | Rule |
| --- | --- |
| P1 | Ignore `deleted: true`. For `created: true` with no distinct commits, record the branch creation silently (card activity only). |
| P2 | Count only `commits[].distinct == true`. If that leaves zero commits, the push carries no new work, so emit nothing. This catches merges into main of already-pushed commits, and fast-forwards. |
| P3 | `forced: true` (a rebase or amend) produces no "pushed N commits" item. If the branch has an open PR, emit `pr.updated` with `quality.forced = true` at importance 0.1, which touches the PR thread and card clock. Otherwise do nothing. |
| P4 | **Push-vs-merge.** On a push to `repository.default_branch`, compute `correlationKey = github:r{repo}/commit/{after}`. `pr.merged` uses the same key from `merge_commit_sha`. When both exist, `pr.merged` wins and the push is suppressed, **whichever arrives first** (see below). |
| P5 | If P4 doesn't match, but `head_commit.committer.username == "web-flow"` and the first line of the message matches `/^Merge pull request #(\d+)/` or `/\(#(\d+)\)$/`, link the push to PR #N's thread and suppress it. |
| P6 | A push to the default branch with distinct commits and **no** PR is a direct push. Keep it as `code.pushed` with importance +0.15: it bypassed review, which is notable. |
| P7 | A push to a branch with an open PR becomes `pr.updated`, coalesced per PR in a 2 h window ("pushed 9 commits"), importance 0.2. |
| P8 | A push to a branch without a PR becomes `code.pushed`, coalesced per (actor, repo, branch): 2 h sliding window, 24 h maximum span. Show the last 5 distinct commit subjects. |
| P9 | Branches matching workspace `ignoreBranches` regexes (LinearB's pattern, e.g. `^(gh-pages | dependabot/.* | renovate/.*)$`) are dropped. |
| P10 | Ignore `synchronize` for counting, since the matching `push` already covers it. Use it only to refresh PR state (head SHA). |

**Making P4 order-independent.**

- Give `activities` a `correlation_key` and a `precedence` (`pr.merged` = 10, `code.pushed` = 1).
- When an event's correlation key matches an existing row:
  - The higher precedence stays visible.
  - The lower one is stored with `suppressed_by = <id>`, or dropped with outcome `merged`.
- The two events live in different threads, so per-thread ordering doesn't help. A unique partial index on `(workspace_id, correlation_key) WHERE suppressed_by IS NULL`, plus a retry on conflict, makes it race-safe.

### 3.6 Coalescing bursts

The in-progress `coalesce { key, windowMinutes, units, template }` is the right primitive. Add `maxSpanMinutes`, so a busy branch can't grow one item forever, and take `importance = max(...)` across merged events.

| Burst | Key | Window / max span | Result |
| --- | --- | --- | --- |
| Commits to a branch | actor + repo + branch | 2 h / 24 h | "Pushed 14 commits to feature/x" |
| Comments by one person on a thread | actor + thread | 30 min / 4 h | "Left 4 comments on #42" |
| A review and its inline comments | review id | — | One `review.submitted`. `pull_request_review_comment` with a known `pull_request_review_id` adds to its count and is never its own item [P: fields; U: arrival order] |
| Slack thread replies | thread root | 24 h / 72 h | Roll-up on the root (§2.6) |
| Consecutive top-level Slack messages | actor + channel | 10 min / 30 min | People type in several short lines |
| Bot activity | bot + repo + kind | per day | "Renovate opened 5 PRs" |
| CI failures on one PR | thread + workflow name | 2 h | One "CI failing on #42" item, updated |

**Mechanics**

- Coalescing updates the existing row in place (`count`, `title`, `updatedAt`, `data.items[]` capped at about 20) and publishes `activity.updated`.
- It never re-raises attention: signals carry their own dedupe keys.
- Because the coalesce key sits inside the partition key for all rows above except "actor + channel" and bots, per-thread ordering serializes these updates and avoids lost updates. For the cross-thread keys, use `SELECT … FOR UPDATE` on the coalesced row.

### 3.7 Which GitHub events and actions signal work

| Event | Keep (action → kind) | Drop / other use |
| --- | --- | --- |
| `pull_request` | opened (non-draft) / ready_for_review → `pr.opened`; closed + merged → `pr.merged`; closed → `pr.closed`; review_requested → signal; assigned → signal | `edited` (refresh title silently), `labeled`/`unlabeled`, `milestoned`, `locked`, `auto_merge_*`, `enqueued`/`dequeued`, `synchronize` (§3.5), `converted_to_draft` (state only) [P: action list] |
| `pull_request_review` | submitted → `review.submitted`; an empty-body `commented` review with only inline comments still counts once | `edited`; `dismissed` (state only, and resolves the author's "changes requested" item) |
| `pull_request_review_comment` | folded into the review | standalone `created` without a review id: coalesce as a comment |
| `pull_request_review_thread` | — | `resolved` may resolve a mention item [U] |
| `issue_comment` | created → `comment.created` (coalesced), with mentions extracted | `edited` (upsert body), `deleted` (tombstone), `pinned` |
| `issues` | opened / closed / reopened / assigned (cards and signals) | labeled, milestoned, transferred, typed |
| `push` | §3.5 | tags (`refs/tags/*`): drop, since `release` covers them |
| `release` | published → `release.published` (high) | created, edited, prereleased (low) |
| `deployment_status` | `failure`/`error` on production → `deploy.failed`; `success` on production → `deploy.succeeded` | non-production environments |
| `check_run`, `check_suite`, `status`, `workflow_run`, `workflow_job` | **only** a failed conclusion on a PR's head SHA → signal to the PR author (normal priority, coalesced), or a failure on the default branch → team item | everything else (high volume, low signal). Repo webhooks get only `created`/`completed` for check runs [P] |
| `create` / `delete` (branches, tags) | — | card activity only |
| `star`, `watch`, `fork`, `member`, `team`, `repository`, `meta`, `public`, `label`, `milestone`, `gollum`, `discussion*` | — | drop (discussions optional, as `comment.created`) |
| `ping` | — | answer 200; mark connection health OK |

### 3.8 Slack signal extraction

**Facts** [P]

- **Delivery:** ack within 3 s. Up to 3 retries (immediately, after 1 min, after 5 min) with `X-Slack-Retry-Num` and `X-Slack-Retry-Reason`. Respond with `x-slack-no-retry: 1` to stop retries.
- **Auto-disable:** subscriptions are disabled if more than 95% of deliveries fail within 60 min. Apps receiving fewer than 1,000 events per hour are exempt.
- **Rate limit:** 30,000 events per workspace, per app, per 60 min. Beyond that Slack sends `app_rate_limited`.
- **Subtypes:** there are 30+ message subtypes.
  - `message_changed` carries a nested `message` and `edited`.
  - Replies (`message_replied`) arrive _without_ a subtype over the Events API, so detect them by `thread_ts != ts`.
- **Emails:** `users.info` returns `profile.email` with `users:read.email`.
- **History limits:** for commercially distributed apps **not on the Slack Marketplace**, `conversations.history` and `conversations.replies` drop to 1 request per minute with `limit` ≤ 15. This applied from 2025-05-29 for new installs and from 2026-03-03 for existing ones. Internal custom apps keep 50+ requests per minute.
- **API Terms** (2025-10-10), for apps used outside your organization: no "us[ing] API Data to train a large language model", no bulk export, and retention of other organizations' data limited to "the minimum necessary".

**Rules**

| # | Rule |
| --- | --- |
| S1 | **Channel opt-in only** (already true). DMs and group DMs (`im`, `mpim`) never become activity, only attention for mentions (already true). |
| S2 | **Private channels:** only on explicit opt-in, and activity gets `visibility: "restricted"`, readable only by members who are in that channel. When membership can't be checked, store only "active in a private channel" with no body. |
| S3 | Drop subtypes `channel_join`/`leave`/`topic`/`purpose`/`name`/`archive`, `pinned_item`, `reminder_add`, `bot_message`, `ekm_access_denied`, `assistant_app_thread`. Keep `file_share` (title only: "shared a file", no file content), `thread_broadcast` (a reply, deduped by `ts`) and `me_message`. |
| S4 | **Edits:** `message_changed` becomes an upsert of the same id with `revision = edited.ts`. Never create a new activity, and ignore edits with no text change (Slack's language detection also fires `message_changed` [P]). **Deletes:** `message_deleted` becomes `op: "delete"`, which removes the body and title and keeps a tombstone for audit. The baseline drops all subtypes, so edited text goes stale and **deleted messages persist**. That is a privacy defect. |
| S5 | **Trivial filter.** First strip mentions, `:emoji:` codes, pictographs, punctuation and whitespace. Drop the message as its own item (it still counts toward the thread roll-up) if what remains is empty, or matches the workspace acknowledgement lexicon, or is shorter than 12 characters with no digit or URL. **Override:** never drop a message containing a keyword (`blocked`, `stuck`, `help`, `urgent`, `down`, `broken`, `failing`, `shipped`, `merged`, `deployed`, `released`, `decided`). |
| S6 | **Thread roll-up:** replies coalesce into the root (§2.6). A reply in a non-opted-in channel still raises a mention signal. Summarize long threads (≥ 5 replies) at **brief time**, citing message ids, never at ingestion: that keeps ingestion cheap and keeps model calls off untrusted text on the hot path. |
| S7 | Reactions (`reaction_added`) never become activity. Later, a ✅ from the person who asked can resolve that thread's attention item. |
| S8 | **Bodies:** keep ≤ 2,000 chars. Never fetch files. Raw inbox retention defaults to 30 days for Slack. Never send Slack-derived text to model _training_. Inference for the customer's own briefs is a different matter, but document it in the privacy notice [U: legal reading of the terms]. |
| S9 | **Self-hosters create their own (internal) Slack app,** today's model, so they are exempt from the non-Marketplace history limits. A hosted multi-tenant Worklog would need Marketplace listing for backfill to work. |

The acknowledgement lexicon is a per-workspace setting. The default English set: `ok, okay, k, kk, thanks, thank you, thx, ty, tysm, cool, nice, great, awesome, sure, yes, yep, yeah, no, nope, np, done, lgtm, +1, will do, on it, got it, noted, sounds good, perfect, ack`. Add per-locale sets. For a Kigali team, that might include `merci`, `murakoze`, `yego` and `sawa` [U: locale choice].

### 3.9 Identity resolution

**Facts** [P]

- GitHub: "Always use the `id` of the user… This value will never change". "Never use identifiers that can change… handles, organization slugs, or email addresses."
- An old username "becomes available for anyone else to claim".
- Noreply emails take two forms: `ID+USERNAME@users.noreply.github.com` (accounts since 2017-07-18) and legacy `USERNAME@users.noreply.github.com`.
- GitHub links commits to accounts only by email match.
- GitLab redacts `user.email` (`[REDACTED]`) unless the email is public.
- Gitea always sends a placeholder `<id>+<name>@<noreply>` email.
- Slack emails need `users:read.email`.

**Rules**

| # | Rule |
| --- | --- |
| I1 | The identity key is `(workspace, namespace, stable_id)`. Self-hosted namespaces include the host (`gitea:git.example.com`, `gitlab:gitlab.example.com`). Slack includes the team (`slack:T…`). Declarative webhooks are per connection (`webhook:con_…`), so a generic webhook can never claim to be a GitHub user. |
| I2 | Logins are hints. A manual link by login creates a `handle:<login>` placeholder, upgraded to the stable id the first time the pair is seen together. **Upgrade only placeholders:** see the defect in §5.2. |
| I3 | Auto-link only at high confidence: (a) the person signed in with that provider, so the OAuth account id equals the webhook id (in-progress code does this); (b) the email is provider-verified and matches the member's verified email exactly (Slack `users.info`; GitHub Enterprise verified-domain email); (c) a GitHub noreply email `ID+login@…` whose `ID` is already linked. |
| I4 | Medium confidence becomes a **suggestion**, never a link: a commit-author email equal to the member's email, a similar display name, the same login across providers. Store it in `identity_link_suggestions` with method and confidence. |
| I5 | **Never auto-link a bot identity, and remember rejections** (Swarmia). A person may have several identities per provider (DX). |
| I6 | **Unknown actors:** record the identity with `member_id = null`, keep its events, and show an "Unlinked accounts" queue sorted by event count with actions _Link to…_, _Bot_, _Not a person_, _Ignore_. Linking re-attributes history; the in-progress `linkIdentityToMember` does this. |
| I7 | **Commit authors:** map author emails through an `email` namespace (a `.mailmap`-like table), using the noreply-email parse first. Never trust a commit author email for _authentication_, only for attribution suggestions. |
| I8 | **Renames:** when a known stable id arrives with a new login, update `external_handle` and append to `previous_handles`. When a login arrives with a _different_ stable id than the one on file for that login, it belongs to a **different person**. Create a new identity and flag the old one. |

### 3.10 Importance scoring

Importance is "how much this matters to the team, in general". Relevance to a particular reader is computed at read time. Keep the formula transparent and explainable ("why am I seeing this").

```ts
importance = clamp01(
  base[kind]                         // table in src/ingest/quality.ts (pr.merged .8, pr.opened .6, review.submitted .55 …)
  * (bot ? 0.3 : automated ? 0.6 : 1)
  * (draft ? 0.4 : 1)
  + (directPushToDefault ? 0.15 : 0)
  + (review.state === "changes_requested" ? 0.1 : 0)
  + (touchesGoldenCard ? 0.2 : touchesActiveCard ? 0.1 : 0)
  + (firstEventInThread ? 0.05 : 0)  // new work started
  + 0.05 * Math.log2(1 + coalescedCount) // capped at +0.15
  + (keywordHit /* blocked, outage … */ ? 0.15 : 0)
)
relevance(viewer) = importance
  + (viewer is author/assignee/reviewer/mentioned ? 0.4 : 0)
  + (viewer watches the card or participated in the thread ? 0.2 : 0)
  + (same team ? 0.1 : 0)
```

**Thresholds**

- The feed shows ≥ 0.2.
- Briefs include ≥ 0.5, plus the top K per person.
- The assistant's "what is X working on" uses everything ≥ 0.15, including drafts.
- Attention is separate: it is driven by signals, not importance.

**Calibration.** Tune the constants against a replay set of real inbound events (§4.5), with the existing `attention_feedback` as labels. The proactive-agents brief already lists "an offline replay set to tune gates" on the roadmap.

### 3.11 Mention extraction

- The baseline GitHub regex `(?:^|[^\w\`])@([a-z0-9]…)` fires inside fenced code blocks and quoted replies (`> @sam said…`). Both cause false "mentioned you" attention.
- **Before extracting mentions,** strip fenced and inline code and lines starting with `>`.
- **Slack:** strip `>` quote lines too, but keep `<@U…>` elsewhere.
- **Ignore self-mentions,** which the code already does.
- **Ignore mentions by bots,** unless the identity is an agent member.

---

## 4. Pipeline architecture for reliability and scale

### 4.1 Shape

```
provider ──HTTP──▶ /hooks/:connector/:connectionId[/:channel]
                    1. size cap (5 MB generic; 25 MB github) · lookup connection · read raw bytes
                    2. connector.verify(raw, headers)        → 401 + health.sig_failures++ on failure
                    3. connector.classify → respond (handshake) | interaction (sync) | event
                    4. BEGIN
                         INSERT inbound_events(raw_body, headers, sha256, delivery_id, event_type,
                                               partition_key, payload) ON CONFLICT DO NOTHING
                         INSERT jobs(queue='ingest', dedupe_key=inbound.id, ordering_key=partition_key)
                       COMMIT
                    5. 200 {ok} in ~5–20 ms (GitHub 10 s, Slack 3 s, GitLab 10 s, Gitea/Forgejo 5 s budgets)
                                         │
worker(s) ◀── claim (SKIP LOCKED, FIFO per ordering_key) ─┘
   6. normalize (pure, versioned) → events[]
   7. gate (bots, drafts, trivial, ignore rules) → kept / dropped(reason)
   8. resolve identities (stable id → member | unlinked)
   9. one transaction: upsert activities by semantic id · coalesce · correlation/supersede ·
      board effects · signals → attention · inbound.status/outcome · publish events
  10. on error: retry with backoff+jitter → dead (inspectable, replayable)
```

**Synchronous paths stay synchronous:** Slack slash commands and Discord interactions answer within 3 s. Deferred work (`ask`, `brief`) should become a **job**, not a `void promise`. The baseline's fire-and-forget `void runSlackCommand(...)` and `void handleSlackEvent(...)` are lost if the process restarts.

### 4.2 The inbox (raw-first)

**Why store raw bytes, not just parsed JSON:**

- Signatures cover the exact bytes. JSONB reorders keys and collapses whitespace, so a parsed payload can't be re-verified, can't be used as a faithful test fixture, and can't be re-processed by a connector that needs the original.
- It sidesteps the Bun jsonb bug (§4.6) for the most important column.

**What to store** (extends the in-progress `inbound_events`):

- `raw_body text`. Compress large bodies later if needed.
- `headers jsonb`: an allowlist only (`x-github-*`, `x-gitlab-*`, `x-gitea-*`, `webhook-*`, `x-slack-*`, content-type, user-agent). Never `authorization`, never the token header.
- `body_sha256`
- `partition_key`
- `via` (webhook | redelivery | backfill | stream | api | replay)
- `connector_version`
- `occurred_at` hint
- `payload jsonb` for querying, written with the jsonb workaround.

**Delivery id per source** (the inbox's unique key, together with `connection_id`):

| Source            | Delivery id                                         |
| ----------------- | --------------------------------------------------- |
| GitHub            | `X-GitHub-Delivery`, stable across redeliveries [P] |
| Slack             | `event_id` [P]                                      |
| GitLab            | `webhook-id` / `Idempotency-Key` (17.4+) [P]        |
| Gitea / Forgejo   | `X-Gitea-Delivery` / `X-Forgejo-Delivery` [P]       |
| Standard Webhooks | `webhook-id` [P]                                    |
| Linear            | `Linear-Delivery` [P]                               |
| Jira              | `X-Atlassian-Webhook-Identifier` [P]                |
| Bitbucket Cloud   | `X-Request-UUID` [P]                                |
| Fallback          | `sha256(body)`                                      |

**A failed delivery must be re-processable.** In the baseline, `claimDelivery` records the delivery _before_ processing. A processing failure marks it `failed`, but a later GitHub redelivery of the same `X-GitHub-Delivery` then returns `duplicate: true` and is never processed. The failure is permanent, and because the payload was never stored, it can't be replayed either.

- **Inbox rule:** on conflict, if the existing row is `failed` or `dead`, re-enqueue it. If it is `processed` or `ignored`, answer 200 duplicate.

**Retention:**

- Keep `raw_body` for 30 days (Slack) to 90 days (forges), configurable.
- After that, null the body and keep the metadata row, so "what happened" stays answerable.
- Delete in daily batches.
- Monthly partitioning is optional later. Drizzle doesn't model partitions, and PGlite would need the same DDL.

### 4.3 Queue: choice and hardening

**Comparison** (versions as tested this session):

|  | Drizzle-native `jobs` (in progress) | pg-boss 12.38.0 (2026-10-13) | graphile-worker 0.18.0 (2026-09-08) | pgmq |
| --- | --- | --- | --- | --- |
| Driver | whatever Drizzle uses (Bun SQL / PGlite) | own `pg`, **or** adapters `fromBunSql`, `fromPglite`, `fromDrizzle`, `fromKnex`, `fromKysely`, `fromPrisma` [P] | `pg` only; PGlite and Bun support requested in open issues #441 and #477 [P] | SQL extension |
| Bun | yes | README: "Node 22.12 or higher, or Bun"; LISTEN/NOTIFY needs Bun ≥ 1.4, otherwise polling [P]. Bun JSON bugs fixed 2026-09 (#880, #936) [P] | not official | yes (SQL) |
| PGlite | yes | **works** via `fromPglite` + `backend:'pglite'`: send, fetch, work, complete, fail→retry, `key_strict_fifo` [E] | only through `@electric-sql/pglite-socket` with `noPreparedStatements: true` [E] | on PGlite's extension list; create, send and read worked [E] |
| Per-key ordering | add `ordering_key` (below) | `key_strict_fifo` policy, but a _failed/dead_ job blocks its key [P] | `queue_name` serializes [P] | not confirmed [U] |
| Dedupe | add `dedupe_key` | `singletonKey`, policies | `job_key` (replace / preserve_run_at) | — |
| Retries / dead letters | backoff, then `dead` | `retryLimit`/`retryDelay`/`retryBackoff`/`retryDelayMax`, `deadLetter` [P] | fixed `exp(min(attempts,10))` s, `max_attempts` 25 [P] | visibility timeout |
| Footprint | 1 table, about 200 lines | `pgboss` schema with about 11 tables and partitions [E] | own schema | extension needed on prod Postgres |

**Recommendation: keep the Drizzle-native queue.**

- It runs the identical SQL on Bun SQL and PGlite.
- It enqueues in the same transaction as the inbox insert.
- It is small enough to own.
- pg-boss is the credible fallback if requirements grow (cron flows, job dependencies). graphile-worker is not a fit.

**Hardening the in-progress `jobs/queue.ts`:**

1. **Ordering key** (per-thread FIFO) and **dedupe key.** This claim SQL was tested on PGlite [E]:

   ```sql
   -- columns: queue, dedupe_key, ordering_key, priority, locked_by (+ existing)
   create unique index jobs_dedupe_uq on jobs (queue, dedupe_key) where dedupe_key is not null and status in ('queued','running');
   create unique index jobs_running_key_uq on jobs (ordering_key) where status = 'running';
   create index jobs_ready_idx on jobs (queue, priority desc, run_at, id) where status = 'queued';
   create index jobs_key_idx on jobs (ordering_key, id) where status in ('queued','running');

   with next as (
     select j.id from jobs j
     where j.queue = $1 and j.status = 'queued' and j.run_at <= now()
       and (j.ordering_key is null or not exists (
         select 1 from jobs p where p.ordering_key = j.ordering_key
           and (p.status = 'running' or (p.status = 'queued' and p.id < j.id))))
     order by j.priority desc, j.run_at, j.id
     limit $2 for update skip locked)
   update jobs j set status = 'running', attempts = j.attempts + 1, locked_by = $3,
     locked_until = now() + make_interval(secs => $4)
   from next where j.id = next.id returning j.*;
   ```

   - The partial unique index is the race backstop: catch `23505` and claim again.
   - Unlike pg-boss, a `dead` job does **not** block its thread. That is the right default for activity, since later events must not stall behind one poisoned payload.
   - Ordering matters for raise-then-resolve pairs. A `review_requested` and the review itself, processed out of order, would leave a stale "wants your review" item. Belt and braces: `resolve` also records a watermark, and `raise` skips if a resolve with a later `occurredAt` exists.

2. **Fencing.** Settle with `WHERE id = $1 AND status = 'running' AND attempts = $2`. Today `settle()` deletes or updates by `id` alone, so a worker whose lease expired (and whose job another worker reclaimed) can delete or requeue the other worker's attempt.
3. **Jitter:** `delay = min(1h, 10s · 2^(attempts−1)) · (0.75 + random() · 0.5)`.
4. **Lease heartbeat** for long jobs (backfill pages); recovery of expired leases already exists.
5. **Wake-ups:**
   - Poll every 250–1000 ms.
   - When enqueuing in the same process, nudge the local worker directly.
   - LISTEN/NOTIFY works on PGlite (`pglite.listen`) [E], but on Bun SQL it needs Bun ≥ 1.4 (per pg-boss docs) [P]. The repo is on Bun 1.3.6, so treat it as optional.
6. **Fairness across workspaces** (later): limit claims per workspace per batch, so one noisy tenant can't starve others.
7. **Bloat:** delete on success (already done). Set a low `autovacuum_vacuum_scale_factor` on `jobs` in production. Avoid long transactions.

### 4.4 Idempotency, ordering and state

Idempotency comes in three layers:

1. **Delivery:** the inbox `(connection_id, delivery_id)` key.
2. **Semantic:** `activities (workspace, source, external_id)` with a deterministic id (§2.4). This catches redeliveries, backfill overlap and duplicate hooks.
3. **Effects:** attention dedupe keys (present), board effects by `externalKey` (present), signals keyed on `thread`.

**State is last-writer-wins by source revision.** Object state (PR open/merged, message text, card title) updates only if the incoming `revision` (`updated_at`, `edited.ts`) is ≥ the stored one. GitHub doesn't promise delivery order [U], and backfill can deliver old states late.

### 4.5 Replay

- **Endpoint:** `POST /v1/connections/{id}/replay` taking `{since, until, eventTypes?, dryRun: true}`.
- **What it does:** re-runs `normalize` and `gate` over stored inbox rows with the _current_ connector version. A dry run returns a diff: events added, changed (title, importance, kind) and removed.
- **Applying it:**
  - Rows re-emitted with the same id are updated.
  - Activities tied to an `inbound_event_id` that the new version no longer emits are deleted, or marked suppressed.
  - Attention is **not** re-raised for events older than 24 h.
- **Uses:**
  - Rolling out a fixed connector.
  - Tuning noise rules on real data: CI can run the dry run against a fixture corpus.
  - Answering "what would change if we drop `code.pushed`?" before changing the setting.
- **Record `connector_version` on both activities and inbound outcomes,** so a partial replay is visible.

### 4.6 P0: Bun SQL stores `jsonb` as strings

**Reproduction** [E]:

- Setup: drizzle-orm 0.45.4 with `drizzle-orm/bun-sql` on Bun 1.3.6 (the repo's versions), against a Postgres wire server (PGlite through pglite-socket).
- Inserting `{ repo: "acme/api", n: 1 }` into a `jsonb` column:
  - read back through Drizzle as the correct object;
  - server-side, `jsonb_typeof(data)` was `string` and `data->>'repo'` was `null`.
- The cause: Drizzle's `PgJsonb.mapToDriverValue` returns `JSON.stringify(value)`, and Bun encodes that string again.

**Status of the Bun bug** [P]:

- oven-sh/bun#28819 is **open**, with fix PR #40944 awaiting review.
- Reported on Bun 1.3.11 through 1.4.3, and on Postgres 16, 17 and 18.

**Impact on Worklog:**

- Production Postgres stores all 13 `jsonb` columns as strings.
- Nothing in `src` uses SQL-side jsonb operators yet, so today the bug is latent.
- It will bite the moment the inbox is queried by payload, a jsonb index is added, or analytics or another tool reads the tables.
- After Bun's fix lands, new rows will be objects and old rows strings, so the data becomes mixed.
- PGlite (in-process) tests can't catch it.

**Fixes:**

1. A Drizzle `customType` jsonb that hands the driver the object rather than a string on Bun SQL. Passing the object directly stored a real object [E, via the queue research]. Verify on PGlite too.
2. Or bind with `sql\`${JSON.stringify(v)}::text::jsonb\``.
3. Add a startup self-check that inserts a probe row and asserts `jsonb_typeof = 'object'`.
4. Add a CI job against a real Postgres.
5. Plan a one-off migration: `update t set col = (col #>> '{}')::jsonb where jsonb_typeof(col) = 'string'`.

### 4.7 Backfill, reconcile and missed webhooks

**GitHub** [P]

- "GitHub does not automatically redeliver failed deliveries". Failed deliveries can be redelivered within **3 days**:
  - for a repo or org hook: `GET /repos/{o}/{r}/hooks/{hook_id}/deliveries?status=failure`, then `POST …/deliveries/{id}/attempts`;
  - for an App: `GET /app/hook/deliveries` (needs a JWT).
- A redelivery keeps the original `X-GitHub-Delivery`.
- **Every 10–15 min,** the connector should list failed deliveries since its cursor and redeliver them. This is GitHub's own recommended pattern, and it needs API credentials on the connection (a GitHub App installation, or a fine-grained token), which the connection lacks today.
- **Daily, and on connect, reconcile with:**
  - `GET /repos/{o}/{r}/issues?state=all&sort=updated&since=…` (includes PRs)
  - `GET /repos/{o}/{r}/issues/comments?since=…&sort=updated`
  - `GET /repos/{o}/{r}/pulls?state=all&sort=updated&direction=desc`, paging until older (it has no `since`)

  These synthesize inbox rows with `via: "backfill"`. Semantic ids make overlap harmless.

- **Don't use the Events API for this:**
  - It is "not built to serve real-time use cases".
  - Latency is "30s to 6h", and it returns ≤ 300 events from ≤ 30 days.
  - Since 2025-10-07, PushEvent no longer carries commit summaries or counts, and PR payloads were trimmed.

**Slack**

- Retries cover short outages: 3 attempts over about 6 min.
- For longer outages, backfill opted-in channels with `conversations.history` and `conversations.replies` since the last seen `ts` per channel. That works with internal-app limits; non-Marketplace distributed apps are throttled to 1 request per minute (§3.8).

**Discord** [P]

- Guild messages arrive **only over the Gateway** (`GUILD_MESSAGES`, plus `MESSAGE_CONTENT` for text).
- HTTP "Webhook Events" (2024) cover app authorization, entitlements, lobby messages and game direct messages, but not guild messages.
- The current Discord connector is interactions-only, which is fine for the MVP. Ingesting Discord messages needs a `stream` capability: a long-lived gateway worker.
- Privileged-intent review now triggers at 10,000 users the app can reach, with annual reapplication [S].

**Checkpoints:** store per-connection, per-stream cursors (`connection_cursors`). Save them only **after** the page's rows commit (Airbyte STATE and Nango `saveCheckpoint` semantics [P]).

### 4.8 Per-connection health

**Expose `GET /v1/connections/{id}/health`, with hourly rollups:**

- `received`, `processed`, `ignored` (top reasons), `failed`, `dead`
- **`signature_failures`.** Today a bad signature returns 401 and leaves no trace. That is the most common setup error: a wrong secret.
- `last_event_at` (present), `last_success_at`, `consecutive_failures`
- Ingest lag p50/p95 (`received_at → processed_at`) and source lag (`occurred_at → received_at`)
- `unknown_actor_rate`, `bot_share` and `dropped_share` (a sudden jump means a connector or provider change)
- **Silence detector.** If a connection that normally sees N events per workday has had none for 4× its typical gap during working hours, raise attention for the connection owner. Silence is how GitHub and GitLab auto-disable failures show up: GitLab disables hooks temporarily after 4 consecutive failures and permanently after 40 [P].

### 4.9 Scale notes

- **Volume:** each delivery is two inserts (inbox and job) on the request path. Slack caps events at 30,000/h per workspace (about 8/s). A busy GitHub org bursts to tens per second. One Postgres handles that comfortably. Scale workers horizontally; SKIP LOCKED plus ordering keys allow parallelism across threads.
- **Hot rows:**
  - `resolveActor` updates `identities.event_count` on every event, which contends on high-volume bots (github-actions). Update the counter only when `last_seen_at` is more than 60 s old, or batch it.
  - Coalesced rows are serialized by the ordering key.
- **Back-pressure:** the inbox always accepts (it's cheap). Lag shows in health, and old jobs aren't dropped.
- **Edge limits:** cap body size before reading it fully, and rate-limit per connection (a token bucket) to blunt floods from a misconfigured sender.

---

## 5. Where the code stands

### 5.1 Baseline (synchronous mapping, as described in the brief)

| Area | What it does | Issue | Fix (section) |
| --- | --- | --- | --- |
| `api/hooks.ts` GitHub | verify, then `claimDelivery`, then `handleGithubEvent` inline | Work happens inside GitHub's 10 s budget. On failure the delivery is marked failed **and can never be reprocessed**: a redelivery is treated as a duplicate and nothing was stored | inbox and queue (§4.2) |
| `api/hooks.ts` Slack | `void handleSlackEvent(...)` | Lost on restart; a Slack retry is deduped away | jobs (§4.1) |
| `ingest/connectors/github.ts` ids | `pr:${ref}:${action}:${deliveryId}`, `review_requested:…:${deliveryId}` | Backfill and duplicate hooks can't dedupe; `ref` uses the renameable `full_name` | semantic ids (§2.4) |
| `occurredAt` | always `ctx.now()` | wrong for redelivery, backfill and replay | source timestamps (§2.4) |
| push | counts `commits.length`; titles "Pushed N commits to main" | double counts merges, rebases and non-distinct commits; duplicates `pr.merged`; bot pushes included | §3.5 |
| bots | GitHub: none. Slack: `bot_id` check | dependabot and renovate flood the feed | §3.3 |
| identity | `memberByIdentity` by lowercase login | renames break links; a reused login misattributes | §3.9 |
| mentions | regex over the raw body | fires on code blocks and quotes | §3.11 |
| Slack subtypes | all dropped | edits never update; **deletes never propagate** | S4 (§3.8) |
| signature failures | 401, not recorded | invisible misconfiguration | §4.8 |

### 5.2 In progress (snapshot 12:15): right direction, specific gaps

**Already right:**

- `inbound_events` as the inbox.
- `jobs` with SKIP LOCKED.
- A pure `normalize`.
- `WorklogEvent` v1 carries signals, board effects, coalescing and agent fields.
- `identities` records unknown actors and re-attributes history on link.
- `gate()` has a bot policy.
- `activities` gained `thread_key`, `coalesce_key`, `importance`, `actor_identity_id` and `inbound_event_id`.

**Gaps to close before freezing v1:**

1. **Identity defect in `resolveActor`.** When no candidate has the incoming stable id, it "upgrades" whichever candidate matched by handle (`candidates[0]`), even if that candidate already has a different stable id. After a GitHub rename, someone else can claim the old login [P], and their activity is then attributed to the original member, whose identity is re-keyed.
   - **Fix:** upgrade only rows whose `external_id` starts with `handle:`. Otherwise insert a new identity and flag the conflict (I8).
2. **Queue:** no `ordering_key` or `dedupe_key`; `settle()` isn't fenced by attempt; no jitter (§4.3).
3. **Inbox:** stores only parsed `payload` jsonb, with no raw bytes, headers, `body_sha256`, `partition_key`, `via` or `connector_version`. It is also exposed to §4.6.
4. **Event type:** add `op`/`revision` (edits and deletes), `target`, `thread.parent`, `correlationKey`, `links`, `mentions`, `quality`, `source`, `raw`, actor `ns`/`kind`/`email`, object `state`/`author` and `attrs`, plus `maxSpanMinutes` on `coalesce`.
5. **`gate()`:** add drafts, forced or non-distinct pushes, push-vs-merge supersede, Slack trivial messages, ignored branches, and the agent-is-not-noise rule (B9).
6. **`Connector` interface:** add the manifest fields, `verify` as a reusable spec, `partitionKey`, and the optional `subscribe`, `backfill`, `stream`, `deliver` and `test` (§6.2).

---

## 6. Connector extensibility

### 6.1 How other platforms define connectors

| Platform | Definition | Auth / verification | Triggers / webhooks | Dedupe / state | Distribution and trust |
| --- | --- | --- | --- | --- | --- |
| **Airbyte** [P] | Mostly a **declarative YAML manifest**, built in the Connector Builder. The Python CDK is for what the Builder can't do. The manifest has `streams`, `retriever` (`requester`, `record_selector` with `DpathExtractor`, `paginator`), `incremental_sync` (`DatetimeBasedCursor` with `cursor_field`, `lookback_window`) and Jinja interpolation (`config`, `stream_interval`, `response`). | `ApiKeyAuthenticator`, `BearerAuthenticator`, `OAuthAuthenticator`, `JwtAuthenticator`, … | Pull only: `spec`/`check`/`discover`/`read`, emitting RECORD and STATE messages. | STATE is opaque and handed back only after the destination commits. | `metadata.yaml` (`dockerImageTag`, `supportLevel`, **`allowedHosts`**, `releases.breakingChanges` with `upgradeDeadline`) generates registry JSON. Support levels: Airbyte, Enterprise, Marketplace, Custom. Contribution is via PR. |
| **Nango** [P] | TypeScript functions: `createSync`, `createAction`, `createOnEvent`. Models are zod. `nango.yaml` was retired (2026-09-15). | Platform-managed OAuth and API keys. | `webhookSubscriptions` plus `onWebhook(nango, payload)`, which should be "short, idempotent, and resilient to duplicates or out-of-order delivery". Nango verifies provider signatures before forwarding and **never forwards an invalid signature**; "allow unverified" is for unsigned providers only. | `getCheckpoint`/`saveCheckpoint` after `batchSave`; `trackDeletesStart`/`End`. | `nango dryrun`, recorded mocks. |
| **Pipedream** [P] | A JS component object: `key`, `version`, `props`, `hooks` (`activate`/`deactivate`/`deploy`), `run`, `dedupe`. | App props with `$auth`. | `$.interface.http` (raw body available); create the hook in `activate()`, store its id in `$.service.db`. "Always validate the incoming event signature." | `$emit(event, {id, summary, ts})` with **`dedupe: unique | greatest | last`**. | PRs to a monorepo; semver per component; a scrubbed `test-event.mjs`. |
| **n8n** [P] | `INodeType` + `INodeTypeDescription`; **declarative** nodes (`requestDefaults`, `routing`) or programmatic nodes (`execute`). | `ICredentialType` with `authenticate` and a **`test`** request. | `webhookMethods.default.{checkExists, create, delete}`; a per-hook secret from `randomBytes(32)`; `webhook()` verifies, then returns `workflowData`. | `getWorkflowStaticData('node')` for cursors. | npm `n8n-nodes-*` with keyword `n8n-community-node-package`. **Verified** nodes must have no runtime deps, no env or fs access, provenance publishing from GitHub Actions (since 2026-05-01) and a scanner pass. Community nodes "have full access to the machine". |
| **Backstage** [P] | `createBackendPlugin` / `createBackendModule`, extension points, `EntityProvider.connect()` → `applyMutation({type:'full' | 'delta'})`. | Core services. | Providers push deltas. | `locationKey` resolves conflicts between providers. | npm plus a YAML directory entry; no code review. |
| **Zapier** [P] | `triggers`, `searches`, `creates`, `authentication` (with a required `test`); CLI or Platform UI. | `basic`, `oauth2`, `session`, … | REST hooks: `performSubscribe`, `performUnsubscribe`, `perform`, `performList` (samples). | Polling dedupes on `id`, or `primary` output fields. **Changing the key makes old records fire again.** | Private → review (about 1 week) → 90-day Beta → Public. |
| **Hookdeck / Svix / Segment / RudderStack** [P] | JS transforms. | Hookdeck HMAC presets per provider. | — | Hookdeck dedupe is "best-effort", up to 1 h. | Sandboxes: Hookdeck V8 isolate (1 s, 128 MB, no network); Svix **QuickJS** with memory limit and interrupt timeout; Segment 5 s; RudderStack 4 s, 128 MB. |

**Lessons**

1. Keep a static manifest separate from optional code.
2. Make the subscribe lifecycle explicit and idempotent.
3. Verify before parsing, declaratively, and never accept an invalid signature.
4. Every event needs a stable dedupe key, and changing the key is a breaking change.
5. Checkpoint state only after commit.
6. Build the no-code mapper on a non-Turing-complete core.
7. Every connector ships fixtures and expected snapshots.
8. Use trust tiers plus provenance; real sandboxing is rare except for transforms.

### 6.2 Layer (a): the typed TypeScript connector

This extends the in-progress `Connector` in `src/ingest/types.ts`. It keeps `receive` and `normalize` and adds a manifest and optional capabilities.

```ts
import type { z } from "zod";

export type VerifySpec =
  | {
      scheme: "hmac";
      header: string;
      algorithm: "sha256" | "sha1";
      encoding: "hex" | "base64";
      prefix?: string;
      /** What is signed: the raw body, or a template over headers/body, e.g. "{h:x-slack-request-timestamp}:{body}". */
      signed?: string;
      timestamp?: {
        header: string;
        toleranceSeconds: number;
        unit?: "s" | "ms";
      };
    }
  | { scheme: "standard-webhooks"; toleranceSeconds?: number } // webhook-id / -timestamp / -signature (v1, v1a)
  | { scheme: "token"; header: string } // GitLab X-Gitlab-Token, Gitea Authorization
  | { scheme: "ed25519"; signatureHeader: string; timestampHeader: string } // Discord
  | { scheme: "stripe"; header: string; toleranceSeconds: number } // t=…,v1=…
  | { scheme: "none" }; // admin opt-in, flagged "unverified"

export type ConnectorManifest<C extends z.ZodType, S extends z.ZodType> = {
  id: string; // "github", "gitea", "gitlab", "slack", "webhook"
  version: string; // semver of the mapping; recorded on activities and inbox rows
  name: string;
  description: string;
  tier: "core" | "verified" | "community";
  config: C; // non-secret settings → JSON Schema for UIs
  secrets: S; // sealed at rest; never passed to mapping expressions
  verify: VerifySpec | VerifySpec[]; // several presets (e.g. GitLab token OR standard-webhooks during migration)
  capabilities: {
    webhook?: true;
    backfill?: true;
    stream?: true;
    subscribe?: true;
    commands?: true;
    deliver?: true;
  };
  allowedHosts?: string[]; // egress allowlist for io.fetch; may reference config ("${config.baseUrl}")
  emits: Record<string, { description: string; fixtures: string[] }>; // kind catalog → AsyncAPI export
  identityNamespace(conn: ConnView<z.infer<C>>): string;
};

export type Connector<
  C extends z.ZodType = z.ZodType,
  S extends z.ZodType = z.ZodType,
> = ConnectorManifest<C, S> & {
  /** Edge (in the HTTP request): classify an already-verified delivery. Fast, no DB, no network. */
  receive(req: InboundRequest, conn: ConnView<z.infer<C>>): Received;
  /** Edge: ordering key for the queue (thread), from a cheap look at the payload. */
  partitionKey?(eventType: string, payload: unknown): string | null;
  /** Worker: pure translation. No DB, no network, no clock: use receivedAt. Deterministic ids. */
  normalize(
    input: { eventType: string; payload: unknown; receivedAt: Date },
    conn: ConnView<z.infer<C>>
  ): Normalized;

  /** Optional capabilities. All network goes through io.fetch (allowedHosts, timeouts, rate limits, retries). */
  test?(
    conn: ConnView<z.infer<C>>,
    io: ConnectorIO
  ): Promise<{ ok: boolean; message?: string }>;
  subscribe?(
    conn: ConnView<z.infer<C>>,
    io: ConnectorIO,
    webhookUrl: string
  ): Promise<{ hookId: string; secret?: string }>;
  unsubscribe?(
    conn: ConnView<z.infer<C>>,
    io: ConnectorIO,
    hookId: string
  ): Promise<void>;
  /** Pull missed or historical events as raw inbox items; yield checkpoints, which are saved after commit. */
  backfill?(
    conn: ConnView<z.infer<C>>,
    io: ConnectorIO,
    cursor: unknown
  ): AsyncIterable<
    | { item: { deliveryId?: string; eventType: string; payload: unknown } }
    | { checkpoint: unknown }
  >;
  /** Long-lived sources (Discord gateway, Slack Socket Mode): push raw items until aborted. */
  stream?(
    conn: ConnView<z.infer<C>>,
    io: ConnectorIO,
    emit: (raw: {
      deliveryId: string;
      eventType: string;
      payload: unknown;
    }) => Promise<void>,
    signal: AbortSignal
  ): Promise<void>;
  /** Slash commands and interactions: synchronous reply (≤ 3 s), deferring slow work to jobs. */
  interact?(
    ctx: CommandContext,
    conn: ConnView<z.infer<C>>,
    payload: unknown,
    channel: string
  ): Promise<unknown>;
  /** Outbound: post a brief or ping into the tool (Slack chat.postMessage, Discord channel). */
  deliver?(
    conn: ConnView<z.infer<C>>,
    io: ConnectorIO,
    target: string,
    msg: OutboundMessage
  ): Promise<{ externalId?: string }>;
  /** Identity enrichment, e.g. Slack users.info → verified email (feeds link suggestions). */
  enrichActor?(
    conn: ConnView<z.infer<C>>,
    io: ConnectorIO,
    actor: ActorRef
  ): Promise<Partial<ActorRef>>;
};

export type ConnectorIO = {
  fetch(url: string, init?: RequestInit): Promise<Response>; // enforces allowedHosts, 10 s timeout, 429 back-off
  kv: {
    get<T>(k: string): Promise<T | null>;
    set(k: string, v: unknown): Promise<void>;
  }; // hook ids, cursors
  log: (msg: string, data?: Record<string, unknown>) => void;
  now(): Date;
};
```

**Conformance suite.** A shared `bun test` helper that every connector runs:

- Each `emits[kind].fixtures` file (a recorded payload with headers) normalizes to its snapshot.
- Normalizing the same input twice gives identical ids, so ids are deterministic.
- `normalize` makes no network calls: run it with `fetch` stubbed to throw.
- Every event has `id`, `kind`, `occurredAt`, `object.key` and `source`.
- Every `kind` is in `emits`.
- Bodies are within caps.
- `verify` rejects a tampered body, a wrong secret and a stale timestamp.
- `receive` stays under a time budget, for example 5 ms on fixtures.

### 6.3 Layer (b): a declarative mapping connector for any webhook

A **manifest is data**. One built-in connector (`webhook`) interprets it. It can be created and edited through the API, with a live preview: paste a sample payload and see the normalized events, much like Airbyte's Builder, Zapier's `performList` and Pipedream's test events.

```yaml
id: sentry-issues
version: 1.0.0
name: Sentry issues
verify:
  scheme: hmac
  header: Sentry-Hook-Signature
  algorithm: sha256
  encoding: hex
  # Sentry's docs sign re-serialized JSON, not the raw body [P]; a code connector may be needed if raw verification fails.
delivery:
  id: header("request-id") # fallback: sha256(body)
  eventType: header("sentry-hook-resource") + "." + body.action
identity: per-connection # namespace webhook:<connectionId>; cannot claim github/slack identities
routes:
  - when: eventType == "issue.created" # CEL
    emit:
      kind: incident.opened
      id: '"sentry:issue/" + string(body.data.issue.id) + "/created"'
      occurredAt: body.data.issue.firstSeen
      actor: null
      object:
        {
          type: incident,
          key: '"sentry:issue/" + string(body.data.issue.id)',
          title: $.data.issue.title,
          url: $.data.issue.web_url,
        }
      container:
        {
          type: project,
          key: '"sentry:project/" + body.data.issue.project.slug',
          name: $.data.issue.project.name,
        }
      thread: '"sentry:issue/" + string(body.data.issue.id)'
      title: "New Sentry issue in {{ data.issue.project.name }}: {{ data.issue.title }}"
      importance: 0.7
  - when: eventType == "issue.resolved"
    emit:
      {
        kind: incident.resolved,
        id: '"sentry:issue/" + string(body.data.issue.id) + "/resolved"',
        ...,
      }
  - otherwise: { ignore: "unmapped event type" }
```

**Expression language: CEL, plus paths, plus logic-less templates.**

- **CEL for `when` and computed values** [P]: "non-Turing complete", "cannot loop forever", and type-checkable before running.
  - Kubernetes enforces a cost budget at admission time.
  - JS options:
    - `@marcbachmann/cel-js` 8.0.0: MIT, no dependencies, about 227 KB, with `env.check()` and parse limits `maxAstNodes`, `maxDepth` and `maxListElements`.
    - `@bufbuild/cel` 0.6.1: beta, uses RE2.
- **Plain field selection** uses RFC 9535 JSONPath (`$.data.issue.title`) or JSON Pointer [P]. Use `jsonpath-rfc9535`, which has no dependencies. Avoid `jsonpath-plus`, which had a CVSS 9.8 RCE, CVE-2024-21534 [S].
- **Titles** use `{{ path }}` substitution only: no helpers, no logic, output escaped. Handlebars' own docs warn that relaxing prototype rules allows code execution [P]. LiquidJS limits are cooperative, and a `renderLimit` bypass was fixed in 10.26 [S].
- **JSONata** is acceptable only as a later opt-in, under these conditions:
  - version ≥ 2.2.1, which has guardrails `timeout` (D1012), `stack` and `sequence` [P];
  - `$eval` removed, as AWS Step Functions does (AWS also applies a 1 s timeout) [P];
  - run in a worker that can be killed hard.
- **JS transforms** would need a real sandbox: QuickJS-WASM as Svix uses, or a V8 isolate as Hookdeck uses. `isolated-vm` likely doesn't run on Bun [U]. Leave them out of v1.

**Security**

| Risk | Control |
| --- | --- |
| Forged deliveries | Verify **raw bytes** before parsing, with a constant-time compare (`safeEqual` exists). Require a secret. `scheme: none` needs an admin opt-in, is labeled "unverified" in the UI, is rate limited, and can be IP-allowlisted. **Never** accept an invalid signature (Nango's rule). |
| Replay | Enforce the timestamp tolerance where the scheme has one (Standard Webhooks and Slack ±5 min, Linear ≤ 60 s recommended [P]). Always dedupe on the delivery id. |
| Impersonation | A per-connection identity namespace. A mapper can't set an actor in `github` or `slack:*`, and can't set `visibility` above what the connection allows. |
| Secret exfiltration | Secrets are never bound into expressions or templates. Mappers have no `fetch`. Enrichment is only for code connectors with `allowedHosts`. |
| CPU or memory DoS | Body ≤ 1 MB; AST ≤ 500 nodes, depth ≤ 32, checked at save time; ≤ 20 events per delivery; a 50 ms evaluation budget per delivery in the worker, not the request; output caps (title 200 chars, body 4,000). |
| ReDoS | Regex only through RE2-semantics engines, or cap input length to 10 KB for `matches()`. |
| Prototype pollution | Parse with `JSON.parse` only. Never deep-merge untrusted objects or use path setters on them. Reject keys `__proto__`, `constructor` and `prototype` in emitted objects. |
| Phishing or unsafe links | URLs must be `http(s)`, optionally restricted to declared hosts. This is consistent with the existing outbound sanitizer, which keeps only links present in the source data. |
| Prompt injection downstream | All mapped text is untrusted data, the same as other connectors. The assistant already marks it. |

### 6.4 Plugins and registry in an open-source product

- **Built-in connectors** live in the repo: GitHub, Gitea/Forgejo, GitLab, Slack, Discord, generic webhook.
- **Code connectors are npm packages.**
  - Naming: `worklog-connector-<id>` or `@scope/worklog-connector-<id>`, with keyword `worklog-connector`, and `export default` a `Connector`.
  - **Only operators install them.** The server loads them from `WORKLOG_CONNECTORS=` or `worklog.config.ts` at boot. Code runs in-process with full privileges, so the trust decision belongs to the operator.
  - At load, the server validates the manifest and runs the connector's fixtures. It refuses to load on failure.
- **Declarative manifests are data.**
  - Stored per workspace (`connector_manifests`) and installable by workspace admins through the API.
  - They can come from a pasted manifest or a registry entry pinned by `sha256`.
- **The registry is a Git repo:** `connectors/<id>/manifest.yaml` (or a `package.json` pointer for code), `fixtures/`, `README.md`.
  - CI runs the conformance suite and publishes `registry.json`, the same flow as Airbyte's metadata → registry JSON.
  - **Tiers:**
    - **core:** maintained by the project.
    - **verified:** passes conformance, no runtime dependencies (n8n's rule), published with npm provenance from CI, and has a named maintaining organization.
    - **community:** passes conformance only.
  - **Quality checklist,** machine-checked (like Home Assistant's `quality_scale.yaml`): has fixtures, verifies signatures, declares `allowedHosts`, has `backfill`, has docs.
- **Versioning:** semver per connector.
  - Changing an id template or `kind` names is **breaking**: old records would re-emit (Zapier's lesson).
  - Declare breaking changes with `breakingChanges: [{version, message, upgradeDeadline}]` (Airbyte), and ship them with a replay plan.

---

## 7. Self-hosted forges and common webhook schemes

### 7.1 Forges

|  | GitLab | Gitea (v28.2) | Forgejo (v17) / Codeberg | Gogs |
| --- | --- | --- | --- | --- |
| Event header | `X-Gitlab-Event: "Merge Request Hook"` etc.; payload `object_kind` | `X-Gitea-Event` (coarse), `X-Gitea-Event-Type` (precise); **also** `X-GitHub-Event`, `X-GitHub-Event-Type`, `X-GitHub-Delivery`, `X-Gogs-*` | `X-Forgejo-Event`/`-Event-Type`/`-Delivery`, plus the same `X-Gitea-*`, `X-Gogs-*`, `X-GitHub-*` | `X-Gogs-Event`, `X-Github-Event` |
| Auth | `X-Gitlab-Token`: plain shared token ("weaker"). **19.0+: Standard Webhooks** `webhook-signature: v1,<b64>` over `{webhook-id}.{webhook-timestamp}.{body}`, `whsec_` key; GA in 19.1 [P] | `X-Gitea-Signature`: hex HMAC-SHA256, no prefix; **and** `X-Hub-Signature-256: sha256=<hex>`; empty digest when no secret is set; optional `Authorization` header [P] | `X-Forgejo-Signature` (hex) plus the `X-Hub-Signature-256` set; `Authorization` stored encrypted [P] | `X-Gogs-Signature` (hex); no `X-Hub-*` [P] |
| Delivery id | `webhook-id` = `Idempotency-Key` (17.4+), `X-Gitlab-Event-UUID`, `X-Gitlab-Webhook-UUID` | `X-Gitea-Delivery` | `X-Forgejo-Delivery` | `X-Gogs-Delivery` |
| Timeout / retry | 10 s (GitLab.com). Temporarily disabled after 4 consecutive failures (1 min, growing to 24 h); permanently after 40 [P]. No documented auto-retry; manual resend keeps the key. | 5 s; **no automatic retry**; manual redelivery [P] | same as Gitea | 15 s |
| Push commits in payload | newest **20**, `total_commits_count`; no hooks if > 3 branches or tags pushed at once | **5** (`FeedMaxCommitNum`), `total_commits`; no `created`/`deleted`/`forced` | **15** (`PAYLOAD_COMMIT_LIMIT`) | — |
| PR / MR | `object_attributes.action`: `open`, `close`, `reopen`, `update`, `approval`, `approved`, `unapproval`, `unapproved`, `merge`; `draft` boolean; reviews (19.3) arrive as `update` with `changes.reviewers` state | GitHub-like `pull_request` with `merged`, `draft` (from WIP title), `html_url`. Actions `synchronized`, `label_updated`, `reviewed`, … Reviews are separate event types `pull_request_review_{approved,rejected,comment}`, delivered as `action:"reviewed"` with `review:{type, content}`; **no review id or URL** | same; no `status` event; CI as `action_run_*` and `workflow_*_<status>` with `run`/`job` keys | no reviews or drafts |
| Users | `user{id, username, name, email:"[REDACTED]"}`; push uses flat `user_id`, `user_username` | `login` plus a `username` alias, numeric `id`; email always a noreply placeholder | same; no user `type` | `login` and `username` |

**Can they share the GitHub mapper?**

- **Gitea and Forgejo: yes, through an adapter** that rewrites deliveries into GitHub's shape before the shared mapper runs:
  - Route on `X-Gitea-Event-Type`, not `X-GitHub-Event`, which carries `pull_request_approved`/`rejected`/`comment`.
  - Turn `reviewed` plus `review.type` into `pull_request_review` / `submitted` / `state`, and synthesize a review id from the delivery id.
  - Map `synchronized` → `synchronize` and `label_updated` → `labeled`.
  - Derive `created`/`deleted` from all-zero SHAs.
  - Take counts from `total_commits`.
  - Treat `pull_request.url` as the HTML URL.
  - Use namespace `gitea:<host>`.
  - Reject empty-digest signatures.
- **Gogs:** partly; it has a small event set and no reviews.
- **GitLab and Bitbucket: no.** They need their own mappers. Only the verification presets can be shared.

### 7.2 Signature presets for the declarative connector

| Preset | Header(s) | Algorithm / encoding | Signed content | Replay protection |
| --- | --- | --- | --- | --- |
| GitHub / Gitea / Forgejo / Bitbucket / Jira admin hooks | `X-Hub-Signature-256: sha256=` (Bitbucket and Jira: `X-Hub-Signature: sha256=`) | HMAC-SHA256, hex | raw body | none; dedupe on delivery id |
| Gitea / Forgejo / Gogs native | `X-Gitea-Signature` / `X-Forgejo-Signature` / `X-Gogs-Signature` | HMAC-SHA256, hex, no prefix | raw body | none |
| GitLab ≤ 18 | `X-Gitlab-Token` | shared token, constant-time compare | — | none |
| Standard Webhooks (GitLab ≥ 19, Svix, many SaaS) | `webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<b64>` (space list; `v1a` = ed25519) | HMAC-SHA256, base64; key = base64-decode after `whsec_` | `id.timestamp.body` | ±5 min |
| Slack | `X-Slack-Signature: v0=`, `X-Slack-Request-Timestamp` | HMAC-SHA256, hex | `v0:{ts}:{body}` | ±5 min (present in code) |
| Linear | `Linear-Signature`; also `Linear-Delivery`, `Linear-Event` | HMAC-SHA256, hex | raw body | body `webhookTimestamp` (ms), ≤ 60 s recommended |
| Sentry | `Sentry-Hook-Signature`; also `Sentry-Hook-Resource`, `Sentry-Hook-Timestamp` | HMAC-SHA256, hex | docs sign re-serialized JSON [P] | none documented |
| Stripe-style | `Stripe-Signature: t=…,v1=…` | HMAC-SHA256, hex | `{t}.{body}` | 5 min (libraries) |
| PagerDuty v3 | `X-PagerDuty-Signature: v1=<hex>[,v1=…]` | HMAC-SHA256, hex | raw body | none |
| Shopify | `X-Shopify-Hmac-SHA256`; dedupe on `X-Shopify-Webhook-Id` | HMAC-SHA256, **base64** | raw body | none |
| Discord | `X-Signature-Ed25519`, `X-Signature-Timestamp` | Ed25519, hex | `{timestamp}{body}` | present in code |

Generalize `verifyGithub` into `verifyHmac({header, prefix, encoding, signed})`. One hex-with-optional-prefix verifier then covers GitHub, Gitea, Forgejo, Gogs, Bitbucket, Jira, Linear and PagerDuty.

---

## 8. Prioritized recommendations

| # | Change | Why | Effort |
| --- | --- | --- | --- |
| 1 | **Fix the Bun SQL jsonb encoding** with a custom jsonb type or a `::text::jsonb` bind, plus a startup self-check, a real-Postgres CI job and a one-off migration (§4.6) | Silent production-only data corruption across 13 columns | **S** |
| 2 | **Finish raw-first ingestion.** Store raw body, allowlisted headers, sha256, partition key, `via` and connector version. Enqueue in the same transaction and ack in milliseconds. Re-enqueue `failed` duplicates. Move Slack's `void` paths to jobs (§4.1–4.2) | Fixes the permanently failed deliveries in the baseline; enables replay and audit | **M** (partly done) |
| 3 | **Queue hardening:** `ordering_key` FIFO claim, `dedupe_key`, attempt fencing, jitter, heartbeat (§4.3) | Correctness under parallel workers; raise/resolve order | **S** |
| 4 | **Semantic ids and source timestamps** across all connectors; rename-safe keys from repo ids; card key migration (§2.4) | Dedupe across webhook, redelivery, backfill, replay and duplicate hooks | **S–M** |
| 5 | **Identity:** fix the placeholder-upgrade defect; per-instance namespaces; rename handling; suggestions queue; email from Slack `users.info` (§3.9, §5.2) | Wrong attribution is the most damaging bad data | **M** |
| 6 | **Bot / automation / agent detection** B1–B9 and the quiet policy (§3.3) | The largest noise source on GitHub | **S** |
| 7 | **Push rules P1–P10 and the merge supersede**, draft rules, review-comment folding (§3.4–3.6) | Removes duplicate and empty items | **M** |
| 8 | **Slack:** trivial filter, thread roll-up, edits and deletes (tombstones), private-channel restriction (§3.8) | Signal quality and privacy (deletes never propagate today) | **M** |
| 9 | **Connection health,** including signature failures and the silence detector (§4.8) | Misconfiguration and auto-disabled hooks become visible | **S–M** |
| 10 | **Replay with a dry-run diff** (§4.5) | Safe connector fixes; tune noise rules on real data | **M** |
| 11 | **GitHub reconcile:** failed-delivery redelivery sweep plus `issues?since` backfill; needs App or token credentials (§4.7) | GitHub never retries | **M** |
| 12 | **Connector manifest, conformance suite and `VerifySpec` presets** (§6.2) | The foundation for community connectors | **M** |
| 13 | **Gitea/Forgejo adapter** on the GitHub mapper (§7.1) | Self-hosted forges at low cost | **M** |
| 14 | **GitLab mapper,** token and Standard Webhooks (§7.1) | The most-requested self-hosted forge [U] | **M–L** |
| 15 | **Declarative webhook connector** (CEL, paths, templates, presets, preview UI) (§6.3) | "Any tool that sends webhooks" | **L** |
| 16 | **CloudEvents ingest and export** (`POST /v1/events`, SSE and outbound in CloudEvents; outbound signed with Standard Webhooks) (§2.1) | Interop with agents, CI and other tools | **S–M** |
| 17 | **Registry repo and tiers** (§6.4) | Open-source ecosystem | **M** |
| 18 | **Discord gateway `stream`** (only if Discord messages are in scope) (§4.7) | HTTP can't deliver guild messages | **M–L** |
| 19 | **Inbox retention** and later partitioning (§4.2) | Privacy and table size | **S** |

**Suggested order:**

- **Week 1:** 1, 3, 6, then 2.
- **Week 2:** 4, 5.
- **Week 3:** 7, 8, 9.
- **Then:** 10, 11, 12, 13. After that, 14–19 by demand.

### 8.1 Data-model changes (Drizzle, illustrative only; not applied)

```ts
// inbound_events — additions
rawBody: text("raw_body"),                                  // exact bytes as received; nulled after retention
headers: jsonb("headers").$type<Record<string, string>>(),  // allowlisted only
bodySha256: text("body_sha256").notNull(),
partitionKey: text("partition_key"),
via: text("via", { enum: ["webhook", "redelivery", "backfill", "stream", "api", "replay"] }).notNull().default("webhook"),
connectorVersion: text("connector_version"),
occurredAt: ts("occurred_at"),
// status enum: + "dead"; index (status, received_at) for health/retry scans

// jobs — additions
queue: text("queue").notNull().default("default"),
dedupeKey: text("dedupe_key"),
orderingKey: text("ordering_key"),
priority: smallint("priority").notNull().default(0),
lockedBy: text("locked_by"),
// partial unique indexes: (queue, dedupe_key) where status in (queued, running); (ordering_key) where status = running

// activities — additions
schemaVersion: smallint("schema_version").notNull().default(1),
objectKey: text("object_key"),                // index (workspace_id, object_key)
containerKey: text("container_key"),
parentKey: text("parent_key"),
correlationKey: text("correlation_key"),      // unique partial (workspace_id, correlation_key) where suppressed_by is null
precedence: smallint("precedence").notNull().default(0),
suppressedBy: text("suppressed_by"),
revision: text("revision"),                   // last-writer-wins
deletedAt: ts("deleted_at"),                  // tombstone (body/title cleared)
quality: jsonb("quality").$type<{ bot?: boolean; automated?: boolean; draft?: boolean; forced?: boolean; trivial?: boolean }>(),
connectorVersion: text("connector_version"),
// visibility enum: + "restricted"; source column = provider namespace (github, gitea:host), not connection id

// identities — additions
kind: text("kind", { enum: ["user", "bot", "app", "agent", "unknown"] }).notNull().default("user"),
botSource: text("bot_source", { enum: ["provider", "known_list", "heuristic", "manual"] }),
email: text("email"),                         // provider-verified only; never returned to non-admins
previousHandles: text("previous_handles").array().notNull().default(sql`'{}'::text[]`),
linkMethod: text("link_method", { enum: ["signin", "verified_email", "noreply_email", "manual", "suggestion"] }),
ignoredAt: ts("ignored_at"),                  // "not a person / ignore"

// new tables
identityLinkSuggestions = pgTable("identity_link_suggestions", {
  id, workspaceId, identityId, memberId,
  method: text("method"),                     // email | name | login | noreply
  confidence: real("confidence").notNull(),
  status: text("status", { enum: ["pending", "accepted", "rejected"] }).notNull().default("pending"),
  createdAt, decidedAt, decidedById,
}, (t) => [uniqueIndex("ils_pair_uq").on(t.identityId, t.memberId)]);   // rejections remembered

connectionCursors = pgTable("connection_cursors", {
  connectionId, stream: text("stream").notNull(), cursor: jsonb("cursor"), updatedAt,
}, (t) => [primaryKey({ columns: [t.connectionId, t.stream] })]);

connectionHealthHourly = pgTable("connection_health_hourly", {
  connectionId, hour: ts("hour").notNull(),
  received: integer, processed: integer, ignored: integer, failed: integer, dead: integer,
  signatureFailures: integer, unknownActors: integer, botEvents: integer,
  lagP95Ms: integer, sourceLagP95Ms: integer,
}, (t) => [primaryKey({ columns: [t.connectionId, t.hour] })]);

connectorManifests = pgTable("connector_manifests", {
  id, workspaceId /* null = instance-wide */, connectorId: text("connector_id").notNull(),
  version: text("version").notNull(), manifest: jsonb("manifest").notNull(), sha256: text("sha256").notNull(),
  status: text("status", { enum: ["draft", "active", "disabled"] }).notNull().default("draft"),
  createdById, createdAt,
});

// connections — additions
connectorVersion: text("connector_version"),
consecutiveFailures: integer("consecutive_failures").notNull().default(0),
lastSuccessAt: ts("last_success_at"),
// settings gains: quality { bots, ignoreKinds, ignoreBranches, ackLexicon, trivialMinChars }, apiCredentials (sealed in secrets)
```

---

## 9. Open questions for the team

1. **Draft visibility.** Should a teammate's draft PR show in _their_ `now` snapshot when a colleague asks, or only to the author? The proposal is yes, with the draft clearly labeled.
2. **Private Slack channels.** Should they be opt-in with `restricted` visibility, or not supported at all in v1? Restricted needs channel-membership checks (`conversations.members`).
3. **Hosted vs self-hosted Slack.** A hosted multi-tenant Worklog needs a Marketplace listing for usable history backfill (§3.8), and must follow the API Terms on retention.
4. **GitHub credentials.** Is a GitHub App the default (installation tokens, App-level failed-delivery API), or a webhook secret plus an optional token?
5. **Dead jobs.** Should a dead event block later events in its thread (pg-boss style), or not (the proposal)?
6. **Retention defaults** for raw payloads (30 days Slack, 90 days forges?), and whether workspace admins can shorten them.

## 10. Unverified or weakly sourced claims

- GitHub org and repo webhooks both delivering the same event with different delivery ids [U]. Plausible, not tested.
- GitHub not guaranteeing delivery order [U]. The design doesn't depend on it.
- Whether GitHub notifies requested reviewers on draft PRs [U].
- The arrival order of `pull_request_review` vs `pull_request_review_comment` [U].
- GitLab bot users' payload shape (project and group access-token bots) [U].
- Discord privileged-intent threshold of 10,000 users and annual reapplication [S]. From the support article plus a community summary; no exact effective date found.
- `isolated-vm` not working on Bun [U].
- CDEvents equivalents for deploy and CI events [U]. Not checked against v0.5.1.
- The legal reading of Slack's API Terms for in-product inference [U]. Get counsel's review.
- Jellyfish identity-resolution behavior [U]. Docs need a login.
- Slack Socket Mode as a NAT-friendly option for self-hosters [U]. Not re-checked this session.

## 11. Sources

**Standards**

- CloudEvents spec (main and v1.0.2): https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md · https://raw.githubusercontent.com/cloudevents/spec/ce@v1.0.2/cloudevents/spec.md
- CloudEvents JSON format: https://github.com/cloudevents/spec/blob/main/cloudevents/formats/json-format.md
- CloudEvents extensions: https://github.com/cloudevents/spec/tree/main/cloudevents/extensions (README, dataref, partitioning, sequence, recordedtime, authcontext, correlation, data-classification, distributed-tracing)
- CloudEvents releases: https://github.com/cloudevents/spec/releases · CESQL: https://cloudevents.io/blog/2024-07-15/
- xRegistry: https://github.com/xregistry/spec/blob/main/docs/RELEASES.md
- Activity Streams 2.0 Vocabulary: https://www.w3.org/TR/activitystreams-vocabulary/ · Social WG: https://www.w3.org/groups/wg/social
- FEP-7888: https://codeberg.org/fediverse/fep/raw/branch/main/fep/7888/fep-7888.md · FEP-f228: https://codeberg.org/fediverse/fep/raw/branch/main/fep/f228/fep-f228.md · FEP-171b: https://codeberg.org/fediverse/fep/raw/branch/main/fep/171b/fep-171b.md
- ForgeFed: https://forgefed.org/spec/ · Forgejo FAQ: https://forgejo.org/faq/
- CDEvents v0.5.1: https://github.com/cdevents/spec/blob/v0.5.1/spec.md · source-code-version-control.md · continuous-operations.md · links.md · cloudevents-binding.md · releases: https://github.com/cdevents/spec/releases
- OpenTelemetry VCS attributes: https://github.com/open-telemetry/semantic-conventions/blob/main/docs/registry/attributes/vcs.md · CICD: …/attributes/cicd.md · events: https://github.com/open-telemetry/semantic-conventions/blob/main/docs/general/events.md · span-events deprecation: https://opentelemetry.io/blog/2026/deprecating-span-events/
- Standard Webhooks spec: https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md · JS reference: https://github.com/standard-webhooks/standard-webhooks/blob/main/libraries/javascript/src/index.ts · https://www.standardwebhooks.com/
- AsyncAPI 3.1.0: https://github.com/asyncapi/spec/releases/tag/v3.1.0 · JSON Schema: https://json-schema.org/specification · schema.org Action: https://schema.org/Action · OCSF: https://github.com/ocsf/ocsf-schema/releases · xAPI [S]: https://en.wikipedia.org/wiki/Experience_API

**GitHub**

- Best practices for using webhooks: https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks
- Handling failed webhook deliveries: https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries
- Redelivering webhooks: https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks
- Webhook events and payloads: https://docs.github.com/en/webhooks/webhook-events-and-payloads
- REST: App webhooks https://docs.github.com/en/rest/apps/webhooks · Repository webhooks https://docs.github.com/en/rest/repos/webhooks · Activity events https://docs.github.com/en/rest/activity/events · Event types https://docs.github.com/en/rest/using-the-rest-api/github-event-types · Pulls https://docs.github.com/en/rest/pulls/pulls · Issues https://docs.github.com/en/rest/issues/issues · Issue comments https://docs.github.com/en/rest/issues/comments
- Changelog, Events API payload changes (2025-08-08): https://github.blog/changelog/2025-08-08-upcoming-changes-to-github-events-api-payloads/
- Best practices for creating a GitHub App: https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app
- Email addresses reference: https://docs.github.com/en/account-and-profile/reference/email-addresses-reference · Username changes: https://docs.github.com/en/account-and-profile/concepts/username-changes · Commits linked to the wrong user: https://docs.github.com/en/pull-requests/committing-changes-to-your-project/troubleshooting-commits/why-are-my-commits-linked-to-the-wrong-user · About pull request merges: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/about-pull-request-merges
- octokit webhook schemas: https://raw.githubusercontent.com/octokit/webhooks/main/payload-schemas/api.github.com/push/event.schema.json

**Slack and Discord**

- Events API: https://docs.slack.dev/apis/events-api/ · message event: https://docs.slack.dev/reference/events/message/ · bot_message, message_replied, message_changed (same section)
- users.info: https://docs.slack.dev/reference/methods/users.info/ · users.lookupByEmail: https://docs.slack.dev/reference/methods/users.lookupByEmail/ · conversations.history: https://docs.slack.dev/reference/methods/conversations.history/
- Rate-limit change for non-Marketplace apps (2025-05-29): https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps · changelog with the 2026-03-03 date: https://api.slack.com/changelog/2026-02-real-time-search-api
- Slack API Terms of Service: https://slack.com/terms-of-service/api · Real-time Search API: https://docs.slack.dev/apis/web-api/real-time-search-api · Guide to Slack AI: https://slack.com/help/articles/25076892548883-Guide-to-Slack-AI
- Discord Webhook Events: https://docs.discord.com/developers/events/webhook-events · Gateway: https://docs.discord.com/developers/events/gateway · Interactions: https://docs.discord.com/developers/interactions/receiving-and-responding · Change log: https://docs.discord.com/developers/change-log · "A Note to App Developers" [S]: https://support-dev.discord.com/hc/articles/40281523410967

**Vendors**

- Swarmia: https://help.swarmia.com/configuration/teams-and-members/contributors · https://help.swarmia.com/features/metrics/code-metrics · https://help.swarmia.com/configuration/organization-setup/data-quality/pull-request-data-quality · https://help.swarmia.com/configuration/notifications/personal-notifications · https://help.swarmia.com/configuration/team-setup/team-notifications
- LinearB: https://linearb.helpdocs.io/article/3i0ppmhfan-phase-2-configure-data-metrics-accuracy · https://linearb.helpdocs.io/article/5u3jzvjhbq-auto-merge · https://linearb.helpdocs.io/article/d0q6pz5emg-how-to-merge-accounts · https://linearb.helpdocs.io/article/1s38stsugw-glossary-metrics
- Haystack: https://support.usehaystack.io/en/articles/6563738-why-are-some-of-my-pull-requests-missing · https://support.usehaystack.io/en/articles/5572281-how-does-haystack-calculate-draft-pull-requests · https://support.usehaystack.io/en/articles/4530721-setting-exclusion-rules
- DX: https://docs.getdx.com/knowledgebase/how-does-dx-link-user-identities-across-systems/ · https://docs.getdx.com/knowledgebase/what-are-recommended-ways-of-linking-dx-users-to-their-github-accounts/
- Linear GitHub integration: https://linear.app/docs/github
- git mailmap: https://git-scm.com/docs/gitmailmap

**Queues and runtime**

- pg-boss: https://github.com/timgit/pg-boss · database backends: https://pgboss.io/database-backends · issues #880 https://github.com/timgit/pg-boss/issues/880 and #936 https://github.com/timgit/pg-boss/issues/936
- graphile-worker: https://worker.graphile.org/docs/requirements · job keys: https://worker.graphile.org/docs/job-key · performance: https://worker.graphile.org/docs/performance · issues #441 https://github.com/graphile/worker/issues/441 and #477 https://github.com/graphile/worker/issues/477
- Bun jsonb double encoding: https://github.com/oven-sh/bun/issues/28819
- PGlite extensions: https://pglite.dev/extensions/ · Absurd: https://github.com/earendil-works/absurd · DBOS Transact TS: https://github.com/dbos-inc/dbos-transact-ts · River (JS): https://github.com/riverqueue/river/tree/master/js · Oban worker: https://oban.hexdocs.pm/Oban.Worker.html

**Connector platforms and expression languages**

- Airbyte: https://docs.airbyte.com/platform/connector-development/config-based/understanding-the-yaml-file/yaml-overview · reference: …/reference · incremental syncs: …/incremental-syncs · protocol: https://docs.airbyte.com/platform/understanding-airbyte/airbyte-protocol · support levels: https://docs.airbyte.com/integrations/connector-support-levels · metadata file: https://docs.airbyte.com/platform/connector-development/connector-metadata-file
- Nango: https://nango.dev/docs/guides/functions/webhook-functions · https://nango.dev/docs/guides/platform/webhook-forwarding · https://nango.dev/docs/guides/functions/syncs/checkpoints · https://nango.dev/docs/guides/functions/syncs/deletion-detection · https://nango.dev/docs/guides/platform/migrations/migrate-to-zero-yaml
- Pipedream: https://pipedream.com/docs/components/contributing/api · https://pipedream.com/docs/components/contributing/guidelines
- n8n: https://docs.n8n.io/connect/create-nodes/build-your-node/reference/base-files/structure.md · credentials: https://docs.n8n.io/integrations/creating-nodes/build/reference/credentials-files/ · GitHub trigger source: https://raw.githubusercontent.com/n8n-io/n8n/master/packages/nodes-base/nodes/Github/GithubTrigger.node.ts · verification: https://docs.n8n.io/integrations/creating-nodes/build/reference/verification-guidelines/ · risks: https://docs.n8n.io/integrations/community-nodes/risks/
- Backstage: https://backstage.io/docs/backend-system/building-plugins-and-modules/index · https://backstage.io/docs/features/software-catalog/external-integrations/entity-providers
- Zapier: https://docs.zapier.com/platform/build/cli-hook-trigger · https://docs.zapier.com/platform/build/deduplication · https://docs.zapier.com/platform/publish/public-integration
- Hookdeck: https://hookdeck.com/docs/transformations · https://hookdeck.com/docs/filters · https://hookdeck.com/docs/deduplication · Svix: https://docs.svix.com/transformations · https://www.svix.com/blog/improving-transformations/ · Segment Source Functions: https://www.twilio.com/docs/segment/connections/functions/source-functions · RudderStack: https://www.rudderstack.com/docs/transformations/overview/
- JSONata guardrails: https://docs.jsonata.org/guardrails · AWS Step Functions JSONata: https://docs.aws.amazon.com/step-functions/latest/dg/transforming-data.html · RFC 9535: https://www.rfc-editor.org/rfc/rfc9535.html · CEL: https://cel.dev/ · CEL language definition: https://github.com/google/cel-spec/blob/master/doc/langdef.md · Kubernetes CEL: https://kubernetes.io/docs/reference/using-api/cel/ · cel-js: https://github.com/marcbachmann/cel-js · cel-es: https://github.com/bufbuild/cel-es · CVE-2024-21534 [S]: https://nvd.nist.gov/vuln/detail/CVE-2024-21534 · Handlebars runtime options: https://handlebarsjs.com/api-reference/runtime-options.html · LiquidJS DoS [S]: https://liquidjs.com/tutorials/dos
- Trust models: Grafana plugin signatures https://grafana.com/docs/grafana/latest/administration/plugin-management/plugin-sign/ · Home Assistant quality scale https://contributors.home-assistant.io/core/quality-scale/ · HACS https://hacs.xyz/docs/publish/include/ · Obsidian plugin security https://obsidian.md/help/plugin-security · Raycast store https://developers.raycast.com/basics/prepare-an-extension-for-store

**Forges and SaaS webhooks**

- GitLab Webhooks: https://docs.gitlab.com/user/project/integrations/webhooks/ · Webhook events: https://docs.gitlab.com/user/project/integrations/webhook_events/ · System hooks: https://docs.gitlab.com/administration/system_hooks/ · Instance limits: https://docs.gitlab.com/administration/instance_limits/
- Gitea Webhooks: https://docs.gitea.com/usage/webhooks · source v28.2.0: https://github.com/go-gitea/gitea/tree/v28.2.0/services/webhook and https://github.com/go-gitea/gitea/tree/v28.2.0/modules/structs
- Forgejo Webhooks: https://forgejo.org/docs/latest/user/webhooks/ · source v17.0.0: https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/services/webhook · forking post [S]: https://forgejo.org/2024-02-forking-forward/
- Gogs: https://github.com/gogs/gogs/blob/main/internal/database/webhook.go
- Bitbucket Cloud: https://support.atlassian.com/bitbucket-cloud/docs/manage-webhooks/ · https://support.atlassian.com/bitbucket-cloud/docs/event-payloads/ · Data Center: https://confluence.atlassian.com/bitbucketserver/event-payload-938025882.html
- Linear webhooks: https://linear.app/developers/webhooks · Jira Cloud webhooks: https://developer.atlassian.com/cloud/jira/platform/webhooks/ · Sentry webhooks: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/ · Stripe webhooks: https://docs.stripe.com/webhooks · PagerDuty signatures: https://docs.pagerduty.com/developer/verifying-webhook-signatures · Shopify HTTPS delivery: https://shopify.dev/docs/apps/build/webhooks/subscribe/https

**Experiments this session** (scratch directories outside the project; no project files touched):

- Queue evaluation (scratch, not in this repo): pg-boss 12.38.0, graphile-worker 0.18.0 and pgmq on Bun 1.3.6 with PGlite 0.5.11 and pglite-socket 0.2.14.
- jsonb check (scratch, not in this repo): drizzle-orm 0.45.4 with bun-sql against PGlite through pglite-socket, showing `jsonb_typeof = string`.
- Not tested against a real Postgres server: none is available on this machine.
