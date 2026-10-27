# better-auth for Worklog: evaluation and integration plan

_Researched 2026-10-26 against `better-auth@1.7.13` (published 2026-10-25). Sources are listed at the end._

How claims were checked:

- **[verified]**: I ran it in a scratch prototype (not in this repo: Bun 1.3.6, Hono 4.13.14, drizzle-orm 0.45.4, PGlite 0.5.11, zod 4.6.7) or read it in the 1.7.13 type definitions or source.
- **[docs]**: taken from the official docs only (docs source at commit `58485be`, which is 1.7.13).
- **[unverified]**: an inference or a third-party claim.

---

## 0. Recommendation (TL;DR)

**Adopt partially, in stages.**

| Area | Decision |
| --- | --- |
| Human identity: users, sessions, email + magic link / email OTP, GitHub/Slack/Discord sign-in, account linking | **Adopt now** |
| Workspaces, membership, roles and invitations (organization plugin, mapped onto our `workspaces` table) | **Adopt now** |
| API keys (`@better-auth/api-key`) replacing `api_tokens`, for personal keys, agents and integrations | **Adopt now.** Existing `wl_` tokens migrate without being reissued. |
| Mobile (expo plugin, or the bearer plugin) | **Adopt now** |
| OAuth 2.1 provider, MCP, device grant and CIMD, for external AI agents | **Adopt in phase 3.** Wait for 1.8 stable, because 1.8 changes the device-approval flow. |
| Worklog's agent model: `members` with kind `agent`, personal assistants, `ownerId` | **Keep ours.** better-auth's org `member` must be a `user`, so it cannot represent agents. |
| `@better-auth/agent-auth` (Agent Auth Protocol) | **Watch, don't build on it.** It is 0.6.2, in a separate repo, and its docs say "not yet stable". |
| Teams, admin, multi-session, SSO, SCIM | **Not now.** BA teams can only contain users; add the others when a customer needs them. |

The main reasons:

- The whole Bun + Hono + Drizzle (`bun-sql` and PGlite) + Zod v4 stack works end to end. 19/19 prototype checks passed on both drivers, plus 7/7 for the device-grant agent flow.
- Every email hook is a plain async callback, so it plugs straight into our `Mailer`.
- IDs can keep our `prefix_ulid` format.
- The organization hooks give us the exact seam to create the member profile and personal assistant.

The costs:

- **Release churn and advisory cadence** in the OAuth/MCP surface.
- **A generated schema we must keep in sync.**
- **Several API-key quirks** that need wrapping. They are listed in §5.

---

## 1. Version, maturity and company status

**Version [verified via `npm view`]:**

- `better-auth` **1.7.13** is `latest`, published 2026-10-25.
- Other dist-tags: `beta` 1.8.0-beta.2 (2026-10-22), `release-1.6` 1.6.33, `release-1.4` 1.4.22.
- There is **no v2**. Minors have shipped every 1–3 months: 1.0 (2024-11-23), 1.3 (2025-07-19), 1.4 (2025-11-22), 1.5 (2026-03-01), 1.6 (2026-04-06), 1.7 (2026-08-18).
- All `@better-auth/*` packages release in lockstep (`api-key`, `drizzle-adapter`, `oauth-provider`, `mcp`, `cimd`, `expo`, `sso`, `scim`, `passkey`, `stripe`, `i18n`…), except `@better-auth/agent-auth` (0.6.2) and `@better-auth/utils`.
- **The CLI is now the `auth` package.** Run it as `bunx auth …` (it also installs a `better-auth` bin). `@better-auth/cli` is stale at 1.4.21. So the `@better-auth/cli generate` command in the brief is outdated; use `bunx auth generate`.

**Adoption [verified]:**

- About 8.3M npm downloads in the week of Oct 16–22, 2026.
- `@better-auth/api-key` about 0.97M/week; `@better-auth/mcp` about 0.46M/week.
- GitHub: 30.5k stars, 892 open issues, MIT license, last push 2026-10-25.

**Company timeline [docs: blog]:**

- **2025-06-24:** $5M seed led by Peak XV, with YC and others.
- **2025-09-22:** Auth.js (NextAuth) became maintained by the Better Auth team.
- **2026-01-01:** "Better Auth Infrastructure" (a paid dashboard, audit logs and security product) launched. Its later fate is not stated.
- **2026-07-07: "Better Auth is joining Vercel."**
  - The post says joining, not acquisition. It says Vercel "shares our commitment to keeping auth open source, framework and platform agnostic", and that the move lets the team avoid shaping strategy around monetization.
  - It names **Agent Auth** ("agents act on users' behalf and need secure, scoped, and revocable access") as a joint focus.
  - The license is still MIT [verified, LICENSE.md].
  - Long-term roadmap influence from Vercel is a soft risk; nothing so far is Vercel-specific. _[unverified judgment]_

**1.7 (2026-08-17):**

- Major OAuth 2.1/OIDC expansion.
- `oidcProvider` plugin **removed** (use `@better-auth/oauth-provider`).
- MCP moved to `@better-auth/mcp`.
- CIMD added.
- RFC 8628 device grant for OAuth clients.
- SCIM rebuilt.
- Stable DB joins.
- Drizzle Relations v2.
- `npx auth create-admin`.
- Expo SecureStore methods became async.

**The 1.7.0–1.7.2 regression:**

- 1.7.0 added a required `account.issuer` column, which broke upgrades and sign-ins.
- 1.7.3 reverted it, and old migrations need a cleanup.
- This is evidence of schema churn in minor releases.

**1.8 beta (Oct 2026) breaking notes, from GitHub releases:**

- OAuth device approval moves to `/oauth2/authorize?user_code=…`, replacing `/device/approve`.
- New `deviceCode` columns.
- Pairwise `sub` for native clients needs a new `oauthClient.sectorIdentifier` column.
- Sign-up emails now run after DB work.
- New `@better-auth/ciba`.
- Core, organization, api-key and Drizzle changes were not called out.

**Security track record [docs: blog, GitHub advisories]:**

- June 2026 security update: 14 advisories (several High, 2 Critical), concentrated in OAuth provider, OIDC/MCP, SSO, SCIM and org-invitation ownership.
- Sept 2026: GHSA-965c-763c-88jm (**Critical**) — an OAuth state could be replayed as a magic-link token when Magic Link plus a social provider plus DB-stored state are all enabled, which is exactly our planned config. **Fixed in 1.7.7.**
- Sept 2026 also: GHSA-q84f-53jg-9ppm (High, device-approval UI), plus SSO and OAuth-proxy issues.
- `bun audit` on 1.7.13 reports none of these. [verified]
- **Treat Better Auth as security-critical, fast-moving code.** Pin exact versions, upgrade all `@better-auth/*` together (`bunx auth upgrade`), and watch the advisories feed.

