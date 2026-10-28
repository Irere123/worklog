# Integrations as installable apps: research for Worklog's ingestion pipeline

_Prepared 2026-10-27. Scope: how Worklog should move from hand-configured webhook connectors to apps each instance registers once and each workspace installs, what that changes in the ingestion pipeline, and what the pipeline still lacks. It builds on [activity-ingestion.md](activity-ingestion.md) (event model, noise rules, raw-first pipeline) and doesn't repeat it._

_Status, 2026-10-27: steps 1 to 4 of [§5](#5-order-of-work) are built, Discord installs as an app and reads messages over the Gateway, and Gitea and Forgejo backfill through a token, with webhooks Worklog creates itself. GitLab has no connector yet. The code calls an integration a **connector** (`src/connectors/`), and processing runs in lanes drained per partition rather than one queue per partition. What it does is in [CONNECTORS.md](../CONNECTORS.md) and [ARCHITECTURE.md](../ARCHITECTURE.md)._

Labels: **[V]** verified in source or official docs, **[I]** inferred. Sources are listed at the end, keyed by code (S1, G4…).

---

## 0. TL;DR

1. **Four concepts, not one.**
   - An **integration** is provider code.
   - An **app** is the instance's own registration with the provider, done once by an admin.
   - An **installation** is the provider-side account that installed the app: a GitHub installation, a Slack team, a Discord guild.
   - A **connection** links an installation to a workspace and holds its chosen sources.

   Sentry runs exactly this model [V]. Worklog can start with installation and connection in one row, keyed `unique(provider, external_id)`, and split them later.

2. **Each instance must register its own apps.** A provider app has exactly one webhook URL, so a shared Worklog-project app can't serve self-hosted instances [V].
3. **App credentials belong in the database, seeded from env.** The GitHub manifest flow and Slack's `apps.manifest.create` hand back credentials at runtime, and a web flow can't write `.env`. Cal.com, Coolify and Nango all keep them in the database [V]. This reverses the env-only suggestion made before this research.
4. **Setup is close to one click:**
   - **GitHub:** the manifest flow creates the app with one click [V].
   - **Slack:** one pasted configuration token creates the app through the API [V].
   - **Discord:** one pasted bot token, after which Worklog configures the app through `PATCH /applications/@me` [V].
   - **Gitea, Forgejo and GitLab:** these have no apps. A token plus webhooks Worklog creates itself ("managed webhooks") is the equivalent [V].
5. **The pipeline needs four new parts:**
   - an app-level webhook endpoint that routes by account id;
   - a lifecycle path for install, uninstall and suspend;
   - **sync**, a second source of events next to webhooks, with cursors;
   - a token broker that hands integration code an authenticated client.

   Normalize, gates, identity and persistence stay as they are. Semantic event ids already make a backfilled event and its later webhook land on one row.

6. **Backfill must not notify.** A review requested twenty days ago and long since done must not ping anyone. Backfilled events should run like replay: record activity, skip signals and board effects.
7. **Processing order needs partitions.** One queue per connection was fine for one repo's webhook. One installation covering an org, plus a backfill of thousands of events, would queue live events behind history.
8. **Security bugs others shipped in 2026:**
   - trusting the setup URL's `installation_id`, which Coolify fixed on 2026-05-22 and Dokploy still trusts;
   - weak or missing `state`: Dokploy's is predictable, Probot sends none, and Cal.com only added a nonce in February 2026;
   - ignoring uninstall events, as in Sentry's Slack TODO and Coolify.

   Worklog should get all three right from the start.

---

## 1. Where the pipeline stands

Checked against the recommendations in [activity-ingestion.md §8](activity-ingestion.md#8-prioritized-recommendations):

| # | Recommendation | State in the code |
| --- | --- | --- |
| 1 | jsonb stored as strings under Bun SQL | **Moot:** the driver is node-postgres |
| 2 | Raw-first ingestion | **Done:** `store()` in `ingest/pipeline.ts` inserts the delivery and its job in one `transact` |
| 3 | Queue hardening | **Mostly done:** Graphile Worker, one serial queue per connection (`ingest:{connectionId}`); no per-thread ordering |
| 4 | Semantic ids | **Done:** no event id contains a delivery id |
| 5 | Identity | **Partly done:** the placeholder upgrade is fixed; Slack identities still carry no email, because the connector never calls `users.info` |
| 9 | Connection health | **Partly done:** counts, skip reasons, unlinked identities, failures. **A bad signature leaves no trace** (a 401 and nothing stored), and there's no silence detector |
| 10 | Replay | **Done,** without the dry-run diff |
| 11 | GitHub reconcile | **Open:** it needs API credentials, which only an app gives |
| 13 | Gitea and Forgejo | **Done:** they share the GitHub mapper |
| 15 | No-code webhook connector | **Done** |
| 19 | Inbox retention | **Done** (`INBOUND_RETENTION_DAYS`) |

Other gaps found in the code:

- **Sources are typed by hand.** Slack channels are raw ids in `settings.channels`, with `channelNames` and `teamUrl` entered separately. GitHub `repos` is a typed list. An app could list them.
- **Every delivery updates `connections.last_event_at`.** That's a hot-row write outside the transaction. It's harmless at today's volume but contends once one installation covers an org [I].
- **`SecretBox` has one key and no key id,** so `WORKLOG_SECRET_KEY` can't be rotated. App private keys make this matter more. Nango refuses rotation; Mattermost added it in 2026-03 [V].

---

## 2. How others model it

| Product | App credentials | Install bound to tenant by | Webhook routing | Uninstall |
| --- | --- | --- | --- | --- |
| **Sentry** | config file; GitHub form pre-filled by URL | session-signed pipeline; the `installation.created` webhook creates the row, the OAuth'd user must match its `sender` | one URL per provider; `installation.id`, `team_id`, `guild_id` | GitHub: disabled; Slack: TODO |
| **Coolify** | database; GitHub manifest flow | random single-use `state` cached 60 min; `installation_id` checked with the app JWT | one URL; app-id header + `installation.id` | ignored |
| **Nango** | database, dashboard or API | server-side session row, deleted on callback | one URL per integration; a routing script per provider, fan-out to every match | forwarded to the customer |
| **Cal.com** | database, admin UI, seeded from env | HMAC-signed nonce (since 2026-02-20) | not applicable | credential marked invalid |
| **Midday** | env | `@slack/oauth` state store | one URL; `team_id` | not found |
| **Backstage** | YAML, written by a manifest CLI | not applicable | not applicable | not applicable |

Patterns worth copying [V unless marked]:

1. **Split the installation from the tenant link.** Sentry's `Integration` row is `unique(provider, external_id)`. `OrganizationIntegration` links it to an org, so one installation can serve several orgs and routing is one indexed lookup.
2. **The manifest flow done Coolify's way.** Use a random single-use `state` bound to the workspace and kept server-side. Refuse to overwrite credentials that exist. Check the `installation_id` with the app's JWT before saving.
3. **Accept installs that start on github.com.** Let `installation.created` create an unclaimed row, then claim it when the OAuth'd user matches the sender (Sentry). Or keep a pending connection matched on `requester.login` (Nango). Ingest nothing from an unclaimed install [I].
4. **Mint installation tokens on demand and cache them until they're close to expiry.** Never store long-lived GitHub tokens.
5. **Keep a manual mode beside the app.** Coolify keeps `/events/manual`. Worklog's `/hooks/{connectionId}` is that mode already.
6. **Treat linking a user account as separate from installing** (Sentry `Identity`, Midday `platform_identities`). One GitHub App can serve sign-in and the integration (Sentry, Backstage).
7. **Disable on uninstall, don't delete.** Start the backfill as a job on install (Sentry's `link_all_repos`, Nango's `initiateSync`).

Pitfalls: plain-text secrets (Dokploy), a default webhook secret of `"renovate"` (Mend), app name vs slug confusion (Sentry and Plane both warn), the 4KB env limit pushing Cal.com to the database, and Sentry's re-install-during-deletion race, fixed, reverted and fixed again through 2026.

---

## 3. What each provider needs

### GitHub App

- **Create (manifest flow)** [V G1]:
  - POST a `manifest` form to `github.com/settings/apps/new`, or `organizations/{org}/settings/apps/new`, with `?state=`.
  - GitHub redirects with a `code`, and `POST /app-manifests/{code}/conversions` returns `id`, `slug`, `client_id`, `client_secret`, `webhook_secret` and `pem`.
  - All of it must finish within one hour.
  - The manifest sets:
    - `hook_attributes.url`: the instance's app endpoint;
    - `setup_url`, with `setup_on_update: true`;
    - one `callback_urls` entry for sign-in;
    - `public: false`.
- **Permissions** [V G8, G16]:
  - Contents read: push, release, create, delete.
  - Pull requests read: PRs, reviews, review comments and threads.
  - Issues read: issues and comments.
  - Metadata read: repository renames.
  - **Leave Organization Members optional.** Requesting it means only an org owner can install, not a repo admin [V G13].
  - Request the Email addresses account permission for sign-in.
- **Tokens:**
  - The JWT is RS256, with `iat` 60 s in the past and at most a 10-minute life [V G3].
  - Installation tokens last 1 h, and can be narrowed to 500 repos [V G4].
  - Since 2026-10-02 they are opaque, about 520 characters long. Store them as `text` [V G5].
- **Rate limits** [V G6, G7]:
  - REST: 5,000/h per installation, plus 50 per repo past 20, capped at 12,500/h.
  - GraphQL: the same budget, counted in points.
  - A 50-repo, 30-day backfill is a few hundred calls [I].
- **Lifecycle** [V G8]:
  - `installation` events: created, deleted, suspend, unsuspend, new_permissions_accepted.
  - `installation_repositories` events: added, removed. `removed` is empty when the selection switches from all repos to selected ones.
  - `installation_target.renamed`.
  - `github_app_authorization.revoked`, which concerns user tokens only.
  - Every delivery carries `installation.id`.
- **Install binding** [V G9]:
  - The install link carries the signed `state`.
  - The setup URL's `installation_id` can be spoofed. Verify it with the installer's user token (`GET /user/installations`).
  - When a non-owner has to request approval from an owner, no webhook announces the request. Treat it as pending until `installation.created` arrives [V G14].
- **Backfill** [V G15, G21; cost I]:
  - PRs, reviews and comments: GraphQL `pullRequests(orderBy: UPDATED_AT)` with nested reviews and comments, about 2 points per page.
  - Issues and comments: REST `issues?since=` plus `issues/comments?since=` and `pulls/comments?since=`.
  - Pushes: `GET /repos/{o}/{r}/activity`, expanded with `compare`. Its retention is undocumented.
  - Releases: `/releases`.
- **Missed deliveries** [V G17]: `GET /app/hook/deliveries?status=failure` lists every installation's deliveries, and `POST …/attempts` redelivers. One sweeper per instance covers every connection.
- **Sign-in:**
  - The same client id and secret power the OAuth web flow, with PKCE [V G11].
  - User tokens last 8 h, and refresh tokens 6 months, single use [V G12].
  - The two sign-in-only env vars become the app's credentials.

### Slack app

- **Create:**
  - With `apps.manifest.create`, the admin pastes one app configuration token, which expires after 12 h. Slack returns `client_id`, `client_secret` and `signing_secret` [V S2].
  - Fallback: the prefilled `api.slack.com/apps?new_app=1&manifest_json=` link, after which the admin copies three fields back [V S1].
  - It's unclear whether an app created through the API verifies its Events request URL automatically [V S3].
- **Manifest:**
  - Slash commands `/log` and `/worklog`.
  - Event subscriptions: `app_mention`, `message.channels`, `message.groups`, `app_uninstalled`, `tokens_revoked`.
  - Interactivity, and redirect URLs.
  - Bot scopes: `app_mentions:read`, `channels:history`, `groups:history`, `channels:read`, `chat:write`, `im:write`, `commands`, `users:read`, `users:read.email`, `team:read`.
  - User scopes `openid email profile`, for sign-in [V S3].
  - `channels:read` and `team:read` replace the hand-typed `channelNames` and `teamUrl`. `users:read.email` closes the identity gap in §1 [I].
- **Install:**
  - OAuth v2 returns `team.id`, plus `enterprise.id` when `is_enterprise_install` [V S4].
  - Route by `team_id`, or by `enterprise_id` for org-wide installs. Event envelopes carry both [V S14].
- **Token rotation:** leave it off by default. Enabling it is irreversible, and it makes bot tokens expire every 12 h, so an instance down overnight strands its tokens [V S5; the default is I].
- **Uninstall:**
  - `app_uninstalled` and `tokens_revoked` arrive in no guaranteed order [V S6, S7].
  - `tokens_revoked` lists user ids only, so keep the map from token to team.
- **Distribution and rate limits** [V S8, S9]:
  - Installing in a second workspace means turning on distribution.
  - A distributed app outside the Marketplace has its `conversations.history` and `conversations.replies` limited to 1 request/min and 15 objects, for new installs since 2025-05-29.
  - Internal single-workspace apps keep 50+ requests/min.
  - Slack doesn't define "commercially distributed". Assume a per-instance app with distribution on counts [I].
  - **So:** default to one undistributed app per Slack workspace. Accept that backfill crawls if distribution is turned on.
- **Retries:** Delayed Events (2026-02-05) adds hourly retries for 24 h after the usual three. It's a UI toggle, with no manifest field. Document it [V S14].
- **No public URL:** Socket Mode carries events and slash commands over a WebSocket opened with an `xapp-` token [V S12]. The OAuth redirect still has to reach the admin's browser, but not Slack [I].
- **Sign in with Slack:** use OIDC, as a separate flow from the install [V S13].

### Discord

- **Create:**
  - Discord has no manifest or app-creation API [V D3].
  - From a pasted bot token, `GET /applications/@me` returns the id and public key.
  - `PATCH /applications/@me` sets the interactions URL, event webhooks, install params and the message-content intent flag.
  - Redirect URIs can't be set by API, so that remains one manual step in the portal.
- **Install:**
  - The OAuth link uses scopes `bot applications.commands identify`, `response_type=code` and a `state` [V D1].
  - The redirect's `guild_id` is only a hint. Take the guild from the token response, and check `iss` (since 2026-10-14) [V D1, D6].
- **Routing:** route by `authorizing_integration_owners["0"]`, falling back to `guild_id` [V D4].
- **Uninstall:** `APPLICATION_DEAUTHORIZED` carries only the user, and removal from a server has no HTTP signal [V D2]. Reconcile daily with `GET /users/@me/guilds` [I].
- **Messages:** these still come only over the Gateway, with `MESSAGE_CONTENT` [V D5]. Search Guild Messages (2026-03-19) can backfill [V D7].

### Gitea, Forgejo and GitLab: managed webhooks

- **None has an installation concept** [V F4, F5, L4].
- **The equivalent is a token plus webhooks Worklog creates itself,** each with its own random secret. The existing per-connection `/hooks/{id}` routing fits unchanged [I].
- **Tokens:**
  - **Gitea 1.23+:** scoped OAuth.
  - **Forgejo:** OAuth tokens get "administrative rights", so prefer a bot user's PAT limited to chosen repos [V F6, F5].
  - **GitLab:** OAuth with the `api` scope, or a group access token. GitLab.com reserves group access tokens for paid tiers [V L4, L7].
- **Hooks:**
  - **Gitea:** `active` defaults to false, so send `true` [V F4].
  - **GitLab:** group hooks need Premium, and `signing_token` needs 19.0+ [V L2].
  - **Recovery:** neither Gitea nor Forgejo has a delivery-redelivery API, so reconciliation is the only way back after missed deliveries. GitLab can resend from the last 7 days [V L1].
- **Lifecycle:**
  - There are no uninstall events. A 401, `invalid_grant` or a missing hook means uninstalled.
  - Reconcile daily: check that hooks exist and are active (GitLab auto-disables them), and run the `since` queries.
- **Egress:** Gitea and Forgejo block webhooks to private addresses by default. A Worklog on the same LAN receives nothing until the forge admin edits `app.ini` [V F3, F7]. Document it.

### Across providers

|  | Install | Routing key | Token life | Uninstall signal |
| --- | --- | --- | --- | --- |
| GitHub | manifest → install link + setup URL | `installation.id` | installation 1 h; user 8 h | `installation.deleted`, `suspend` |
| Slack | config token → `apps.manifest.create`; OAuth v2 | `team_id` / `enterprise_id` | none without rotation [I] | `app_uninstalled` + `tokens_revoked` |
| Discord | bot token → `PATCH @me`; OAuth bot link | guild id | bot: none | none for guild removal; poll |
| Gitea / Forgejo / GitLab | token + API-created hooks | hook id (per-connection URL) | OAuth 1–2 h, or a PAT | 401 or a missing hook |

---

## 4. What changes in the pipeline

### 4.1 Two entry points

- **App endpoint**, `/hooks/apps/{provider}[/{channel}]`:
  1. Verify the signature with the app-wide secret.
  2. Ask the integration for the routing key.
  3. Look up the connection by `(provider, external_id)`.
  4. Store the delivery under it, exactly as `store()` does today.
- **Manual endpoint:** the existing `/hooks/{connectionId}` stays for managed webhooks, the no-code `webhook` connector, `custom`, and pasted-secret GitHub.
- **Deliveries for no known connection** (an unclaimed install, or one just deleted) are acknowledged but not stored as activity. They are counted on the app's health [I].
- **Count signature failures on both endpoints.** This is the most common setup error, and it's invisible today.

### 4.2 Lifecycle is its own path

Install, uninstall, suspend and repository-change events change the connection's state. They don't produce activity, so they skip normalize.

- **Connection status** grows from `active | paused` to `pending | active | paused | suspended | revoked`.
- **Uninstall disables and keeps.** Tokens are deleted, while activity and the delivery inbox stay.
- **Repos added** (`installation_repositories.added`) enqueue a backfill for just those repos, inside the same `transact`.

### 4.3 Sync: a second source of events

A `sync` capability turns API reads into canonical `WorklogEvent`s. It's what backfill on install, the daily reconcile and Slack channel opt-in all use.

- **Store sync pages in the inbox** like deliveries, with `via: "sync"`, so replay and audit still cover them. The custom connector already stores canonical events (`receivePushed`).
- **Cursors per connection and stream** live in a `connection_cursors` table, saved only after the page's rows commit. This repeats Airbyte's and Nango's checkpoint rule from activity-ingestion.md §4.7.
- **Dedupe is free:** semantic ids make overlap with webhooks harmless.
- **Backfilled events don't notify.** They skip signals, attention and board effects, as replay does today (`source.replay`).
  - One exception: an item still open and recent may create a card or an attention item, such as a review requested yesterday and still pending [I].
  - The cut-off is a setting, not a guess.
- **Run sync on its own queue,** separate from live events (§4.4).

### 4.4 Ordering and parallelism

- **Today** every delivery for a connection runs on one queue, one at a time. That keeps merging and thread state correct, but an org-wide installation serializes everything.
- **Partition the queue** by a key the integration gives at receive time: the repository id for GitHub, the channel for Slack. Use `ingest:{connectionId}:{partition}`.
  - Merging and threads never cross a repo or channel, so order within a partition is enough [I].
  - A raise and its resolve land in the same thread, so they stay ordered.
- **Sync gets its own queues** (`sync:{connectionId}:{stream}`), so history never delays live events.
- **Write `last_event_at` sparingly:** only when the stored value is more than a minute old.

### 4.5 A token broker and a client per connection

- **One function hands integration code a fetch that already carries the right token,** built on `ctx.fetch` so tests keep stubbing it:
  - **GitHub:** an installation token, cached until 5 minutes before expiry.
  - **Slack:** the bot token.
  - **Managed webhooks:** the OAuth token, refreshed, or the PAT.
- **On a 401** the connection moves to `revoked` and raises attention for whoever installed it.
- **Nothing else stores or reads raw tokens.** Delivery to Slack or Discord and chat-command replies use the same client.

### 4.6 Enrichment stays out of normalize

- **Normalize stays pure.** API lookups, such as a Slack user's email for identity matching or a GitHub user's name, run as a job when an identity is first seen.
- **The job runs after the event is stored, outside any transaction,** which follows the rule on HTTP inside `transact`.
- **Matching an email to a member's verified address** is the high-confidence auto-link that activity-ingestion.md §3.9 asked for.

### 4.7 Sources replace typed settings

- **A `sources` capability lists what a connection can watch:** repos for GitHub, channels for Slack, guild channels for Discord.
- **The API serves the list** so a client can show a picker, and the chosen ids stay in `settings`.
- **This replaces** today's typed channel ids, `channelNames` and `teamUrl`.

### 4.8 The integration type

The `Connector` type grows into an integration whose capabilities are all optional:

```ts
type Integration = {
  id: string;
  name: string;
  app?: AppSpec; // credential fields + manifest(publicUrl) for one-click creation
  install: "app" | "oauth" | "manual";
  route?: (
    req: InboundRequest
  ) => { externalId: string; partition?: string } | null;
  receive: Connector["receive"];
  normalize: Connector["normalize"]; // unchanged and pure
  lifecycle?: (
    ctx: AppContext,
    delivery: Delivery
  ) => Promise<ConnectionChange | null>;
  sync?: Record<string, Stream>; // emits WorklogEvents page by page, with a cursor
  sources?: (client: Client, conn: ConnectionView) => Promise<Source[]>;
  interact?: Connector["interact"];
  deliver?: (
    client: Client,
    target: DeliveryTarget,
    message: Message
  ) => Promise<void>;
  signIn?: (app: AppCredentials) => SocialProviderConfig; // feeds Better Auth
};
```

It lives in a new `src/integrations/` module, one file per provider with the registry beside it. The pipeline stays in `ingest/`. Integrations now deliver, answer commands and power sign-in, so ingest is no longer their only use.

### 4.9 Schema changes

- **`integration_apps`:** one row per provider per instance, with the credentials sealed. On first boot it's seeded from env when present.
- **`connections`:**
  - add `external_id`, with `unique(provider, external_id)`, nullable for manual connections;
  - add `installed_by` (a member);
  - widen `status`;
  - store token expiry inside the sealed secrets.
- **`connection_cursors`:** `(connection_id, stream, cursor, updated_at)`.
- **`inbound_events`:** add `via` (`webhook | sync | push`).
- **`SecretBox`:** a key id on sealed values, so the key can be rotated.

### 4.10 Security checklist

1. **Every `state` is random and single-use,** stored server-side bound to workspace and member, and expires within 1 h. It covers the manifest flow, install links and OAuth.
2. **Never trust a redirect's parameters.** Verify the GitHub `installation_id` with the user's token. Take the Discord guild from the token response, not the redirect. Check Discord's `iss`.
3. **Unclaimed installs ingest nothing.**
4. **Refuse to overwrite an app's credentials once they exist.** Rotating them is an explicit admin action.
5. **Handle uninstall and revocation from day one,** and back them with daily reconciliation where the provider sends no signal.

---

## 5. Order of work

| Step | Change | Why first | Effort |
| --- | --- | --- | --- |
| 1 | Count signature failures; partition the ingest queue; write `last_event_at` sparingly | Useful today, and needed before org-wide installs | S |
| 2 | Integration type and `src/integrations/` module; `integration_apps`; app endpoint and routing; lifecycle statuses; token broker; `SecretBox` key ids | The frame every app needs | M |
| 3 | **GitHub App:** manifest flow, install binding, lifecycle, sync streams with cursors, no-notify backfill, failed-delivery sweeper, sign-in on the same app | Backfill and reconcile are the biggest gaps in the activity stream | M–L |
| 4 | **Slack app:** manifest through a config token, OAuth install, channel picker, email enrichment, uninstall handling | Removes the hardest manual setup | M |
| 5 | **Managed webhooks** for Gitea, Forgejo and GitLab (the GitLab mapper is activity-ingestion.md §8 #14) | Same backfill and reconcile for self-hosted forges | M |
| 6 | **Discord** one-paste setup; a shared WebSocket worker for Slack Socket Mode and the Discord Gateway, only if needed | For instances without a public URL, and Discord messages | M |

---

## 6. Decisions to make

1. **Where app credentials live.** In the database, seeded from env (recommended, see TL;DR 3), or env only, which rules out one-click creation.
2. **One workspace per installation for now?** Recommended: yes, with `unique(provider, external_id)` on connections. Split out an installation table only if one org must feed two workspaces.
3. **Slack distribution.** Recommended: one undistributed app per Slack workspace by default. Allowing more than one workspace per app caps history reads at 1 request/min, which makes Slack backfill impractical.
4. **Backfill window and the notify cut-off.** Suggested: 14 days of history. Only items still open and less than 2 days old may raise attention.
5. **Pasted-secret GitHub webhooks.** Recommended: keep them as the manual mode. They're the cheapest option for one repo, and the only mode for instances that won't register an app.
6. **Instances without a public URL.** Recommended: defer. Slack Socket Mode and the Discord Gateway need a long-lived worker. GitHub can run the app with webhooks off and poll through sync instead [V G1, I].

---

## 7. Corrections to activity-ingestion.md

- **§3.8 and §4.7, Slack history limits for existing installs:** the sources conflict. The canonical docs.slack.dev page now says existing installations are not affected. The api.slack.com changelog mirror still says 2026-03-03 [V S9, S10].
- **§4.7, Slack retries:** Delayed Events (2026-02-05) adds hourly retries for 24 h. It's opt-in [V S14].
- **§4.7, Discord:**
  - The 10,000-user threshold for privileged intent review is confirmed by the 2026-06-10 changelog [V D6].
  - Search Guild Messages is a new backfill option [V D7].

---

## 8. Unverified or unclear

- How GitHub returns `state` after an install that started from the install link. The docs say only that it is "preserved" [G9].
- The retention of GitHub's repository activity endpoint, which is the only way to rebuild pushes without the Events API [G15].
- Whether an app created through `apps.manifest.create` verifies its Events request URL on its own [S3].
- Whether a per-instance Slack app with distribution turned on counts as "commercially distributed" [S9].
- How long Slack refresh tokens live under rotation, and whether bot tokens without rotation ever expire [S5, S16].
- Plane's integration source ("Silo"), which isn't in the open-source repo.

---

## 9. Sources

**Products** (read 2026-10-27):

- **Sentry:**
  - [Integration](https://github.com/getsentry/sentry/blob/master/src/sentry/integrations/models/integration.py) and [OrganizationIntegration](https://github.com/getsentry/sentry/blob/master/src/sentry/integrations/models/organization_integration.py) models.
  - GitHub [integration](https://github.com/getsentry/sentry/blob/master/src/sentry/integrations/github/integration.py), [webhook](https://github.com/getsentry/sentry/blob/master/src/sentry/integrations/github/webhook.py) and [client](https://github.com/getsentry/sentry/blob/master/src/sentry/integrations/github/client.py).
  - Slack [requests](https://github.com/getsentry/sentry/blob/master/src/sentry/integrations/slack/requests/base.py) and [events](https://github.com/getsentry/sentry/blob/master/src/sentry/integrations/slack/webhooks/event.py).
  - [Encrypted metadata, PR #106163](https://github.com/getsentry/sentry/pull/106163).
  - Docs: [GitHub](https://develop.sentry.dev/integrations/github/), [Slack](https://develop.sentry.dev/integrations/slack/), [SSO](https://develop.sentry.dev/self-hosted/configuration/sso/).
- **Coolify:** [github_apps migration](https://github.com/coollabsio/coolify/blob/main/database/migrations/2023_03_28_083723_create_github_apps_table.php), [Change.php](https://github.com/coollabsio/coolify/blob/main/app/Livewire/Source/Github/Change.php), [webhook controller](https://github.com/coollabsio/coolify/blob/main/app/Http/Controllers/Webhook/Github.php), [installation check, commit 5a7408a9](https://github.com/coollabsio/coolify/commit/5a7408a9), [routes](https://github.com/coollabsio/coolify/blob/main/routes/webhooks.php).
- **Dokploy:** [setup.ts](https://github.com/Dokploy/dokploy/blob/canary/apps/dokploy/pages/api/providers/github/setup.ts), [schema](https://github.com/Dokploy/dokploy/blob/canary/packages/server/src/db/schema/github.ts).
- **Probot:** [manifest-creation.ts](https://github.com/probot/probot/blob/master/src/manifest-creation.ts), [@octokit/auth-app](https://github.com/octokit/auth-app.js#readme).
- **Cal.com:** [getAppKeysFromSlug](https://github.com/calcom/cal.com/blob/main/packages/app-store/_utils/getAppKeysFromSlug.ts), [decodeOAuthState](https://github.com/calcom/cal.com/blob/main/packages/app-store/_utils/oauth/decodeOAuthState.ts), [createOAuthAppCredential](https://github.com/calcom/cal.com/blob/main/packages/app-store/_utils/oauth/createOAuthAppCredential.ts), [.env.appStore.example](https://github.com/calcom/cal.com/blob/main/.env.appStore.example).
- **Midday:** [schema](https://github.com/midday-ai/midday/blob/main/packages/db/src/schema.ts), [Slack OAuth callback](https://github.com/midday-ai/midday/blob/main/apps/api/src/rest/routers/apps/slack/oauth-callback.ts).
- **Nango:** [webhook controller](https://github.com/NangoHQ/nango/blob/master/packages/server/lib/controllers/webhook/environmentUuid/postWebhook.ts), [routing](https://github.com/NangoHQ/nango/blob/master/packages/server/lib/webhook/internal-nango.ts), [GitHub App OAuth routing](https://github.com/NangoHQ/nango/blob/master/packages/server/lib/webhook/github-app-oauth-webhook-routing.ts), [webhook forwarding](https://nango.dev/docs/guides/platform/webhook-forwarding).
- **Backstage:** [GitHub Apps](https://backstage.io/docs/integrations/github/github-apps).
- **Plane:** [GitHub](https://developers.plane.so/self-hosting/govern/integrations/github), [Slack](https://developers.plane.so/self-hosting/govern/integrations/slack).
- **Mattermost:** [GitHub plugin](https://github.com/mattermost/mattermost-plugin-github/blob/master/server/plugin/plugin.go).
- **Renovate:** [GitHub platform](https://docs.renovatebot.com/modules/platform/github/).

**GitHub** (docs.github.com unless a full URL is given):

- G1 `/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest`
- G2 `/en/rest/apps/apps`
- G3 `/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app`
- G4 `/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app`
- G5 https://github.blog/changelog/2026-10-02-stateless-github-app-installation-tokens-rolled-out/
- G6 `/en/rest/using-the-rest-api/rate-limits-for-the-rest-api`
- G7 `/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api`
- G8 `/en/webhooks/webhook-events-and-payloads`
- G9 `/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url`
- G11 `/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app`
- G12 `/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens`
- G13 `/en/apps/using-github-apps/installing-a-github-app-from-a-third-party`
- G14 `/en/apps/using-github-apps/requesting-a-github-app-from-your-organization-owner`
- G15 `/en/rest/repos/repos#list-repository-activities`
- G16 `/en/rest/authentication/permissions-required-for-github-apps`
- G17 `/en/rest/apps/webhooks`
- G21 `/en/rest/pulls/reviews`

**Slack** (docs.slack.dev unless a full URL is given):

- S1 `/app-manifests/configuring-apps-with-app-manifests`
- S2 `/reference/methods/apps.manifest.create`
- S3 `/reference/app-manifest`
- S4 `/authentication/installing-with-oauth`
- S5 `/authentication/using-token-rotation`
- S6 `/reference/events/app_uninstalled`
- S7 `/reference/events/tokens_revoked`
- S8 `/distribution`
- S9 `/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps`
- S10 https://api.slack.com/changelog/2026-02-real-time-search-api
- S12 `/apis/events-api/using-socket-mode`
- S13 `/authentication/sign-in-with-slack`
- S14 `/apis/events-api`, `/changelog/2026/02/05/retry-events-feature/`
- S16 `/authentication/tokens`

**Discord** (docs.discord.com/developers):

- D1 `/topics/oauth2`
- D2 `/events/webhook-events`
- D3 `/resources/application`
- D4 `/interactions/receiving-and-responding`
- D5 `/events/gateway`
- D6 `/change-log`
- D7 `/resources/message`

**Gitea, Forgejo and GitLab:**

- F1 https://docs.gitea.com/development/oauth2-provider
- F3 https://docs.gitea.com/administration/config-cheat-sheet
- F4 https://gitea.com/swagger.v1.json
- F5 https://codeberg.org/swagger.v1.json
- F6 https://forgejo.org/docs/latest/user/oauth2-provider/
- F7 https://forgejo.org/docs/latest/admin/config-cheat-sheet/
- L1 https://docs.gitlab.com/api/project_webhooks/
- L2 https://docs.gitlab.com/api/group_webhooks/
- L4 https://docs.gitlab.com/integration/oauth_provider/
- L7 https://docs.gitlab.com/user/project/settings/project_access_tokens/
