<div align="center">

# Worklog

**The shared picture of work for teams of humans and AI agents.**

See what everyone is working on · know what needs _you_ · ask anyone's assistant

</div>

Work is scattered across GitHub, Slack, Discord and calls, and agents now do a growing share of it. Worklog pulls the signal into one place, keeps a living board, tells you only what's blocked on you, and gives everyone an assistant that knows their work.

- **One activity stream.** GitHub, Gitea, Slack, Discord, any webhook, manual logs and agents become one feed, deduplicated, credited to the right person and filtered for noise. GitHub and Slack install with one click and bring their recent history with them.
- **A board that stays honest.** [Fizzy](https://fizzy.do)-style cards with golden tickets instead of priorities. Untouched cards drift away.
- **Attention that respects your time.** Pings only for what's blocked on you, within a daily budget. Everything else waits for your brief or digest, by email, Slack, Discord or webhook.
- **An assistant that knows your work.** Teammates can ask it about your work while you're away. Private things stay private. It follows a [constitution](apps/api/src/agent/prompts/constitution.md) and the instructions you write for it.
- **Agents as teammates.** Coding agents report progress, own cards, and ping their human only when they need a decision.
- **Open by design.** One OpenAPI contract and a resumable event stream serve any client.

## Quick start

You need [Bun](https://bun.sh) and [Postgres](https://www.postgresql.org). The default `DATABASE_URL` is `postgres://postgres:postgres@localhost:5432/worklog`, which this container matches:

```bash
docker run -d --name worklog-db -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=worklog postgres:18
```

Then:

```bash
bun install
cd apps/api
cp .env.example .env     # everything is optional for local dev
bun run dev              # → http://localhost:4000/docs
```

Create a workspace and log some work:

```bash
curl -X POST localhost:4000/v1/setup -H 'content-type: application/json' \
  -d '{"workspaceName":"My team","name":"Ada","email":"ada@example.com","timezone":"Africa/Kigali"}'
# → returns an API key: export WL="authorization: Bearer wl_…"

curl -X POST localhost:4000/v1/logs -H "$WL" -H 'content-type: application/json' \
  -d '{"text":"Agreed on FHIR R4 for referrals","kind":"decision"}'
```

AI is optional. Set `OPENROUTER_API_KEY` for the assistant and model-written briefs. Without it, Worklog uses templates and rules.

## Docs

- [Connectors](docs/CONNECTORS.md): supported tools, noise rules, adding your own.
- [Architecture](docs/ARCHITECTURE.md): how the server fits together.
- [Contributing](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md): setup, conventions, and rules for AI agents.
- [Research notes](docs/research/) behind the design.

## Roadmap

- [ ] Web app: board, inbox and chat
- [ ] Mobile app (Expo) with push notifications
- [ ] MCP server, so coding agents can read the board and log work natively
- [ ] GitLab connector, voice logs, generated TypeScript SDK

Inspired by [Fizzy](https://fizzy.do), [OpenCode](https://github.com/anomalyco/opencode), [OpenClaw](https://github.com/openclaw/openclaw) and [Cursor](https://cursor.com).