---

## 2. Integration with our stack

### 2.1 Hono mounting and CORS [verified]

```ts
app.use("/api/auth/*", cors({ origin: [WEB_ORIGIN], credentials: true })); // before the handler
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
// Needed once the OAuth/MCP plugins are on: RFC 9728 / RFC 8414 metadata lives at the root
app.get("/.well-known/*", (c) => auth.handler(c.req.raw));
```

- The docs use `app.all(...)`, which also works.
- Add the same origins to `trustedOrigins`. Include the mobile scheme (e.g. `worklog://`) and, in development only, `exp://` patterns.
- **This works on `OpenAPIHono`** (from `@hono/zod-openapi`). [verified]
  - Our own routes stay in our OpenAPI document.
  - Better Auth's endpoints get a separate OpenAPI 3.1.1 document from the `openAPI()` plugin: 126 paths with this plugin set [verified].
  - Our Scalar page can show both documents: add `/api/auth/open-api/generate-schema` as a second source [docs].
- Verified through Hono: `/.well-known/oauth-authorization-server/api/auth`, `/.well-known/oauth-protected-resource[/mcp]`, `/api/auth/.well-known/openid-configuration`, `/api/auth/jwks` and `/api/auth/reference`.

### 2.2 Drizzle adapter: Postgres provider, `bun-sql` and PGlite [verified]

```ts
import { drizzleAdapter } from "@better-auth/drizzle-adapter"; // also re-exported as "better-auth/adapters/drizzle"
database: drizzleAdapter(db, { provider: "pg", transaction: true }),
```

- **It works with both of our drivers.** The prototype ran the full suite on `drizzle-orm/pglite`, and on `drizzle-orm/bun-sql` with Bun's native `SQL` connecting over the Postgres wire protocol (through `@electric-sql/pglite-socket`).
- The adapter is driver-agnostic: it only uses the Drizzle query builder.
- The source explicitly handles bun-sql's `count`-on-Array result shape for affected rows.
- `transaction: true` works on both drivers (it defaults to `false`).
- Our `Db` type (`PgDatabase<PgQueryResultHKT, typeof schema>`) can be passed directly. The adapter finds tables through `db._.fullSchema`, or through an explicit `schema` option.
- **Not run against a real Postgres server** (none was available). The bun-sql test used PGlite behind a socket. _[unverified on production Postgres, low risk]_
- `timestamp(..., { withTimezone: true })` columns work.
  - The CLI generates plain `timestamp()`. I converted the generated file to `timestamptz` and re-ran everything, and it all passed.
- **Runtime schema validation [docs + verified]:**
  - At init, Better Auth compares the Drizzle schema object (not the live DB) with what it will write.
  - On a mismatch it logs an error, and **auth requests fail** (the server keeps running).
  - `bunx auth check schema --config …` runs the same check in CI. It passed on the prototype.

### 2.3 Bun [verified]

- Everything ran on Bun 1.3.6: password sign-up (scrypt), cookies, the bearer plugin, the org plugin, API keys, JWKS/JWT, the OAuth device flow, and the CLI (`bunx auth generate`, `bunx auth check schema`).
- **One Bun caveat (CIMD):**
  - The docs say Node can use `@better-auth/cimd/node`'s `fetchClientMetadataResource`, which resolves DNS once, pins the address and refuses redirects. They also say "Bun, Deno, Workers… must provide the equivalent secure transport".
  - Under Bun 1.3.6 the Node transport _functionally_ works: it fetches `https://www.example.com`, and rejects `localhost`, `127.0.0.1` and `10.0.0.1` [verified].
  - Whether Bun's `node:https` actually honours the pinned-address connection (the DNS-rebinding guarantee) is **[unverified]**. Treat CIMD on Bun as not officially supported until checked.

### 2.4 Schema generation alongside drizzle-kit [verified]

```bash
bunx auth generate --config scripts/auth-cli.ts --output src/db/auth-schema.ts \
  --adapter drizzle --dialect postgresql --yes     # Drizzle TS file for BA tables (+ relations)
bunx drizzle-kit generate                          # our normal migration flow; include auth-schema.ts in drizzle.config `schema`
```

**Generated output:**

- For our plugin set, the CLI produced 18 BA tables, plus `workspaces` (mapped).
- They became a single drizzle-kit migration alongside our tables.

**How to work with the CLI:**

- **`auth migrate` is Kysely-only.** With Drizzle you always use `generate` plus drizzle-kit [docs].
- The CLI imports your config file, so give it a side-effect-free entry point. `scripts/auth-cli.ts` should build `createAuth()` over `drizzle({ client: new PGlite() })` (in-memory) instead of our `openDb()`, which runs migrations. That pattern worked in the prototype.
- `--adapter drizzle --dialect postgresql` generates without a live DB.

**The workflow I'd adopt:**

1. Commit `src/db/auth-schema.ts` as a generated file.
2. Regenerate it on every BA upgrade or plugin change.
3. Optionally post-process it to `timestamptz` (a `sed` on `timestamp("x")`, verified).
4. Diff it, then run `drizzle-kit generate`.
5. CI runs `bunx auth check schema`.

### 2.5 Zod v4 [verified]

- `better-auth@1.7.13` depends on `zod ^4.5.4`.
- With our `zod ^4.6.7` and `@hono/zod-openapi ^1.6.3`, Bun installs a **single** `zod@4.6.7`.
- Better Auth validates its own request bodies; we don't hand it schemas.

### 2.6 Session or user inside Hono middleware [verified]

```ts
const session = await auth.api.getSession({ headers: c.req.raw.headers });
// -> { user, session } | null; session.activeOrganizationId is typed when organization() is on
```

**Inputs it accepts:**

- The session cookie.
- `Authorization: Bearer <session token>`, once the bearer plugin is installed.
- `typeof auth.$Infer.Session` gives the type for Hono `Variables`.

**Cost:**

- Every call reads from the DB unless `session.cookieCache` is enabled (signed short-lived cookie, default suggestion 5 min).
- With cookieCache on, revocation is delayed by up to `maxAge` [docs].

---

## 3. Plugins (exact names, imports, config)

