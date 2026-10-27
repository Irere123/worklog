# Contributing to Worklog

Thanks for helping out! A few conventions keep the codebase easy to work in.

## Setup

```bash
bun install         # also installs the git hooks
bun run test        # recreates the worklog_test database on your Postgres (or TEST_DATABASE_URL)
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
- **Comments explain why, never what.** No narration: don't restate the code or describe your change. The full rules for humans and AI agents are in [AGENTS.md](AGENTS.md).

## How the code is organized

The layout, the architecture rules and the database conventions are in [AGENTS.md](AGENTS.md), which has a table of where each kind of change goes. The short version:

- **One domain per folder** under `apps/api/src` (`work/`, `ingest/`, `automations/`, `agent/`). Each exposes plain functions that take an `AppContext` first.
- **Routes are thin.** They live in `src/http/routes/`, one file per API resource with its schemas in `src/http/schemas/`, and every response goes out through `respond()`, which parses it with its schema. Give each a stable dotted `operationId` (`card.close`): it becomes the SDK method name.
- **One write path per concept:** `recordActivity`, `raiseAttention`, `appendMessages`. Don't insert into those tables directly.
- **Privacy is enforced in queries.** Teammate-facing code reads `visibility = 'team'` only. Never rely on a prompt to hide data.

## Database changes

Edit `src/db/schema.ts` and run `bun run db:generate` in `apps/api`. Better Auth's tables are generated: change `src/lib/auth.ts`, then run `bun run auth:generate`. Never hand-edit `src/db/auth-schema.ts`.

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

If `bun install` didn't install the hooks, run `bunx lefthook install`. Don't skip them with `--no-verify`: fix what they report.

Keep changes focused and explain the _why_ in the PR description. CI checks commit messages, formatting, lint, types and tests.
