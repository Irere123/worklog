# Contributing to Worklog

Thanks for helping out! A few conventions keep the codebase easy to work in.

## Setup

```bash
bun install         # also installs the git hooks
bun run test        # ~40 s; no services needed (embedded Postgres, scripted AI model)
bun run typecheck   # strict TypeScript, no unused symbols
bun run lint        # oxlint, type-aware
bun run format      # oxfmt
```

Bun is the package manager, runtime and test runner. Please don't add npm or yarn lockfiles.

## Code style

Formatting and linting use the [Oxc](https://oxc.rs) tools with [Ultracite](https://www.ultracite.ai)'s presets, so there's nothing to argue about in review:

- **[oxfmt](https://oxc.rs/docs/guide/usage/formatter)** formats code, JSON, YAML and Markdown (Prettier-compatible, with sorted imports). Install the [Oxc extension](https://marketplace.visualstudio.com/items?itemName=oxc.oxc-vscode) and VS Code formats on save.
- **[oxlint](https://oxc.rs/docs/guide/usage/linter)** runs Ultracite's rules, including type-aware ones such as unhandled promises. `bun run lint:fix` applies the safe fixes.
- **Our departures from the preset** are in `oxlint.config.ts`, each with its reason. Add to that list only with a reason too.
- **Fix rather than silence.** If a rule really doesn't fit one line, disable it for that line and say why: `// oxlint-disable-next-line <rule> -- <reason>`.

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
- **Test with fixtures.** Add recorded payloads for every event you map _and_ every event you deliberately ignore. Noise rules need tests as much as features do.
- **Build event ids from the source's own ids and timestamps,** never from delivery ids.

## Tests

- **Domain tests** go through the HTTP API with `testEnv()` (see `test/harness.ts`). Every test creates its own workspace, so tests don't interfere with each other.
- **AI features** use `scriptedModel()`, a deterministic model that plays back tool calls and answers.
- **Ingestion:** after sending a webhook, call `env.drain()` to process the queue.

## Commits and PRs

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org):

```
feat(connectors): map GitLab merge requests
fix(ingest): keep Slack edits on the same activity
docs: explain the noise rules
```

The types are `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert` and `style`. The scope is optional: use the area you changed.

[Lefthook](https://lefthook.dev) runs the git hooks:

| Hook | What it does |
| --- | --- |
| `pre-commit` | Lints and formats the staged files, fixing what it safely can. |
| `commit-msg` | Checks the message with commitlint. |
| `pre-push` | Typechecks the project. |

If `bun install` didn't install the hooks, run `bunx lefthook install`. To skip them once, use `git commit --no-verify`.

Keep changes focused and explain the _why_ in the PR description. CI checks commit messages, formatting, lint, types and tests.