| Plugin | Import | Fit for Worklog | Status |
| --- | --- | --- | --- |
| organization (+teams, AC, invitations, hooks) | `import { organization } from "better-auth/plugins"`; AC: `better-auth/plugins/access`, defaults: `better-auth/plugins/organization/access` | Workspaces, human membership, roles, invitations | **verified** |
| api-key | `import { apiKey } from "@better-auth/api-key"` (moved out of core); client: `@better-auth/api-key/client` | Replaces `api_tokens`; agent and integration keys | **verified** |
| bearer | `import { bearer } from "better-auth/plugins"` | Mobile and bot session tokens (`set-auth-token` response header) | **verified** |
| jwt | `import { jwt } from "better-auth/plugins"` | Required by oauth-provider/mcp (JWKS) | **verified** (as a dependency of mcp) |
| magic-link | `import { magicLink } from "better-auth/plugins"` | Passwordless login and invite acceptance | **verified** (send path) |
| email-otp | `import { emailOTP } from "better-auth/plugins"` | Mobile-friendly codes | **verified** (send path) |
| social: github / slack / discord | core `socialProviders: { github, slack, discord }` | Sign-in plus attribution | config **verified**; account-ID mapping read from source; live OAuth **[unverified]** |
| openAPI | `import { openAPI } from "better-auth/plugins"` | Spec for BA endpoints (3.1.1), Scalar at `/api/auth/reference` | **verified** |
| oauth-provider (+ device grant) | `import { oauthProvider, oauthDeviceAuthorization, DEVICE_CODE_GRANT_TYPE } from "@better-auth/oauth-provider"` | External agents with delegated access | device grant **verified** |
| mcp | `import { mcp, requireMcpAuth, createMcpProtectedRequestHandler } from "@better-auth/mcp"` | A Worklog MCP server for coding agents | metadata **verified**; full MCP client flow **[unverified]** |
| cimd | `import { cimd } from "@better-auth/cimd"`, `import { fetchClientMetadataResource } from "@better-auth/cimd/node"` | MCP 2026-07-28 client identity | Bun caveat (§2.3) |
| agent-auth | `import { agentAuth } from "@better-auth/agent-auth"` | Agent Auth Protocol | docs only; **experimental** |
| expo | server `import { expo } from "@better-auth/expo"`; client `expoClient` from `@better-auth/expo/client` | Mobile app | server plugin loads **[verified]**; client **[docs]** |
| admin | `import { admin } from "better-auth/plugins"` | Platform (not workspace) admin, ban, impersonate | schema generated; behaviour **[docs]** |
| multiSession | `import { multiSession } from "better-auth/plugins"` | Multiple accounts per browser | **[docs]**, low priority |
| deviceAuthorization (first-party) | `better-auth/plugins` | Device login that yields a BA _session_ (not an OAuth token) | **[docs]**; prefer the OAuth device grant for agents |

### 3.1 organization: can it replace workspaces and roles?

**Partly. It can own workspaces, human membership, roles and invitations, but not our agent members.**

**Mapping onto our existing table [verified]:**

- `schema: { organization: { modelName: "workspaces", additionalFields: { timezone, entropyDays, cardSeq } } }` makes BA's organization _be_ our `workspaces` table.
- The generated table has `id, name, slug, logo, metadata, created_at, timezone, entropy_days, card_seq`. We need to add nullable `logo` and `metadata` columns.
- IDs come out as `ws_…`.
- Gotcha [verified]: an additional field with `required: true` **and** a `defaultValue` is still required in the request body, and you get a 400 VALIDATION_ERROR without it. Use `required: false` with `defaultValue`. For server-owned fields (`cardSeq`), use `input: false, returned: false`.

**Membership and roles:**

- `member(organizationId, userId → user.id NOT NULL, role, createdAt)`.
- Roles are owner, admin and member (the same as ours). Multiple roles are stored comma-separated.
- Custom permissions use `createAccessControl({...defaultStatements, card: [...], apiKey: [...]})` and `ac.newRole(...)`.
- Checks use `auth.api.hasPermission({ headers, body: { permissions } })`.
- `dynamicAccessControl` adds per-org roles in the DB.
- It can be renamed with `schema.member.modelName` (e.g. `"memberships"`). That is the same mechanism as above, but not separately tested.

**Hooks we need [verified that they fire]:**

- `organizationHooks.afterAddMember`: fires on org create (for the creator) and on `addMember`.
- `organizationHooks.afterAcceptInvitation`: fires on acceptance. **Acceptance does _not_ fire `afterAddMember`** [verified in source and prototype]. Handle both hooks.
- Also available: `before/afterCreateOrganization`, `before/afterUpdateMemberRole`, `before/afterRemoveMember`, plus invitation and team hooks.

**Invitations [verified]:**

- `sendInvitationEmail(data)` receives `{ id, role, email, organization, invitation, inviter: { user } }`.
- We build the link (`/invite/:id`) and call our mailer.
- Accepting needs a signed-in session whose email matches the invitation.
- **With a custom `generateId`, Better Auth treats invitation IDs as predictable and requires a verified email to accept**, unless `requireEmailVerificationOnInvitation: false` is set. The prototype returned 403 `EMAIL_VERIFICATION_REQUIRED_…` until the email was verified.
- That's a good posture: magic-link and OTP sign-in verify email anyway. Set it explicitly to `true`.

**Teams:**

- `teams: { enabled: true }` adds `team` and `teamMember(teamId, userId)` and creates a default team per org [verified].
- Users only, so agents can't be in teams. Leave it off.

### 3.2 api-key: agents and integrations, with scopes, rate limits and expiry

**What the 1.7.13 types support [verified]:**

- **Multiple configs:** `apiKey([{ configId, defaultPrefix, references: "user" | "organization", enableMetadata, rateLimit, keyExpiration, permissions: { defaultPermissions }, storage, deferUpdates, ... }])`.
- **Per-key fields:** `name`, `expiresIn` (s), `remaining`/`refillAmount`/`refillInterval`, `rateLimitEnabled`/`rateLimitTimeWindow`/`rateLimitMax`, `permissions: Record<string, string[]>`, `metadata`.
- **Org-owned keys:**
  - `references: "organization"` makes `referenceId = organizationId`.
  - Creating one requires a user with `apiKey: ["create"]` in that org.
  - Owners always have access.
- **Verification:** `auth.api.verifyApiKey({ body: { key, permissions? } })` returns `{ valid, error, key }`. `key` includes `configId`, `referenceId`, `metadata` and `permissions`.

**Can a key belong to an agent?**

- Not natively. `referenceId` can only be a user or an org ID.
- Pattern [verified]:
  - Use an org-owned key in config `agent`.
  - Set `metadata: { memberId }`.
  - Our middleware loads the member and checks `member.workspaceId === key.referenceId`.

**Quirks found [all verified on 1.7.13]:**

