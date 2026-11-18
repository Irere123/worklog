# AGENTS.md

Rules for AI agents and humans working on Worklog. `CLAUDE.md` imports this file.

Worklog is an API-first work-visibility server with a web app (`apps/web`) on top. Connectors turn GitHub, Gitea, Slack, Discord and webhook events into one activity stream, which feeds a board, an attention queue, briefs and a personal assistant for each member. Background: [README.md](README.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## No comments

This is the rule agents break most. Lint enforces it ([landmines](https://github.com/interfere-inc/landmines) `no-comments`).

Code carries its meaning in names and structure; the reason for a change goes in the commit and the PR. The only comments allowed:

- functional directives, with a reason on every suppression: `// oxlint-disable-next-line <rule> -- <reason>`, `@ts-expect-error`;
- a single-line `// WARNING:` for a dangerous footgun that keeps recurring;
- TSDoc on exported public API.

If code seems to need a comment, rename or extract instead. The same rules apply to commit messages and PR descriptions: say why, never narrate.

## Commands

Run from the repo root unless noted. Bun only: no npm, yarn, pnpm or other lockfiles.

```bash
bun install            # dependencies and git hooks
bun run dev            # API on :4000 and web app on :3000; needs Postgres (DATABASE_URL in apps/api/.env)
bun run seed           # fills an empty server with a demo team and prints its API key
bun run test           # files in parallel and random order; each worker recreates worklog_test_<n>
bun run typecheck
bun run lint           # `bun run lint:fix` applies safe fixes
bun run format         # `bun run format:check` only checks

cd apps/api
bun run test test/board.test.ts   # one file
bun run db:generate               # migration after editing src/db/schema.ts
bun run db:generate --custom --name=<name>   # empty migration for hand-written SQL
bun run auth:generate             # regenerates src/db/auth-schema.ts after editing src/lib/auth.ts
bun run openapi                   # prints the spec

cd apps/web
bun run api:generate              # src/api/schema.d.ts from the API's spec, after changing a route or schema
bun run contrast                  # checks the colour tokens meet WCAG contrast in light and dark
bun run design                    # the design rules in docs/DESIGN.md; part of `bun run lint`
```

Work is done when `format:check`, `lint`, `typecheck` and `test` pass. CI runs the same four.

## Layout

```
apps/api/src/
  http/          routes/ and schemas/ (one file per resource), auth, webhooks, install redirects
  connectors/    one file per tool (+ a folder when it grows): mapping, app install, sync
  ingest/        delivery to activity: inbox, lanes, ledger, identity, effects, sync, apps
  work/          activity, board, drift, attention, manual logs, snapshots, members
  automations/   scheduled routines, briefs, delivery
  agent/         all model work: loop, generate, prompts/, tools/, memory/
  jobs/          Graphile Worker tasks and cron
  emails/        React Email templates: sign-in, invite, brief
  db/            schema, queries/ (one file per area), transact
  lib/           shared helpers and Better Auth
  events.ts      the event bus
  context.ts     AppContext, built once per process
  config.ts      the only reader of environment variables
apps/api/test/   harness.ts plus one file per area, for tests through the HTTP API

apps/web/src/
  routes/        TanStack file routes, thin: validate search params, render a feature
  features/      one folder per surface: board, inbox, activity, assistant, briefs, people, settings, shell
  ui/            primitives (button, overlay, field, chip…) and tokens.stylex.ts, the design tokens
  api/           openapi-fetch client, generated schema, query factories, the live event stream
  lib/           theme and time helpers
```

## Where new code goes

| Adding | Put it in |
| --- | --- |
| an endpoint | `http/routes/<resource>.ts` and `http/schemas/<resource>.ts`, registered in `app.ts` |
| a query | `db/queries/<area>.ts` |
| domain logic | the module it belongs to, as a function taking `ctx` first |
| a prompt | `agent/prompts/<name>.md` |
| an assistant tool | `agent/tools/<name>.ts`, registered in `agent/tools.ts` |
| a connector | `connectors/<name>.ts`, registered in `connectors.ts` |
| a background task | `jobs/tasks.ts` |
| an email | `emails/<name>.tsx` on `Layout`, with a written text part, exported from `emails.ts` |
| an environment variable | `config.ts` and `apps/api/.env.example` |
| a web page | `apps/web/src/routes/<path>.tsx` rendering a component from `apps/web/src/features/<surface>/` |
| a web query | a factory in `apps/web/src/api/queries.ts`, keyed by resource |
| a colour, or a size or duration used in more than one place | a token in `apps/web/src/ui/tokens.stylex.ts` |

## Rules

- **Routes are thin.** Validate with zod, call one domain function or a read query, and return with `respond(c, Schema, row, status)`, never `c.json`. The parse turns dates into ISO strings, drops unlisted fields and throws on a wrong shape.
- **Schemas:** a base schema per entity (`Card`), request schemas that reuse its fields, and responses that are the base or `derived(Base, row => …)`. No `toX()` mappers. Never rename an `operationId`: it is the SDK method name.
- **Tenancy comes from the caller's `workspaceId`,** never from the request.
- **Privacy is enforced in queries,** never by a prompt. Teammate-facing reads and team delivery targets get `visibility = 'team'` data only.
- **One write path each:** `recordActivity`, `raiseAttention`, `appendMessages`.
- **Writes, jobs and events:** a job that must follow a write is enqueued inside the same `transact`. Events publish after the commit.
- **Inject the outside world:** `ctx.now()` and `ctx.fetch`, never `new Date()` or `fetch`.
- **Log through `log`** (`#telemetry/log`), never `console`: a fixed message, what varies in its fields, and never content (messages, payloads, prompts), since logs leave for Tinybird. Wrap work worth timing on its own in `traced()`.
- **AI is optional.** `ctx.models` is null without `OPENROUTER_API_KEY`, so every AI feature needs a fallback. Call models through `structured()` or `complete()` from `agent/generate.ts`, and render prompts with `prompt(name, vars)`.
- **The assistant never writes its own instructions.** No tool may change `constitution.md` or the owner's voice.
- **Helpers:** throw `notFound`, `forbidden`, `badRequest` or `conflict` from `lib/errors.ts`; use `returned()` for rows a write must return and `generateId(prefix)` for ids.
- **Never hand-edit** `drizzle/**` or `db/auth-schema.ts`. A custom migration's SQL is the one exception.

## Web app

Read [docs/DESIGN.md](docs/DESIGN.md) before building a screen: it covers who Worklog is to people, how it sounds, and the editor's pass a screen gets before it's done.

- **Styles are StyleX,** colocated at the bottom of each file and built from the tokens. Colours are `light-dark()` pairs; components never hard-code one.
- **Hover goes behind `media.hover`** (`":hover": { default: null, [media.hover]: value }`): a tap on a phone otherwise leaves it stuck. Presses get `:active`.
- **Icons are Phosphor,** imported with the `Icon` suffix (`TrayIcon`). The exception is a tool's own logo (GitHub, Slack…), which is `ProductMark` from `#ui/product-mark` in its real colours; add new tools there. A badge that says where something stands takes `status`, which gives it a filled glyph of its own shape. No sparkles or purple to mean AI: show what the feature does.
- **Data goes through `#api/client` and `#api/queries`,** never a raw `fetch`. Writes are optimistic where a person would notice the wait, and roll back on error.
- **Shareable state lives in the URL** (the open card, filters, tabs) through `validateSearch`.
- **Every action has a keyboard path and a pointer path,** and every drag has a menu alternative.

## Database

- **Queries live in `db/queries/`,** one file per area with its row types, and no barrel file.
- **A query takes `db: DbOrTx` and one params object,** holds SQL only, and takes `now` as a param. Retry and job timing are the exception: they use the database's `now()`, the clock Graphile Worker schedules by.
- **Names say what comes back:** `find*` may return undefined, `get*` throws `notFound`, `list*` and `count*` read many, and `insert*`, `upsert*`, `update*`, `delete*` and `set*` write.
- **Reads can be called from anywhere** with `ctx.db`. Writes go through the domain function.
- **Related writes share `transact(ctx, async (tx) => …)`.** Pass `tx`, keep model calls and HTTP out, and run queries one at a time, never in `Promise.all`.
- **An index on an existing table** gets `.concurrently()` and a migration of its own.
- **Known constraint violations become 409s** with `violates(error, "<constraint>")`.
- **Lint bans `drizzle-orm` outside `db/`.** Better Auth and Graphile Worker reach Postgres directly by design.

## Connectors

- Try the `webhook` connector's mapping rules before writing code.
- Keep `normalize` pure, and build event ids from the source's ids, never delivery ids. A sync page must produce the same ids its webhooks do.
- Connector code never imports `ingest/`; it gets what it needs as arguments.
- Call providers through `connectors/http.ts`, so a dead token revokes the connection and a rate limit waits.
- Never trust a redirect's parameters in `completeInstall`: verify the installation with the provider.
- Add a fixture for every event you map or ignore. Details are in [docs/CONNECTORS.md](docs/CONNECTORS.md).

## Tests

- Test through the HTTP API with `testEnv()`. Each test creates its own workspace.
- A test that imports a module to test it sits beside that module in `src/` (`src/db/migrate.test.ts`) and imports the harness as `#test/harness`. A test that goes through the API stays in `apps/api/test/` and takes helpers such as `hmacHex` from the harness. Lint (`colocated-tests`) checks which is which.
- No retries, raised timeouts or fixed sleeps: await the event instead. The sleeps and timeouts already in place are counted per file in `oxlint.config.ts`; lower a count when you remove one.
- Use `scriptedModel()` for AI, `fetchStub()` for HTTP, and `env.drain()` after a webhook.
- Files run in parallel workers, in random order, and share their worker's process and database. So a test sets up everything it needs (its own workspace, its own app registration) and never counts on another test or file running first; a spy is restored in `finally`; and a test waits on the event it needs (the bus, a promise), never a sleep or a poll against a deadline. `test/after-each-file.ts` restores mocks and resets the shared context after every file.
- A failure under one seed is a real bug, not a flake: rerun with the `--seed` the run printed until you find it.
- To fix a failing test, fix the code, not the assertion.

## Code style

oxfmt and oxlint enforce the style: [Ultracite](https://www.ultracite.ai)'s presets and every [landmines](https://github.com/interfere-inc/landmines) rule. Our departures are in `oxlint.config.ts`.

- **`type`, not `interface`,** because shapes flow into jsonb columns.
- **Top-level functions are declarations.** Exports go first, helpers below.
- **Return types are inferred.** Pin a contract at the return site with `satisfies T`, or with a typed local when callers need the wider type. Type predicates and `never` are the exceptions.
- **Keys are ordered for the reader,** not sorted.
- **Imports:** `#` aliases across folders, `./` within one, never `../`. Aliases resolve to files, so a folder's loader is a file of the same name beside it (`agent/tools.ts` for `agent/tools/`).
- **Fix lint findings.** Suppress one line only, with a reason.

## Commits and docs

- Conventional Commits, checked by commitlint: `type(scope): subject`, lowercase, no final period.
- Keep messages short, one logical change per commit, and never use `--no-verify`.
- When you change something documented, update `docs/ARCHITECTURE.md`, `docs/CONNECTORS.md` or the README in the same change.
- **PR descriptions put judgment first and detail second.** An agent's full write-up is accurate but tiring, and a reviewer first needs to know whether the PR deserves their attention. So:
  - Open with one short paragraph: the least a reviewer must read to know what changed and why. Add a screenshot when the change shows on screen.
  - Put the full description (changes, migrations, checks) in a collapsed block, labelled with the model and effort that wrote it:

    ```md
    <details><summary>Claude Opus 5.5, high effort</summary>

    ## What changes

    …
    </details>
    ```

  - The person opening the PR owns the opener: rewrite it until it says what they would tell a reviewer. Leave a blank line after `<summary>` so GitHub renders the Markdown inside.
