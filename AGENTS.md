# AGENTS.md

Rules for AI agents, and humans, working on Worklog. `CLAUDE.md` imports this file, so every agent reads the same rules.

Worklog is an open, API-first work-visibility server. Connectors turn GitHub, Gitea, Slack, Discord and webhook events into one activity stream, which feeds a board, an attention queue, briefs and a personal assistant for each member. Background: [README.md](README.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Comments: no narration

This is the rule agents break most. Follow it at all costs.

A comment says **why**: a constraint, trade-off or gotcha the code can't show. It never says **what** the code does, because the code already says that.

- **Don't restate the code:** `// loop over the events`, `// return the row`, `// Step 2: check the quota`.
- **Don't describe your change:** `// updated to use returned()`, `// now handles edits`, `// new helper`, `// fixed`. That belongs in the commit message.
- **Don't talk to the reader or reviewer:** `// as requested`, `// note: I changed…`, `// this function…`.
- **Don't leave commented-out code.**
- **If code needs a what-comment, fix the code instead:** rename, extract a function, or name the constant.

Keep the why-comments that exist: they stop the next agent from "fixing" something that is deliberate. When you change code a comment explains, update the comment in the same change. A stale comment is worse than none.

```ts
// Bad: narrates.
// Validate the kind with a regex
kind: z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/),

// Good: says why, and stops someone adding the `u` flag the linter asks for.
// Published in the OpenAPI spec, which can't carry regex flags.
kind: z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/),
```

The linter already enforces some of this:

- Comments go on their own line (`no-inline-comments`).
- `TODO` and `FIXME` fail lint (`no-warning-comments`): finish the work or open an issue.
- A lint suppression always gives its reason: `// oxlint-disable-next-line <rule> -- <reason>`.

The same goes for commit messages and PR descriptions: state the change and why, not the story of how you got there.

## Commands

Run these from the repo root unless noted. Use Bun only: no npm, yarn or pnpm, and no other lockfiles.

```bash
bun install            # dependencies and git hooks
bun run dev            # API on :4000; needs Postgres (DATABASE_URL in apps/api/.env)
bun run test           # all tests; recreates the worklog_test database (TEST_DATABASE_URL) each run
bun run typecheck
bun run lint           # oxlint, type-aware; `bun run lint:fix` applies safe fixes
bun run format         # oxfmt; `bun run format:check` only checks

cd apps/api
bun run test test/board.test.ts   # one test file
bun run db:generate               # migration after editing src/db/schema.ts
bun run auth:generate             # regenerates src/db/auth-schema.ts after editing src/auth/auth.ts
bun run openapi                   # prints the OpenAPI spec
```

Work is done when `format:check`, `lint`, `typecheck` and `test` all pass. CI runs the same four.

## Layout

```
apps/api/              the API server (Bun + Hono)
  src/
    api/               routes/ (one file per area), auth middleware, webhook entry (hooks.ts), shared schemas
    ingest/            the pipeline: normalize → identity → gates → card linking → persist → effects
    connectors/        github (+ gitea), slack, discord, webhook (no-code), custom; registry.ts lists them
    activity/          the activity stream, manual logs, snapshots
    board/             cards, columns, entropy, drift nudges
    attention/         "needs you": raise, collapse, quotas, feedback, actions
    automations/       scheduled routines: service.ts (CRUD), run.ts (execution), runners.ts (the routines)
    agent/             the assistant: prompts, tools, models, conversations
    jobs/              Graphile Worker: queue.ts (enqueue), worker.ts (tasks and cron)
    briefs/ memory/ delivery/ members/ auth/ events/
    db/                schema.ts (ours), auth-schema.ts (generated)
    lib/               small shared helpers: errors, ids, crypto, time, assert
    context.ts         AppContext: everything a handler needs, built once per process
    config.ts          the only place that reads environment variables
  test/                harness.ts plus one file per area
  drizzle/             generated migrations
docs/                  ARCHITECTURE.md, CONNECTORS.md, research notes
```

## Architecture rules

- **One domain per folder.** Each folder exports plain functions that take `ctx: AppContext` first.
- **Routes are thin.** A route validates with zod (`@hono/zod-openapi`), then calls a domain function. Every route has a stable dotted `operationId` such as `card.close`. It becomes the SDK method name, so never rename one.
- **Tenancy comes from the caller.** The workspace is the authenticated member's `workspaceId`. Never take a workspace id from the request.
- **Privacy is enforced in queries.** Teammate-facing reads filter `visibility = 'team'`. Never rely on a prompt to hide private data.
- **One write path per concept.** Write through these functions, never into their tables directly:
  - `recordActivity` for activity;
  - `raiseAttention` for attention items;
  - `appendMessages` for conversation messages.
- **Events after writes.** Publish to the event bus after the write it describes.
- **Background work goes through `enqueue`,** and each task is listed in `jobs/worker.ts`.
- **Inject the outside world.** Use `ctx.now()`, not `new Date()`, and `ctx.fetch` for outbound HTTP, so tests control time and the network.
- **AI is optional.** `ctx.models` is null when no `OPENROUTER_API_KEY` is set, so every AI feature needs a deterministic fallback. Models are called through the Vercel AI SDK with OpenRouter.
- **Config:** read environment variables only in `config.ts`, and add new ones to `apps/api/.env.example`.
- **Errors:** throw the helpers in `lib/errors.ts` (`notFound`, `forbidden`, `badRequest`, `conflict`). Use `returned()` from `lib/assert.ts` for rows an insert or update must return.
- **IDs:** use `newId(prefix)` from `lib/ids.ts`.
- **Generated files:** never hand-edit `apps/api/drizzle/**` or `src/db/auth-schema.ts`. Regenerate them with the commands above.

## Connectors

- Before writing code, check whether the `webhook` connector's mapping rules already cover the tool.
- Keep `normalize` pure: no database, no network.
- Build event ids from the source's own ids and timestamps, never from delivery ids, so redeliveries and replays dedupe.
- Add fixtures for every event you map and every event you deliberately ignore.
- Details are in [docs/CONNECTORS.md](docs/CONNECTORS.md).

## Tests

- Domain tests go through the HTTP API with `testEnv()` from `test/harness.ts`. Each test creates its own workspace.
- AI features use `scriptedModel()`, which plays back tool calls and answers. Outbound HTTP uses `fetchStub()`.
- After sending a webhook, call `env.drain()` to process the queue.
- To fix a failing test, fix the code; don't loosen the assertion.

## Code style

oxfmt and oxlint, with [Ultracite](https://www.ultracite.ai)'s presets, enforce the style, and the git hooks fix what they safely can. Our departures from the preset are in `oxlint.config.ts`, each with its reason. The ones you'll notice:

- **`type`, not `interface`:** shapes flow into jsonb columns typed `Record<string, unknown>`, and interfaces don't fit them.
- **Function declarations:** top-level functions are declarations, and arrows are for callbacks. Put exports first and helpers below them.
- **Key order is for the reader:** don't sort keys alphabetically.
- **Fix lint findings instead of silencing them.** Disable a rule for one line only when it really doesn't fit there, and give the reason.

## Commits

- Use Conventional Commits, checked by commitlint: `type(scope): subject`, with a lowercase subject and no final period. The types are `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert` and `style`.
- Keep messages short and concise, with one logical change per commit.
- Don't skip the hooks with `--no-verify`; fix what they report.

## Docs

When you change something documented, update the doc in the same change: `docs/ARCHITECTURE.md`, `docs/CONNECTORS.md` (including the supported tools table), or the README's feature list and quick start.