1. **`verifyApiKey` without `configId` needs a config named `"default"`.** Otherwise it throws `NO_DEFAULT_API_KEY_CONFIGURATION_FOUND`. With `configId: "default"` present, a no-`configId` verify resolves keys of _every_ config, and you branch on `key.configId`. This also handles legacy agent tokens that keep the `wl_` prefix.
2. **Every config in the array needs a `configId`.** You get a startup error otherwise.
3. **A failed permission check returns `valid:false` with code `KEY_NOT_FOUND`**, and logs at ERROR. You can't tell 401 from 403. Verify without `permissions` and check `key.permissions` yourself.
4. **`metadata` is client-settable** on `POST /api-key/create` (`z.any()` in source). Never trust `metadata.memberId` unless only our server creates agent keys:
   - Add `"/api-key/create"` and `"/api-key/update"` to `disabledPaths`. That blocks the HTTP routes only; `auth.api.createApiKey` still works in-process [verified in router source].
   - Wrap creation in our own `/v1` endpoint.
5. **Verifications write to the DB** (`requestCount`/`lastRequest`) when rate limiting is on. That is a write per agent request. Consider `deferUpdates: true` with `advanced.backgroundTasks`, or disable per-key rate limiting for trusted integrations.
6. **The default hasher is SHA-256 → base64url (no padding).** Our `api_tokens.token_hash` is SHA-256 → hex, the _same digest_, so existing tokens migrate by re-encoding (see §4.4).

### 3.3 bearer and jwt (mobile and bots)

**bearer:**

- On sign-in the response carries `set-auth-token`. Clients send `Authorization: Bearer <token>`.
- The plugin turns that into a session cookie for `getSession` [verified].
- Bearer values that are not session tokens are ignored (HMAC check fails silently) [verified in source]. So it coexists with API keys and JWTs on the same header.
- **For bots and integrations, prefer API keys** over long-lived session tokens.

**jwt:**

- Adds `/jwks` plus `/token` / `set-auth-jwt`.
- **When the OAuth provider or MCP is on, the docs require `disabledPaths: ["/token"]` and `jwt({ disableSettingJwtHeader: true })`** [docs; applied in the prototype].

**expo plugin:**

- Stores the cookie in SecureStore.
- `await authClient.getCookie()` is async since 1.7. Send it as a `Cookie` header with `credentials: "omit"` [docs].
- Bearer is the simpler alternative.

### 3.4 magic-link and email-otp [verified send path]

- `magicLink({ sendMagicLink: ({ email, url, token }, ctx) => … })`. Options include `disableSignUp`, `storeToken`.
- `emailOTP({ sendVerificationOTP: ({ email, otp, type }) => … })`. `type` is `sign-in | email-verification | forget-password | change-email`.
- The docs advise not awaiting the send, to avoid timing attacks. Use `void mailer.send(...).catch(log)`, or `advanced.backgroundTasks`.

### 3.5 GitHub, Slack and Discord sign-in → automatic attribution

`account(providerId, accountId, userId)` holds the provider-confirmed subject [verified in provider source]:

- **GitHub:** `accountId = profile.id` (the **numeric** user ID). Our connector currently matches on `sender.login` (lowercased).
- **Slack:** `accountId = profile["https://slack.com/user_id"]`. This matches `event.user` / `user_id`. Uses OpenID scopes `openid profile email`.
- **Discord:** `accountId = profile.id` (snowflake). This matches `interaction.member.user.id`. Scopes `identify email`.

**How the attribution works:**

- **Yes, a sign-in or link can drive attribution, with no sync code needed.** Extend `memberByIdentity(ws, provider, externalId)`:
  1. Check `identities` first (manual links, agents).
  2. Then fall back to `account JOIN members ON members.user_id = account.user_id AND members.workspace_id = ws`.
- **Alternatively,** use `databaseHooks.account.create.after` (types verified: `databaseHooks.{user,session,account,verification}.{create,update,delete}.{before,after}`) to upsert `identities` rows for each workspace the user belongs to. Also copy them in `afterAddMember`.
- **For GitHub, switch attribution to `sender.id`** (numeric, stable across renames). Keep `login` as `externalHandle`. Webhook payloads carry both.

**Linking settings:**

- Use `account.accountLinking.trustedProviders` to link providers on matching emails.
- Linking to a signed-in user goes through `linkSocial`.
- Optionally use `account.encryptOAuthTokens: true` for stored provider tokens.
- Not run live (no OAuth apps). **[unverified end to end]**

### 3.6 External AI agents: OAuth provider, MCP, device grant, CIMD, agent-auth

**`@better-auth/oauth-provider`** (OAuth 2.1 / OIDC). Grants:

- `authorization_code` with S256 PKCE.
- `refresh_token`.
- `client_credentials`: fail-closed; it needs admin-assigned `client_credentials_scopes`.
- `device_code` via `oauthDeviceAuthorization()`.

Other features:

- RFC 8707 resources, so tokens are audience-bound.
- DPoP, `private_key_jwt`.
- DCR (off by default), introspection and revocation.
- Tokens can carry an org via `postLogin.consentReferenceId` and `customAccessTokenClaims`.

**`@better-auth/mcp`:**

- `mcp({ loginPage, consentPage, resource, scopes })` _is_ the OAuth provider. Don't add `oauthProvider()` as well.
- Serves RFC 9728 metadata.
- `requireMcpAuth(auth, handler, { resource, requiredScopes })` wraps an MCP SDK v2 `createMcpHandler` POST handler. It verifies the JWT locally against JWKS and returns RFC 9728 `401`/`403 insufficient_scope` challenges.
- `@better-auth/cimd` (`metadataProfile: "mcp-2026-07-28"`) is the recommended client identity. DCR is opt-in for older clients (Cursor, older Claude Code), via `allowDynamicClientRegistration` + `allowUnauthenticatedClientRegistration` + `clientRegistrationDefaultApplicationType: "infer"`.

**Device grant for a `worklog` CLI or agent login [verified end to end]:**

1. `adminCreateOAuthClient` (with a session) creates a public client (`token_endpoint_auth_method: "none"`, `grant_types: [DEVICE_CODE_GRANT_TYPE, "refresh_token"]`, `resources: [resource]`).
2. `POST /device/code` returns a `user_code`.
3. The signed-in human calls **`GET /device?user_code=…`** first to claim the code, then `POST /device/approve`. The claim step is required in 1.7.13 and returned 400 without it.
4. `POST /oauth2/token` (device_code grant) returns a JWT access token plus a refresh token.
5. `verifyAccessTokenRequest` from `better-auth/oauth2` checks issuer, audience and scope. A missing scope is rejected as `insufficient_scope`. Claims include `sub` (the user, `usr_…`), `client_id`/`azp`, `scope` and `aud`.
6. Two caveats:
   - The docs' example passes `type: "native"`, but the oauth-provider docs say `type` was removed. I created the client without it.
   - **1.8 replaces `/device/approve` with `/oauth2/authorize?user_code=`.**

