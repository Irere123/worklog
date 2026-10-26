# Contributing to Worklog

Thanks for helping out! A few conventions keep the codebase easy to work in.

## Setup

```bash
bun install
bun run test        # ~40 s; no services needed (embedded Postgres, scripted AI model)
bun run typecheck   # strict TypeScript, no unused symbols
```

Bun is the package manager, runtime and test runner. Please don't add npm or yarn lockfiles.

## How the code is organized

- **One domain per folder** under `apps/api/src` (`board/`, `ingest/`, `attention/`…). Each exposes plain functions that take an `AppContext` first.
- **Routes are thin.** They live in `src/api/routes/`, validate with zod (which also generates the OpenAPI spec), and call domain functions. Give each a stable dotted `operationId` (`card.close`): it becomes the SDK method name.
- **One write path per concept:** `recordActivity`, `raiseAttention`, `appendMessages`. Don't insert into those tables directly.
- **Privacy is enforced in queries.** Teammate-facing code reads `visibility = 'team'` only. Never rely on a prompt to hide data.

## Database changes

Edit `src/db/schema.ts` and run `bun run db:generate` in `apps/api`. Better Auth's tables are generated: change `src/auth/auth.ts`, then run `bun run auth:generate`. Never hand-edit `src/db/auth-schema.ts`.

## Adding a connector

Read [docs/CONNECTORS.md](docs/CONNECTORS.md):

- **No code first.** If the tool only sends webhooks, the `webhook` connector with mapping rules may be all you need.
- **Keep `normalize` pure** (no database, no network) so you can test it.
- **Test with fixtures.** Add recorded payloads for every event you map *and* every event you deliberately ignore. Noise rules need tests as much as features do.
- **Build event ids from the source's own ids and timestamps,** never from delivery ids.

## Tests

- **Domain tests** go through the HTTP API with `testEnv()` (see `test/harness.ts`). Every test creates its own workspace, so tests don't interfere with each other.
- **AI features** use `scriptedModel()`, a deterministic model that plays back tool calls and answers.
- **Ingestion:** after sending a webhook, call `env.drain()` to process the queue.

## Commits and PRs

Keep changes focused, explain the *why* in the description, and make sure `bun run test` and `bun run typecheck` pass. CI runs both.