**`@better-auth/agent-auth` 0.6.2** (Agent Auth Protocol, `github.com/better-auth/agent-auth`):

- Discovery at `/.well-known/agent-configuration`.
- Agent registration, delegated and autonomous modes, capability grants.
- Device or CIBA approval, short-lived signed JWTs, an OpenAPI adapter (`createFromOpenAPI`), an MCP adapter, and `auth.api.getAgentSession({ headers })`.
- It is strategically interesting (it's Vercel's stated focus and maps well onto our "agent members" idea), **but the docs mark it unstable**. It is versioned outside the lockstep release train, and we didn't test it. Re-evaluate at 1.0.

### 3.7 Other plugins and features

- **admin:** adds `user.role`, `banned`, `banReason`, `banExpires`, `session.impersonatedBy` [verified schema]. Useful for Worklog-operator (platform) admin, not for workspace roles.
- **multiSession:** optional.
- **Rate limiting:** core rate limiting covers only `/api/auth/*`. It is in-memory by default and off in development. For several API replicas, use `rateLimit: { storage: "database" }` [docs]. Our `/v1` routes need their own limiter, apart from the per-key limits applied by `verifyApiKey`.
- **Hooks:**
  - `databaseHooks.*.before` can return `false` or a replacement `{ data }`, or throw `APIError`.
  - `after` hooks run after commit when transactions are enabled [docs].
  - `user.validateUserInfo(data, ctx)` can reject sign-ups or links. Use it, or `emailAndPassword.disableSignUp` / `magicLink({ disableSignUp })`, to make workspaces invite-only.
- **Telemetry** defaults to `false` [verified type].

---

## 4. Integration plan for Worklog

### 4.1 Table mapping

| Better Auth model | Table | Owned by | Notes |
| --- | --- | --- | --- |
| `user` | `user` | BA | **Humans only.** Global identity (email unique, required). |
| `session` | `session` | BA | + `active_organization_id` (+ `active_team_id` if teams) (+ `impersonated_by` with admin). |
| `account` | `account` | BA | Password and social accounts; feeds attribution (§3.5). |
| `verification` | `verification` | BA | Magic link, OTP and email verification tokens. |
| `organization` | **`workspaces`** (modelName) | Shared | BA writes `name, slug, logo, metadata, created_at`; Worklog fields come in as `additionalFields` (`timezone`, `entropy_days`, `card_seq` with `input:false`). Generated definition replaces ours. |
| `member` | `member` (or rename to `memberships`) | BA | Human membership and **role (source of truth for humans)**. |
| `invitation` | `invitation` | BA | Our mailer sends it; link `/invite/:id`. |
| `team`, `teamMember` | — | — | Leave teams off (users only). |
| `apikey` | `apikey` | BA | Replaces `api_tokens`. Configs: `default` (personal, `wl_`) and `agent` (org-owned, `wla_`). |
| `jwks` | `jwks` | BA | Needed with jwt/oauth (phase 3). |
| `oauthClient`, `oauthResource`, `oauthClientResource`, `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent`, `oauthClientAssertion`, `deviceCode` | same names (snake_case) | BA | Phase 3 only. |
| — | **`members`** | Worklog | **The actor profile for humans _and_ agents.** Add `user_id text NULL` (null for agents) and a unique index on `(workspace_id, user_id)`. Keep `kind`, `handle`, `owner_id`, `agent_provider`, `settings`, `timezone`. `role` is mirrored from BA `member.role` for humans by hooks, and set directly for agents. `email`/`name` for humans come from `user` (mirror or join). |
| — | **`identities`** | Worklog | Manual links, agent links, and (phase 3) OAuth-client → agent links (`provider: "oauth"`, `external_id: "<client_id>:<user_id>"`). Social sign-ins resolve through `account`. |
| — | `api_tokens` | — | Dropped after migration (§4.4). |

**Should humans be BA users and `members` a profile keyed by (organizationId, userId)?**

- **Yes.** That's what the prototype does, and it passed.
- Every `members` FK in the app (cards, activities, attention…) stays as is. Only the auth path changes.

**How do agents authenticate?**

- **They are not BA users.**
- **Worklog-run agents** (personal assistants, automations) need no credential; server code acts as the member.
- **Headless or autonomous agents and integrations** (CI bots, Slack or Discord bot processes, scripts, OpenClaw/Devin-style workers):
  - They use **org-owned API keys** (`configId: "agent"`, `metadata.memberId`, `permissions`, `expiresIn`, per-key rate limits).
  - Keys are **created only by our endpoint** (e.g. `POST /v1/members/:id/keys`), which checks that the caller is an owner/admin or the agent's owner.
- **Delegated coding agents** acting for a human (Claude Code, Cursor, Codex, via MCP or our CLI):
  - They use **OAuth access tokens** (MCP authorization code + PKCE with CIMD, or the device grant), audience-bound to our API.
  - Middleware maps `(workspace, sub = human user, client_id)` to an agent member with `owner_id` = the human's member. The agent is auto-provisioned on first use, named after the client and labelled with `agent_provider`.
  - Activity is attributed to the agent, and the permission ceiling is the human's role intersected with the token scopes.
- **Not recommended: "synthetic users" for agents** (fake `.invalid` emails, so that BA org endpoints and `hasPermission` cover agents). It pollutes `user`, interacts badly with email flows and account linking, and buys little, because Worklog already has its own authorization layer. _[design judgment]_

### 4.2 Request flow: one Hono middleware that yields our `member` [verified, `tsc` clean]

**API key** (`Authorization: Bearer wl_…` / `wla_…`):

- `auth.api.verifyApiKey({ body: { key } })`.
- `configId === "agent"`: load `metadata.memberId` and check that the workspace matches.
- Otherwise it's a personal key: (`x-worklog-workspace`, `referenceId` = user) → human member.

**JWT** (Bearer with 3 segments; a signed session token has only 1 dot):

- `verifyAccessTokenRequest(...)`.
- Map (sub, client_id, org claim) → agent member.

**Session cookie, or Bearer session token** (web, mobile):

- `auth.api.getSession({ headers })`.
- Workspace comes from the `x-worklog-workspace` header, or `session.activeOrganizationId`.
- (workspace, user.id) → human member.

**Result:** `c.set("principal", { member, via, userId, permissions })`.

```ts
// src/auth/middleware.ts (trimmed from the verified prototype)
export const requireMember = createMiddleware<Env>(async (c, next) => {
  const { auth, db } = c.get("ctx");
  const bearer = c.req
    .header("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1]
    ?.trim();

  if (bearer?.startsWith("wla_") || bearer?.startsWith("wl_")) {
    const res = await auth.api.verifyApiKey({ body: { key: bearer } }); // needs a config named "default"
    if (!res.valid || !res.key)
      return c.json({ error: "invalid_api_key" }, 401);
    const k = res.key;
    const m =
      k.configId === "agent"
        ? await memberById(
            db,
            (k.metadata as { memberId?: string } | null)?.memberId
          )
        : await humanMember(
            db,
            c.req.header("x-worklog-workspace"),
            k.referenceId
          );
    if (!m || (k.configId === "agent" && m.workspaceId !== k.referenceId))
      return c.json({ error: "forbidden" }, 403);
    c.set("principal", {
      member: m,
      via: "api_key",
      userId: m.userId,
      permissions: k.permissions ?? null,
    });
    return next();
  }

  if (bearer && bearer.split(".").length === 3) {
    // OAuth / MCP access token (phase 3)
    const claims = await verifyAccessTokenRequest(
      requestToResourceInput(c.req.raw),
      {
        verifyOptions: {
          issuer: `${PUBLIC_URL}/api/auth`,
          audience: `${PUBLIC_URL}/mcp`,
        },
        jwksUrl: `${PUBLIC_URL}/api/auth/jwks`,
      }
    ).catch(() => null);
    if (!claims?.sub) return c.json({ error: "invalid_token" }, 401);
    const m = await agentForOAuthClient(db, claims); // upsert agent member owned by the human
    c.set("principal", {
      member: m,
      via: "oauth",
      userId: claims.sub,
      scopes: String(claims.scope).split(" "),
    });
    return next();
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const ws =
    c.req.header("x-worklog-workspace") ?? session.session.activeOrganizationId;
  const m = await humanMember(db, ws, session.user.id);
  if (!m) return c.json({ error: "no_membership" }, 403);
  c.set("principal", { member: m, via: "session", userId: session.user.id });
  return next();
});
```

### 4.3 Auth config sketch [verified in the prototype; Worklog wiring is a sketch]

```ts
import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { expo } from "@better-auth/expo";
// src/auth/index.ts — built in createContext() after openDb(), stored as ctx.auth
import { betterAuth } from "better-auth";
import {
  bearer,
  emailOTP,
  magicLink,
  openAPI,
  organization,
} from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

const PREFIX: Record<string, string> = {
  // generateId receives *logical* model names [verified]
  user: "usr",
  session: "ses",
  account: "acc",
  verification: "ver",
  organization: "ws",
  member: "om",
  invitation: "inv",
  team: "team",
  teamMember: "tm",
  apikey: "key",
  jwks: "jwk",
  oauthClient: "oac",
  oauthResource: "ors",
  oauthClientResource: "ocr",
  oauthRefreshToken: "ort",
  oauthAccessToken: "oat",
  oauthConsent: "ocs",
  deviceCode: "dvc",
};

export const ac = createAccessControl({
  ...defaultStatements,
  apiKey: ["create", "read", "update", "delete"],
} as const);
const roles = {
  owner: ac.newRole({
    ...ownerAc.statements,
    apiKey: ["create", "read", "update", "delete"],
  }),
  admin: ac.newRole({
    ...adminAc.statements,
    apiKey: ["create", "read", "update", "delete"],
  }),
  member: ac.newRole({ ...memberAc.statements, apiKey: ["read"] }),
};

export function createAuth(ctx: Pick<AppContext, "db" | "mailer" | "config">) {
  const mail = (to: string, subject: string, text: string) =>
    void ctx.mailer
      .send({ to, subject, text, html: `<p>${text}</p>` })
      .catch((e) => console.error("[auth mail]", e));
  return betterAuth({
    appName: "Worklog",
    baseURL: ctx.config.PUBLIC_URL, // basePath defaults to /api/auth
    secret: ctx.config.BETTER_AUTH_SECRET, // new env var (or `secrets: [...]` for rotation)
    trustedOrigins: [ctx.config.WEB_ORIGIN, "worklog://"],
    disabledPaths: ["/api-key/create", "/api-key/update"], // keys are minted via /v1 only (metadata is client-writable)
    database: drizzleAdapter(ctx.db, { provider: "pg", transaction: true }),
    advanced: {
      database: { generateId: ({ model }) => newId(PREFIX[model] ?? "x") },
    }, // widen IdPrefix
    session: { cookieCache: { enabled: true, maxAge: 60 } },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) =>
        mail(user.email, "Verify your email", url),
    },
    socialProviders: {
      github: {
        clientId: ctx.config.GITHUB_CLIENT_ID!,
        clientSecret: ctx.config.GITHUB_CLIENT_SECRET!,
      },
      slack: {
        clientId: ctx.config.SLACK_CLIENT_ID!,
        clientSecret: ctx.config.SLACK_CLIENT_SECRET!,
      },
      discord: {
        clientId: ctx.config.DISCORD_CLIENT_ID!,
        clientSecret: ctx.config.DISCORD_CLIENT_SECRET!,
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["github", "slack", "discord"],
      },
      encryptOAuthTokens: true,
    },
    plugins: [
      organization({
        ac,
        roles,
        requireEmailVerificationOnInvitation: true,
        schema: {
          organization: {
            modelName: "workspaces",
            additionalFields: {
              timezone: {
                type: "string",
                required: false,
                defaultValue: "UTC",
              },
              entropyDays: {
                type: "number",
                required: false,
                defaultValue: 30,
              },
              cardSeq: {
                type: "number",
                required: true,
                defaultValue: 0,
                input: false,
                returned: false,
              },
            },
          },
        },
        sendInvitationEmail: async (d) =>
          mail(
            d.email,
            `Join ${d.organization.name} on Worklog`,
            `${d.inviter.user.name} invited you: ${ctx.config.WEB_ORIGIN}/invite/${d.id}`
          ),
        organizationHooks: {
          afterAddMember: async ({ member, user }) => {
            await ensureHumanMember(ctx, member, user);
          }, // creator + addMember
          afterAcceptInvitation: async ({ member, user }) => {
            await ensureHumanMember(ctx, member, user);
          }, // NOT covered by afterAddMember
          afterUpdateMemberRole: async ({ member }) => {
            await mirrorRole(ctx, member);
          },
          afterRemoveMember: async ({ member }) => {
            await deactivateHumanMember(ctx, member);
          },
        },
      }),
      apiKey([
        {
          configId: "default",
          defaultPrefix: "wl_",
          references: "user",
          rateLimit: { enabled: false },
        },
        {
          configId: "agent",
          defaultPrefix: "wla_",
          references: "organization",
          enableMetadata: true,
          keyExpiration: { defaultExpiresIn: null },
          rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 600 },
        },
      ]),
      bearer(),
      magicLink({
        sendMagicLink: async ({ email, url }) =>
          mail(email, "Sign in to Worklog", url),
      }),
      emailOTP({
        sendVerificationOTP: async ({ email, otp }) =>
          mail(email, "Your Worklog code", otp),
      }),
      expo(),
      openAPI(),
      // phase 3: jwt({ disableSettingJwtHeader: true }), mcp({...}), cimd({...}), oauthDeviceAuthorization({...}) + disabledPaths "/token"
    ],
  });
}
```

`ensureHumanMember()` is our existing `createMember()` logic, re-keyed. It does the following and is idempotent on `(workspace_id, user_id)` (prototype version verified):

- Inserts the `members` row with `user_id` set.
- Creates the personal assistant.
- Creates the email delivery target.
- Creates the default automations.

**`POST /v1/setup` becomes** (it still returns `{ workspace, member, assistant, token }`):

1. `auth.api.signUpEmail(...)` (or a magic-link-only path).
2. `auth.api.createOrganization({ body: { name, slug, userId } })`. This is server-side with no headers, and fires `afterAddMember`.
3. `auth.api.createApiKey({ body: { userId } })`, which issues a personal `wl_` key.

### 4.4 Migrating from `api_tokens` (and existing members)

1. **Schema migration** (drizzle-kit): add the BA tables; add `workspaces.logo` and `workspaces.metadata`; add `members.user_id` with a unique index on `(workspace_id, user_id)`.
2. **Users:**
   - Create one `user` per distinct human `members.email`, with `email_verified = true` for existing owners if you trust them.
   - **Humans without an email** need one, because `user.email` is required and unique. Collect one, or use a placeholder that must be replaced on first login.
3. **Memberships:**
   - Insert `member(organization_id = workspace_id, user_id, role)` for each human.
   - Set `members.user_id`.
4. **Tokens** — same digest, re-encoded. No reissue is needed [verified in JS and in Postgres SQL, 200/200 hashes]:

```sql
INSERT INTO apikey (id, config_id, name, prefix, reference_id, key, enabled, rate_limit_enabled,
                    request_count, metadata, last_request, created_at, updated_at)
SELECT t.id,                                                   -- keep tok_… ids
       CASE WHEN m.kind = 'agent' THEN 'agent' ELSE 'default' END,
       t.name, 'wl_',
       CASE WHEN m.kind = 'agent' THEN t.workspace_id ELSE m.user_id END,
       rtrim(translate(encode(decode(t.token_hash, 'hex'), 'base64'), '+/', '-_'), '='),
       t.revoked_at IS NULL, false, 0,
       CASE WHEN m.kind = 'agent' THEN json_build_object('memberId', m.id)::text END,
       t.last_used_at, t.created_at, now()
FROM api_tokens t JOIN members m ON m.id = t.member_id;
```

Notes on the token migration:

- A legacy `wl_…` agent token stored under config `agent` verified as valid, with `metadata.memberId`, as long as a `"default"` config exists [verified].
- A migrated personal `wl_` token authenticated through the middleware [verified].
- Store `metadata` as single-encoded JSON text. BA has a fix-up for double-stringified values.

5. **Code:**
   - Replace `authenticate()`, `createToken()` and `revokeToken()` with `verifyApiKey`, `createApiKey` and `deleteApiKey` (server-side) wrappers.
   - Keep the `/v1` API surface the same.
   - Drop `api_tokens` once traffic is clean.
6. **Identities:**
   - Keep the table.
   - Add the `account` fallback in `memberByIdentity`.
   - Migrate GitHub identities from login to numeric ID. The `login` can be resolved via the GitHub API, or backfilled from the next webhook carrying both.

### 4.5 Phasing

- **Phase 1:** core + organization (workspaces) + api-key + bearer + magic-link/email-OTP + expo + openAPI; middleware; setup; token migration.
- **Phase 2:** GitHub, Slack and Discord sign-in and linking; attribution through `account`.
- **Phase 3:** OAuth provider/MCP + device grant (+ CIMD with a Bun-safe transport) for external agents, after **1.8 is stable**.

---

## 5. Risks and gotchas

1. **Release churn in OAuth/MCP.**
   - `oidcProvider` removed in 1.7.
   - MCP moved packages.
   - The `account.issuer` regression (1.7.0–1.7.2).
   - 1.8 moves device approval and adds columns.
   - Mitigation: pin exact versions; upgrade all packages together with `bunx auth upgrade`; regenerate the schema and run `auth check schema` in CI; put OAuth/MCP work behind phase 3.
2. **Security cadence.** Multiple High/Critical advisories in 2026, including one that hit exactly "magic link + social provider + DB state" (fixed in 1.7.7). We need advisory monitoring and fast patching. This is still likely better than hand-rolling OAuth, magic links and invites. _[judgment]_
3. **Schema ownership.**
   - BA's tables live in a generated Drizzle file that we must regenerate, not hand-edit. The exception is an optional `timestamptz` post-process.
   - Mapping `organization` → `workspaces` means BA's generated definition becomes the canonical one for that table, so all workspace columns must be declared as `additionalFields`.
   - Runtime validation blocks auth requests on mismatch. That is good as a guard and painful if forgotten.
4. **PGlite quirks.**
   - None hit. Everything passed on PGlite, with and without `transaction: true`, using timestamptz.
   - PGlite serializes queries (single connection), so it's fine for dev/tests.
   - BA's org hooks used `ctx.db` while the adapter had `transaction: true`, and nothing deadlocked even on a 1-connection Bun SQL pool.
   - Real Postgres was not tested _[unverified, low risk]_.
5. **ID formats.**
   - `advanced.database.generateId: ({ model }) => newId(prefix)` works; we get `usr_…`, `ws_…`, `inv_…`, `key_…` [verified].
   - Widen `IdPrefix`.
   - OAuth `client_id`s and token values stay BA-generated random strings, which is fine.
   - Consequence: invitation acceptance requires a verified email (keep it that way).
6. **Email.** Every flow (invitations, magic link, OTP, verification, reset) is a callback, so wiring to `ctx.mailer` (Resend/SMTP/console) is trivial and the `ConsoleMailer` keeps tests offline [verified]. Don't await sends (timing). From 1.8, sign-up emails fire after DB writes.
7. **API-key quirks** (§3.2): the `"default"` config requirement; permission denial reported as `KEY_NOT_FOUND` plus an ERROR log; client-writable `metadata`; a DB write per verification.
8. **Agents can't be org members** (`member.user_id NOT NULL → user`). Our authorization for agents stays in Worklog, which it already is.
9. **Session reads:** `getSession` hits the DB on every request unless `cookieCache` is on. Bearer/mobile requests always hit it.
10. **CIMD on Bun:** officially needs a custom transport; the Node one works functionally but its pinning guarantee is unverified (§2.3).
11. **Vercel ownership:** MIT, and stated to be framework-agnostic, but the roadmap is now Vercel-aligned (Agent Auth, Vercel Connect/Passport). _[soft risk]_

---

## 6. Verification log (scratch prototype, not in this repo)

**`src/e2e.ts`** — 19/19 PASS with `DB_MODE=pglite` and with `DB_MODE=bunsql` (drizzle-orm/bun-sql → pglite-socket). It covers:

- Sign-up (`usr_` IDs), and the `set-auth-token` header.
- `organization/create` into the `workspaces` table (`ws_`, `timezone` additional field). `afterAddMember` created the human member and the assistant.
- `/v1/me` via cookie, via Bearer session token, via agent API key (`wla_`, org-owned, `metadata.memberId`), and via a migrated legacy `wl_` token.
- Permission check on a key.
- Invitation email (`inv_`): accept blocked until the email was verified, then accepted. `afterAcceptInvitation` created the member and the assistant.
- Email-OTP and magic-link sends through the mailer.
- `generateOpenAPISchema` (3.1.1, 126 paths).
- RFC 9728 / RFC 8414 metadata.

**Other scripts and checks:**

- **`src/e2e-device.ts`:** 7/7 PASS. Public OAuth client → `/device/code` → claim → approve → `/oauth2/token` → `verifyAccessTokenRequest` (iss/aud/scope OK; missing scope rejected).
- **`src/apikey-default.ts`:** a no-`configId` verify works for personal, agent and legacy agent keys once a `"default"` config exists.
- **`src/zod-openapi-mount.ts`:** mounting on `OpenAPIHono`; a single zod 4.6.7 install.
- **`src/cimd-bun-test.ts`:** the CIMD Node transport under Bun.
- **`src/sql-b64.ts`:** the SQL hex→base64url conversion matches 200/200.
- **`bunx auth generate`, `bunx drizzle-kit generate`, `bunx auth check schema` and `bunx tsc --noEmit`:** all clean.

---

## 7. Not verified / open questions

- Live GitHub/Slack/Discord OAuth sign-in and linking. This includes multiple Slack accounts (from several Slack teams) for one user.
- A real MCP client (authorization code + PKCE + CIMD) against `mcp()` + `requireMcpAuth`.
- Expo client behaviour.
- `rateLimit.storage: "database"`.
- Admin and multi-session runtime behaviour.
- Renaming `member` → `memberships` (same mechanism as the verified `organization` rename).
- Behaviour on production Postgres (only PGlite, directly or via socket, was tested).
- Bun's `node:https` honouring CIMD address pinning.
- Agent Auth plugin.
- The 1.8 changes beyond the release notes.

---

## Sources

- npm: https://www.npmjs.com/package/better-auth · downloads API https://api.npmjs.org/downloads/point/last-week/better-auth
- Repo and license: https://github.com/better-auth/better-auth · advisories https://github.com/better-auth/better-auth/security/advisories · GHSA-965c-763c-88jm https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm
- 1.8.0-beta.0 notes: https://github.com/better-auth/better-auth/releases/tag/v1.8.0-beta.0
- Blog:
  - Seed round: https://better-auth.com/blog/seed-round
  - Auth.js joins: https://better-auth.com/blog/authjs-joins-better-auth
  - Joining Vercel: https://better-auth.com/blog/better-auth-joins-vercel
  - 1.7: https://better-auth.com/blog/1-7
  - 1.7 account change: https://better-auth.com/blog/1-7-account-schema
  - June 2026 security update: https://better-auth.com/blog/security-update-june-2026
  - 1.7 RC discussion: https://github.com/better-auth/better-auth/discussions/10250
- Docs:
  - Hono: https://better-auth.com/docs/integrations/hono
  - Drizzle: https://better-auth.com/docs/adapters/drizzle
  - Database (IDs, hooks, schema validation): https://better-auth.com/docs/concepts/database
  - CLI: https://better-auth.com/docs/concepts/cli
  - Sessions: https://better-auth.com/docs/concepts/session-management
  - Rate limit: https://better-auth.com/docs/concepts/rate-limit
  - Hooks: https://better-auth.com/docs/concepts/hooks
  - Organization: https://better-auth.com/docs/plugins/organization
  - API key: https://better-auth.com/docs/plugins/api-key · advanced https://better-auth.com/docs/plugins/api-key/advanced · reference https://better-auth.com/docs/plugins/api-key/reference
  - Bearer: https://better-auth.com/docs/plugins/bearer
  - JWT: https://better-auth.com/docs/plugins/jwt
  - Magic link: https://better-auth.com/docs/plugins/magic-link
  - Email OTP: https://better-auth.com/docs/plugins/email-otp
  - Social providers: https://better-auth.com/docs/authentication/github · https://better-auth.com/docs/authentication/slack · https://better-auth.com/docs/authentication/discord
  - Open API: https://better-auth.com/docs/plugins/open-api
  - OAuth provider: https://better-auth.com/docs/plugins/oauth-provider
  - MCP: https://better-auth.com/docs/plugins/mcp
  - Device authorization: https://better-auth.com/docs/plugins/device-authorization
  - CIMD: https://better-auth.com/docs/plugins/cimd
  - Agent Auth: https://better-auth.com/docs/plugins/agent-auth (repo https://github.com/better-auth/agent-auth, protocol https://agentauthprotocol.com)
  - Expo: https://better-auth.com/docs/integrations/expo
  - Admin: https://better-auth.com/docs/plugins/admin
  - Multi-session: https://better-auth.com/docs/plugins/multi-session
  - 1.7 upgrade guide: https://better-auth.com/docs/guides/1-7-upgrade-guide
- Third-party funding coverage (consistent with the official post): https://launchbaseafrica.com/2025/06/26/rare-african-solo-founder-behind-better-auth-raises-5m-to-rethink-developer-authentication/
