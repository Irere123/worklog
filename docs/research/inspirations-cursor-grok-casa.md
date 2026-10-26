# Inspirations: Cursor, Grok Bot, and "Casa"

Research date: 2026-10-26. Scope: what Worklog should borrow from, or avoid in, these products. The focus is on agents as visible teammates, approval gates, keeping proactive output high-signal, learning preferences, and Slack/GitHub-native patterns.

**Source markers**

- **[P]** Primary source: the vendor's own docs, changelog or announcement, fetched on 2026-10-26.
- **[S]** Secondary source: press, third-party guides, or vendor claims reported by someone else.
- **[U]** Unverified: a single secondary source, or sources that conflict.

Vendor metrics, such as Bugbot's resolution rate, are self-reported even when the source is primary.

---

## 0. What the dictated names refer to

| Dictated | Identified as | Confidence | Why |
| --- | --- | --- | --- |
| "cuss, cuss, the code editor" | **Cursor**, the AI code editor (cursor.com, made by Anysphere) | High | It is the obvious "code editor" match, and Grok Bot ships through Cursor. |
| "Grobot" / "Grokboat" / "Grokbot" | **Grok Bot**, SpaceXAI's (xAI's) always-on agent product | High | "Grok Bot" is the literal product name. It entered early beta on **2026-08-11** and is distributed and operated through Cursor. It is not Cursor's Bugbot. It is also not the `@grok` reply bot on X, which is a separate product and out of scope. |
| "Casa" | **Unresolved.** Best candidate: **Capx Casa**, an open-source "control plane for agent-run companies" | Low to medium | See §3. No AI or work product called "Casa" has a meaningful public footprint. |

---

## 1. Cursor

### 1.1 Context

- Anysphere makes Cursor. SpaceX signed a merger agreement on **2026-06-16** to acquire Anysphere for about **$60B in stock**, with closing expected in Q3 2026 [S: [Tribune/PTI](https://www.tribuneindia.com/news/business/spacex-to-acquire-ai-coding-startup-cursor-in-60-billion-deal-expects-q3-2026-close/), [Gigazine](https://gigazine.net/gsc_news/en/20260617-spacex-acquires-curso-anysphere/)]. One source claims the deal closed on 2026-08-15 [U].
- Cursor handles sign-in, billing, connectors and hosting for Grok Bot. Its docs carry a full Grok Bot section [P: [cursor.com/docs/grok-bot](https://cursor.com/docs/grok-bot.md)].
- The current desktop release line is 3.2x (3.27 in late October 2026) [P: [release notes](https://cursor.com/docs/release-notes.md)]. Cursor 3 (April 2026) introduced the **Agents Window** [S: [forum](https://forum.cursor.com/t/cursor-3-new-cursor-interface/156506)].

### 1.2 Cloud agents (formerly "Background Agents"): progress and status

Source: [cloud-agent docs](https://cursor.com/docs/cloud-agent.md) [P].

- **What they are.** Agents that run in isolated cloud VMs with the repo, dependencies, secrets and network access. They work on a separate branch and deliver **merge-ready PRs** plus **artifacts**: screenshots, videos and logs showing what changed and how it was verified.
- **Where you can start one.** The desktop app, the web (cursor.com/agents), iOS (Android uses a PWA), Slack, GitHub/Bitbucket comments, Linear, and the API.
- **Live view.** A teammate can take over the agent's **remote desktop** to watch or test, then hand control back.
- **Mobile.** Cursor for iOS sends a "push notification when an agent finishes a turn" and lets you "track up to eight agents at once with Live Activities on the lock screen and Dynamic Island". Agents started anywhere appear in the **mobile inbox** [P: [mobile](https://cursor.com/docs/cloud-agent/mobile.md)].
- **Team visibility.** Agents are visible to members of the Cursor team they were started under. Viewing is **read-only**, and an admin must enable **Team follow-ups** before teammates can steer someone else's agent.
- **Machine-readable state (API).** [P: [endpoints](https://cursor.com/docs/cloud-agent/api/endpoints.md)]
  - Agent state is `ACTIVE` or `IDLE`.
  - A run is `CREATING`, `RUNNING` or `WAITING_FOR_BACKGROUND_WORK` while active, then ends as `FINISHED`, `ERROR`, `CANCELLED` or `EXPIRED`.
  - Runs can be streamed over SSE.
  - A running turn can be **steered** with `delivery: "steer"`. If the turn can't take the prompt, it is queued as the next follow-up.

### 1.3 Launching from Slack, Linear and GitHub, and how results come back

**Slack** [P: [Slack integration](https://cursor.com/docs/integrations/slack.md)]

- **Invocation.**
  - `@Cursor <prompt>` starts a cloud agent.
  - In a thread that already has an agent, the same command adds a follow-up instruction.
  - `@Cursor agent <prompt>` forces a new agent.
  - `@Cursor list my agents` shows your running agents.
  - A DM starts one agent per top-level message.
- **Context.** "Cloud Agents read the entire thread for context when invoked."
- **Plan first, only when it helps.** "Before Cursor starts changing code, it posts a short plan in the thread when you are fixing a bug or when implementation details would help you follow along. **Straightforward requests skip that note.**"
- **Live status.** "While it works, Cursor updates a short status under the thread", for example "Cursor is reading code…".
- **Completion.** An _Open in Cursor_ button appears when the agent starts. When it finishes, a Slack notification arrives with _View PR in GitHub_.
- **Context menu (⋯)** on any agent message: Add follow-up, Switch repository, Delete, View request ID, Give feedback.
- **Choosing a repository.** Cursor checks, in order:
  1. the message text;
  2. your recent agent activity;
  3. keyword **routing rules**;
  4. the channel default;
  5. the workspace default.
- **Privacy toggles.** "Display Agent Summary" (summaries and diff images may include file paths and code), and a separate toggle for **external / Slack Connect channels**.

**Linear** [P: [Linear integration](https://cursor.com/docs/integrations/linear.md)]

- Assign an issue to "Cursor", or mention `@Cursor` in a comment. Cursor "filters out non-development work automatically".
- Agents "show real-time status in Linear and create PRs automatically when complete".
- Replying in the agent session sends a follow-up.
- Linear triage rules can auto-delegate issues, but Linear still requires a human assignee for rules to fire.

**GitHub** [P: [cloud-agent](https://cursor.com/docs/cloud-agent.md), [Bugbot](https://cursor.com/docs/bugbot.md)]

- Comment `@cursor` on a PR or issue to start an agent.
- `cursor review` or `bugbot run` triggers Bugbot. Bugbot ignores these commands when a bot account or GitHub App posts them.

Microsoft Teams, Jira and Notion integrations also exist [P: docs index].

### 1.4 Bugbot: the PR-review workflow and how it avoids noise

Source: [Bugbot docs](https://cursor.com/docs/bugbot.md) [P] unless noted.

**Workflow**

- Bugbot reviews automatically on every PR update, or manually on command.
- It leaves inline comments with explanations and fix suggestions.
- Each comment has _Fix in Cursor_ and _Fix in Web_ links, which hand the finding to an agent. An optional **Autofix** has its own check.
- It publishes a CI check called `Cursor Bugbot`.

**Noise controls**

- **Incremental reviews (default).** "reviews only the changes since the previous Bugbot review."
- **Reads existing PR comments** "to avoid duplicate suggestions and build on prior feedback."
- **One summary, updated in place.** The PR summary goes in the description (or one comment) and "updates it on each review", instead of adding new comments.
- **Declines oversized PRs.** It skips PRs over the size limit and posts one comment asking you to split the change. Skipped runs aren't billed. Generated files (`linguist-generated`) are excluded.
- **Caps reviews of bot-authored PRs** per team.
- **Findings are `neutral` by default, not `failure`**, so they don't block merges unless the team opts in to "fail on unresolved".
- **Effort levels.** Low, Default and High, plus **Smart**, which picks a level from your instructions and the PR's title, author, repo and diff.

**Learning loop** [P: [docs](https://cursor.com/docs/bugbot.md), [blog 2026-04-08](https://cursor.com/blog/bugbot-learning)]

- **Signals.**
  - downvotes on Bugbot comments ("a downvote tells Bugbot the finding wasn't useful");
  - developer replies;
  - human reviewer comments that point out bugs Bugbot missed.
- **Lifecycle.** Signals become **candidate rules**. Candidates that gain enough signal are **promoted**. Active rules that draw "consistent negative signal" are **disabled**.
- **Inline teaching.** `@cursor remember [fact]` on any PR becomes a learned rule.
- **Per-rule analytics.** Issues found, PRs reviewed, accepted issues, and **acceptance rate**.
- **Rule layering.** Team rules → `.cursor/BUGBOT.md` (nested by directory) → learned rules → manual rules. `bugbot run verbose=true` lists which rules a review used.
- **Metric.** "Resolution rate" is the share of comments addressed by merge, judged by an LLM on public repos only. Cursor reports:
  - 52% at launch (July 2025);
  - over 70% by January 2026;
  - **78.13%** by April 2026, against Greptile at 63%, CodeRabbit at 49% and Copilot at 47%.

  These are vendor-measured [P: [building-bugbot](https://cursor.com/blog/building-bugbot)].

- **v1 design (July 2025).** Eight parallel passes, each with a different diff ordering, then majority agreement, then a validator model to remove false positives. Later versions became agentic. Cursor says early versions "needed to restrain the models to minimize false positives".

### 1.5 Memories and Rules: how Cursor learns preferences

- **Memories, 2025.**
  - Cursor 1.0 (2025-06-04): "Cursor can remember facts from conversations and reference them in the future" (beta) [P: [changelog 1.0](https://cursor.com/changelog/1-0)].
  - 1.2 (2025-07-03): Memories went GA and "introduced **user approvals for background-generated memories** to preserve trust" [P: [changelog 1.2](https://cursor.com/changelog/1-2)].
  - In the **2.1** line (November 2025), the Memories UI was removed, and staff pointed users to an "Export memories" command that saves them as `.mdc` rules. Staff statements conflict on whether the feature still runs in the background [S: Cursor forum threads [1](https://forum.cursor.com/t/custom-modes-and-memories-gone-in-2-1/143744), [2](https://forum.cursor.com/t/are-my-memories-gone/144057)].
  - Current docs have no Memories page for the editor.
- **Rules today** [P: [rules](https://cursor.com/docs/rules.md)]:
  - **Team Rules** live in the dashboard. Admins can make them enforced. They are free-form text and can be scoped by glob.
  - **Project Rules** live in `.cursor/rules/*.mdc` and apply always, intelligently, by glob, or manually.
  - **User Rules** are global preferences.
  - `AGENTS.md` (nested files supported).
  - Precedence is Team → Project → User. "Can I create a rule from chat? Yes."
- **Memory inside scoped workflows.**
  - Automations have a **Memories** tool: a per-automation `MEMORIES.md`, kept outside the agent's working filesystem, that you can view and edit. The docs warn that untrusted input "may lead to misleading or malicious memories" [P: [automations](https://cursor.com/docs/cloud-agent/automations.md)].
  - **Projects** keep shared context files where agents record "what they learn about the codebase and how you prefer work to be done" [P: [projects](https://cursor.com/docs/agent/projects.md)].

**Pattern.** Cursor moved away from opaque, auto-generated personal memories toward explicit, file-based, scoped rules that people can review, plus learned rules that carry usage analytics.

### 1.6 Multi-agent UI

- **Agents Window** [P: [agents-window](https://cursor.com/docs/agent/agents-window.md)]:
  - multiple workspaces in one place;
  - many parallel agents across local, worktree, cloud and SSH, reachable from phone, web, Slack, GitHub and Linear;
  - one-step **handoff between local and cloud**;
  - **cloud subagents** (`/in-cloud`), and `/autopilot` to shepherd a PR to merge;
  - a new diffs and PR view.
- **Projects** [P: [projects](https://cursor.com/docs/agent/projects.md)]:
  - You talk to a **coordinator agent**, which "doesn't write code itself. It plans the work, delegates it to agents… and brings the finished work back to you to check."
  - It maintains context over months and "performs recurring work without being prompted".
  - **Subscriptions.** The coordinator can watch a Slack channel, run on a schedule, or follow PRs. A **"Listening" pill** above the input lists every event it listens for, and each subscription can be removed there.

### 1.7 How agent work shows up for a team: dashboards and analytics

Source: [Usage Analytics](https://cursor.com/docs/account/teams/analytics.md) [P].

- **AI output metrics.** AI share of committed code, agent edits, Tab, messages, and a **Usage Leaderboard** that every team member can see.
- **Repository Insights.** AI lines committed per repository.
- **Conversation Insights** (Enterprise, on by default). Every agent session is classified on-device by:
  - Category: Bug fixing, Refactoring, New features, and so on;
  - Work Type: **Maintenance (KTLO) / Bug Fixing / New Features**;
  - Complexity;
  - prompt Specificity.

  Teams and individuals can be compared.

- **Grok Bot Conversation Insights.**
  - **Type of Work**: Inbox & Briefings, Sales & Pipeline, Customer Support, Engineering & Product, and others.
  - **Level of Automation**: _Not automated_ (the Bot recommended and a person did it), _Semi-automated with human review_ (the Bot staged it and waited for approval), and _Fully automated_.
  - Counts are aggregate only; no conversation content is shown.
- **Cloud Agent usage.**
  - Agents Created, broken down by originating source;
  - PRs opened and merged;
  - lines of code;
  - top repositories;
  - top users.
- **Cursor Blame** (Enterprise). Per-line attribution as Tab, Agent (with model) or Human, with summaries of the conversations that produced the code [P: [cursor-blame](https://cursor.com/docs/integrations/cursor-blame.md)].
- **APIs.** Analytics API (including Bugbot analytics and per-user endpoints), Admin API (usage events, audit logs), and **OpenTelemetry export** (Enterprise).

**Gap.** These are adoption and ROI dashboards for admins. Cursor does not offer a per-person "who is doing what right now, and what's blocked on me" view across humans and agents. That is Worklog's opening.

### 1.8 Patterns for agents surfacing things proactively

- **Rollouts** [P: [rollouts](https://cursor.com/docs/rollouts.md)]
  - **Plan when the PR opens.** It posts a rollout plan listing risks, the expected effect, the signals it will check, and gaps in instrumentation.
  - **Checks on a schedule.** It checks each deploy right away, then after 20 minutes, 1 hour, 1 day and 3 days.
  - **Status buckets.** It groups changes into **Attention / Monitoring / Pending / Verified**, with **Mine** and **Team** tabs.
  - **Quiet by default.** Slack notifications start with **"Issues found" only**. Deploy success, deploy failure and "check clear" are opt-in.
  - **Closing an issue requires a reason**: Fixed, Not a Real Issue, Expected, Duplicate or Other. That gives a labelled feedback signal.
- **PR Routing & Approval** [P: [approval-agents](https://cursor.com/docs/approval-agents.md)]
  - Assigns reviewers from code ownership and commit history.
  - Auto-approves **low-risk** PRs under a maximum risk threshold.
  - Waits up to about 8 minutes for Bugbot and Security findings, and never approves if they need human review.
- **Automations** [P: [automations](https://cursor.com/docs/cloud-agent/automations.md)]
  - **Triggers:** schedules, GitHub/GitLab/Bitbucket events, Slack (new message, **emoji reaction**, channel created), webhooks, Linear, Sentry and PagerDuty.
  - **Tools:** Send to Slack, Comment on PR, Request reviewers, MCP, memories, computer use.
  - `/automate` builds an automation from plain language.
- **Slack.** Posts a plan only when useful, keeps a status line updated, and sends one completion notification (see §1.3).

### 1.9 How Cursor agents could report into Worklog

| Path | What you get | Notes |
| --- | --- | --- |
| **Cloud Agents API with webhook** [P: [webhooks](https://cursor.com/docs/cloud-agent/api/webhooks.md)] | A `statusChange` POST on `FINISHED` or `ERROR`, with `id`, `status`, repo/ref, `branchName`, `prUrl` and `summary`. Signed with HMAC-SHA256 in `X-Webhook-Signature`, plus `X-Webhook-ID`. | Only for agents created through the API with a webhook URL. Agents launched from Slack or the IDE don't call it. |
| **Repo hooks** (`.cursor/hooks.json`) [P: [hooks](https://cursor.com/docs/hooks.md)] | Cloud agents run repo hooks. Events include `sessionStart`, `stop`, `subagentStart`/`subagentStop` and `afterFileEdit`. | A small script Worklog ships could POST to `/v1/activities`. It would read **agent metadata** [P, preview: [metadata](https://cursor.com/docs/cloud-agent/metadata.md)]: `agent/id`, `agent/source` (`SLACK`, `API`, `AUTOMATIONS`…), `owner/user-id`, `turn/user-id` (who asked this turn), `workspace/repo-url` and `branch-name`. This is the most complete path, because it covers every launch surface. |
| **Polling** the API (list agents/runs, SSE stream) | Status for agents created elsewhere | Scope depends on the API key. Check whether a team or service-account key lists teammates' agents. |
| **Worklog's GitHub connector** | PRs from `cursor/*` branches or Cursor's app | Attribute them to the Cursor agent member, acting for the human who asked (inference, not documented by Cursor). |
| **Automations' MCP tool** | Automations can call a Worklog MCP server directly. | Depends on Worklog's planned MCP server. |
| Analytics API / OTel | Aggregate usage | Good for a weekly wrap; not for live status. |

---

## 2. Grok Bot (SpaceXAI / xAI, distributed with Cursor)

### 2.1 What it is and when it shipped

- **Launch.** "Grok Bot is your team of always-on agents… they have their own computer… finish jobs end to end, and **only come back when something needs your approval**." Beta started on **2026-08-11**. It began as an internal SpaceXAI prototype used for sales, marketing, ops and engineering [P: [x.ai/news/introducing-grok-bot](https://x.ai/news/introducing-grok-bot); S: [Gigazine](https://gigazine.net/gsc_news/en/20260812-spacexai-grok-bot/)].
- **Plans.** It is now included with **every paid individual Cursor plan and the Cursor Teams plan**, through a linked SuperGrok subscription, or with a Grok Business seat. Usage resets weekly [P: [cursor.com/docs/grok-bot](https://cursor.com/docs/grok-bot.md)]. Launch access was limited to SuperGrok Heavy ($300), Cursor Ultra ($200) and Cursor Teams Premium ($120/seat) [S: Gigazine].
- **Platforms.** Desktop on macOS, Windows and Linux; mobile on iOS and Android [P]. Cursor runs the computers and holds the app OAuth tokens.
- **Timeline.**
  - Team Bots (around Sep 28) [U].
  - Handoff to Cursor plus GitHub and Origin plugins (Sep 30) [S].
  - **Primary Bot** (Oct 1) [S].
  - Agent Email at `mail.grokbot.com` [P].
  - **Pages**: reports and dashboards the Bot keeps updated, still rolling out [P: [help/pages](https://cursor.com/help/grok-bot/pages.md)].
  - An October incident in which a Bot reportedly posted an investor's bank balances into a company Slack [U: single secondary source, [OrcaRouter](https://www.orcarouter.ai/ar/blog/grok-bot-launch)].

**Core model** [P: [docs.x.ai overview](https://docs.x.ai/grok-bot/overview), [cursor.com/docs/grok-bot](https://cursor.com/docs/grok-bot.md)]

- **A Bot.** "A durable AI teammate with a name, a job, its own conversation, and working context that develops over time."
- **Setup is "a message, not a workflow builder".** You describe the job and grant access as the Bot asks.
- **One shared computer per account.** Browser, filesystem and terminal are shared by all your Bots. "Treat anything placed on it as available to every Bot you run." Bots are **not** security boundaries from each other.
- **Tools.** Connected apps are preferred, with computer use as the fallback. Passwords, 2FA, CAPTCHAs and payments are **handed back to the human**.
- **Coordination.** Bots work in parallel, message each other asynchronously, and share **group chats of 2 to 6 Bots** with humans. Guidance: "Ask for a single owner at each stage; **parallel handoffs create duplicate work and noisy updates**."

### 2.2 Deciding when to ping and when to keep going

**What the vendor promises** [P: launch post]

- Bots learn "**when to ping versus keep going**".
- They "follow up on threads you dropped, nudge a stalled handoff, and pick work back up from previous conversations".

**Documented mechanics** [P: [security](https://cursor.com/docs/grok-bot/security.md), [settings](https://cursor.com/docs/grok-bot/settings.md), [work](https://cursor.com/docs/grok-bot/work.md)]

1. **Approval cards.**
   - The card shows "the proposed operation and its inputs", with **Allow once / Always allow / Deny**. _Always allow_ saves a matching rule.
   - _Deny_ means "the Bot doesn't try it again until the member sends another message."
   - "Nobody should approve an action whose target or effect they can't identify."
2. **Auto Review.**
   - "An independent review model" reviews risky actions before they run: shell commands, app calls, computer use, changes to routines and triggers, and delegation to Cloud Agents or subagents.
   - It returns one of three verdicts: proceed, require approval, or deny.
   - Rules come in two kinds: **Ask first** and **Allow automatically**. "Ask first wins when rules conflict."
   - Admin team rules are locked. Members' personal rules "only make behavior stricter".
   - It does **not** review memory writes or most settings changes.
3. **Three attention states in the sidebar.**
   - "Bots that **need attention** (a question, approval, or handoff)";
   - "**unread activity** (a new result)";
   - "**working** status".

   Per-Bot notifications fire only "when that Bot **finishes or is waiting for you**", and are "suppressed while Grok Bot is focused".

4. **Drafts by default for autonomous output.** "Email the Bot writes on its own, including from routines, waits as a draft until the member presses Send." Email you asked for in chat sends after Auto Review or your approval [P: [teams](https://cursor.com/docs/grok-bot/teams.md)].
5. **Explicit failure over stale data.** Routines should "report missing or stale sources instead of working around them". After "a long period away", Grok Bot asks whether to keep routines running and **pauses them if you don't respond**.
6. **Reviewable results.** Bots are told to separate "facts found in source systems, assumptions, actions already completed, **actions waiting for approval**, and unresolved questions", and to include source links and a short action log.
7. **Primary Bot** (Oct 1).
   - "Grok Bot can now suggest ways to help without you needing to ask."
   - It "will spot work it can take off your plate and offer to handle it", "checks in when it needs your help", routes tasks to the right Bot, and suggestions "don't count against your usage" [S: [ProgressiveRobot](https://www.progressiverobot.com/2026/10/02/primary-bot-grok-4-7-base-model-proactive-grok-bot/) citing @bot posts on X; [Flavio Copes](https://flaviocopes.com/grok-bot/)].
   - **The signals it watches, how often it interrupts, and how to turn it off are undocumented** [S].
8. **Vendor's chief-of-staff recipe** [P: [use-cases](https://cursor.com/docs/grok-bot/use-cases.md)].
   - It "owns a source-linked digest of what changed and what needs your attention".
   - The prompt asks it to "Return only items that map to the priorities in this document. For each item, include the source, why it matters, the proposed next step, and whether I owe a decision. Don't send messages or change meetings."
   - Then: "**Mark what was useful and what was noise**, then schedule the digest."

### 2.3 Feedback loops and learning preferences

- **Memory.**
  - Bots keep "stable working preferences, important facts, and summaries from its work".
  - Lasting preferences are taught explicitly ("tell the Bot and ask it to remember").
  - Memory is "not a substitute for an authoritative source". Safety boundaries belong in approvals and rules, "rather than memory alone" [P].
- **Team Bot memory has two levels** [P: [team-bots](https://docs.x.ai/grok-bot/team-bots), [help](https://cursor.com/help/grok-bot/team-bots.md)].
  - **Team memory** is saved "only when someone indicates the whole team should know, and it says so when it does".
  - **Per-person notes** stay private. "It doesn't save anything about you personally for the team."
- **Teach a task (routines from demonstration)** [P].
  - Record up to 10 minutes of screen interaction (no microphone). This produces a **draft skill**.
  - You add decision rules, failure handling and approval boundaries, then **Test** it on a safe input, then schedule it.
  - Recommended order: one-off task → skill → routine, adding the routine "only after retries and failure cases are defined".
- **Approvals become rules.** _Always allow_ writes a rule.
- **Feedback etiquette.**
  - "Reply in a thread when feedback applies to one result."
  - "A reaction alone shouldn't carry a safety-critical decision."
- **Admin analytics.** Level of Automation per conversation (see §1.7).

### 2.4 Integration surfaces

- **Slack, connected as you.** The Slack app "posts as the Slack user you connected" [P: [connect-apps](https://cursor.com/help/grok-bot/connect-apps.md)].
- **Slack, Team Bot.** A Team Bot has its own Slack app and handle [P: [team-bots help](https://cursor.com/help/grok-bot/team-bots.md), [group-chats](https://cursor.com/help/grok-bot/group-chats.md)].
  - **Where it answers.** In DMs it answers every message. In channels it answers when **@mentioned**, then **follows the thread** without needing another mention. **Each thread is its own conversation.**
  - **Who it acts for.**
    - It "acts for the teammate who mentioned it" and can **hand work to that person's own Bots**, "and their replies are posted back into the same thread".
    - "Bots record who asked for each message they post in Slack, so anyone in the thread can ask the Bot who requested it."
    - A connected account "always acts as the person the Bot is answering". Each person's chat is private from the owner.
  - **Approvals in threads.** "In a Slack thread, the Bot posts a **Review an action** card with Allow once, Deny, and View details. **Only the person who asked can answer it.**"
  - **Who pays.** Usage is charged to the person being answered.
  - **Identity.** Users must link their Slack account to Cursor first.
  - **Data warning.** Slack channels share one computer per Bot, so keep sensitive material out of channel threads.
- **Routine triggers** [P: [routines](https://cursor.com/help/grok-bot/routines.md)].
  - **Schedules:** at least 5 minutes apart, up to 50 routines per Bot, last 20 runs kept.
  - **Slack:** on a mention, a phrase, a reaction, or any message, in one channel or all of Slack.
  - **Other events:** GitHub, Linear, Sentry, PagerDuty, and email.
  - **Webhook:** POST JSON with a key, and the Bot receives the body with the routine's instruction.
  - The docs warn against broad listeners like "every new message".
  - A GitHub routine can watch a single PR and **removes itself once it merges or closes** [S: changelog snippet; x.ai/changelog/bot returned 403].
- **Cursor Cloud Agents.** Bots can delegate coding to Cursor, controlled by an admin toggle [P], and the "Bot is notified when one finishes" [S].
- **MCP connectors**, including a team marketplace and custom servers subject to network policy [P: security].
- **X.** Tag `@bot` in a post and it goes to your main Bot as a task.
  - The Bot reads your post, the post you replied to, and any quoted posts.
  - `@bot` replies publicly with **only a short confirmation**: "the work and its results stay in that Bot's conversation" [P: [tag-on-x](https://docs.x.ai/grok-bot/tag-on-x)].
- **Pages.** The Bot builds reports and dashboards in its Library and updates the **same page** ("Updated below" on the old card). Viewers can filter but "only the Bot can change it" [P].
- **Governance.**
  - Admin API.
  - Audit logs for control-plane events.
  - **Action Recording** (Enterprise): sanitized metadata of every tool call and **the decision that allowed or refused it**, exportable via OpenTelemetry tagged `cursor.surface=grok_bot`, with 90-day retention [P: [teams](https://cursor.com/docs/grok-bot/teams.md)].

### 2.5 Criticisms and risks

- **No isolation between Bots.** One shared computer means "two Bots are not separate security boundaries" [P, S].
- **Usage drain.** Usage limits are hit quickly. Each routine run spends usage even when there's nothing to report, so a 15-minute routine runs 96 times a day [S: Flavio Copes].
- **Noise.** "Unrestricted multi-Bot conversations can become noisy." Group chats can wake every Bot for each message [S].
- **Undocumented proactivity.** Primary Bot and Finance features were undocumented at release [S].
- **Hiding isn't pausing.** Hiding a Bot "does not pause the Bot or its routines" [P].
- **No model choice.** There is no model picker [P].
- **Author's closing advice:** "If you spend more time checking the Bot than doing the job yourself, delete it" [S].

### 2.6 How Grok Bots could report into Worklog

1. **A Worklog MCP server as a Grok Bot connector.** Bots call `log_work`, `update_card`, `list_attention` and `raise_attention`. This is already on Worklog's roadmap, and it needs OAuth or MCP login for external agents.
2. **Worklog → Bot through webhook routines.**
   - When a card is assigned to a Bot, or an attention item targets it, Worklog POSTs JSON to the routine's webhook URL.
   - Worklog's outbound `webhook` delivery channel fits this. Store the per-routine URL and key as connector secrets.
3. **Slack ingestion.** In opted-in channels, Worklog's Slack connector already sees Team Bot posts. Each one carries "who requested it".
4. **OpenTelemetry Action Recording** (Enterprise only). A passive, metadata-only feed of tool calls, approvals and denials, routine runs, and delegations. It is good for an "agent did X" stream without message content.
5. **Handoff to Cursor Cloud Agents.** Capture through the Cursor paths in §1.9.

---

## 3. "Casa": candidates

No AI-assistant or work-visibility product called "Casa" has meaningful press, Product Hunt, Hacker News or Y Combinator coverage. Searches covered: Casa AI, casa.ai, casa.dev, trycasa, Kasa, "Casa" with Slack, standups or agents, Y Combinator, Product Hunt, and Hacker News. Ranked candidates:

1. **Capx Casa** ([capx.ai/blog/casa-runs-the-company](https://capx.ai/blog/casa-runs-the-company), [GitHub Capx-AI/casa](https://github.com/Capx-AI/casa), MIT license, v0.3.0, September 2026, about 70 stars) [P for its own docs]. **Low to medium confidence.** It fits the "agents as a team" theme best.
   - **What it is:** "the open control plane for building a company from your terminal", installed as a Claude Code plugin, with entry points for Codex, Cursor, Grok Build and others.
   - **Operators:** named specialist agents (strategist, engineer, growth) that own departments.
   - **Board:** `/casa-board` shows department lanes "led by the binding constraint".
   - **Ledger:** "an append-only event record of work and decisions" shared across terminals.
   - **Reviews:** `/casa-review` runs advisor personas.
   - **Approvals:** `/casa-approvals` is a queue.
   - **Autonomy per department:** `AUTO` or `APPROVE_FIRST` [P: [governance](https://capx.ai/docs/governance)].
   - **Hard gates:** `spend_money`, `go_public`, `merge_to_main` and destructive actions need approval in every mode: "A department set to auto does not bypass them."
   - **Caveats:** It targets a single founder. Its optional "connected mode" publishes a company page and binds a crypto token.
2. **Cassidy AI** ([cassidyai.com](https://www.cassidyai.com/)). **Low confidence.** A near-homophone. It is an AI assistant and agent platform for teams, deployed in Slack and Microsoft Teams.
3. **Casa / "Casa AI" (getcasa.com)** ([getcasa.com/updates/casa-ai](https://getcasa.com/updates/casa-ai)). **Very low confidence.** The name matches exactly, but it is a home-maintenance concierge, not a work tool.

The earlier transcription "crowd, casa" may have been "Cursor". Since the user lists Casa separately, a URL or one more detail from the user would settle it.

---

## 4. Takeaways for Worklog

Each item is labelled **Borrow** or **Avoid**, and maps to (a) agents in the stream and on the board, (b) approval gates as attention, (c) ping vs keep going, (d) chief of staff, (e) routines vs automations, and (f) Slack/GitHub-native patterns.

1. **(a) Borrow: every agent activity records both the agent and the human it acts for.**
   - Cursor exposes `agent/source`, `owner/user-id` and `turn/user-id`. Grok Bots "record who asked for each message they post in Slack".
   - Worklog could add `onBehalfOf` and `via` (slack | github | linear | api | schedule) to activities and card moves.
   - Render it on the card, for example "Cursor agent · for @ada · via Slack".
   - Map vendor states to one small vocabulary: **working / needs you / finished / failed**. Cursor run states and Grok's sidebar states both fit it.

2. **(a) Borrow: ship capture adapters, not just an endpoint.**
   - A `POST /hooks/cursor` receiver: verify `X-Webhook-Signature`, dedupe on `X-Webhook-ID`, then turn `FINISHED`/`ERROR` with `prUrl` and `summary` into an activity plus a card move.
   - A drop-in `.cursor/hooks.json` script (`sessionStart`/`stop`) that posts to `/v1/activities` using agent metadata. This covers agents launched from Slack, the IDE or Linear.
   - A Worklog MCP server that Grok Bots, Cursor Automations and Claude Code can all use.
   - Webhook targets compatible with Grok routines.
   - Don't depend on vendor analytics. They are aggregate, Enterprise-gated and admin-facing.

3. **(a) Borrow: a "level of automation" tag** on agent activities, from Grok Bot Conversation Insights: _recommended_, _staged for review_, _done autonomously_.
   - The weekly wrap and board can then answer "what did agents finish on their own vs. what's waiting on a human?"
   - This is more useful to a team than Cursor's lines-of-code leaderboards.

4. **(b) Borrow: an agent's approval request becomes a first-class attention item** (`kind: approval`).
   - **Content:** the exact operation, target and inputs, because "nobody should approve an action whose target or effect they can't identify".
   - **Actions:** **Allow once / Always allow / Deny**. _Always allow_ writes a narrow rule. _Deny_ blocks retries until there is a new instruction.
   - **Who can answer:** only the requester, as in Grok's Slack card.
   - **Gates:** approvals skip digest batching, but get their own small push budget. An approval nobody has touched falls back to the next digest instead of re-pinging.
   - The same object can carry Worklog's own planned "tool approvals for owner-mode writes".
   - **Avoid** emoji reactions as approval. Grok's docs say a reaction shouldn't carry a consequential decision.

5. **(c) Borrow: three attention states, and notify only on two events.**
   - Grok separates _needs you_ (question, approval, handoff), _new result_ and _working_. It notifies only when a Bot "finishes or is waiting for you", and stays quiet while the app is focused.
   - Worklog mapping:
     - "agent waiting on you" is high priority and push-eligible;
     - "agent finished" goes to the digest unless you subscribed to that card;
     - "agent working" never notifies.
   - Rollouts shows the same restraint: Slack starts with "Issues found" only, and success or "check clear" is opt-in.

6. **(c) Borrow: Bugbot's rule lifecycle for attention feedback.**
   - Worklog's `POST /attention/{id}/feedback` and `mutedKinds` are a good start. Go one step further:
     - feedback creates **candidate rules** scoped to a kind, source or thread;
     - a candidate is promoted after repeated signal;
     - a rule is auto-disabled when it starts drawing negative signal;
     - show per-rule **acceptance rate**.
   - Add inline teaching (`@worklog remember …` in Slack or GitHub, like `@cursor remember`).
   - Ask for a reason on dismissal, like Rollouts' Fixed / Not real / Expected / Duplicate, so the labels can tune gates.
   - Track a **resolution or acted-on rate** per kind as the main quality metric.

7. **(c) Borrow: update in place and send only what changed.**
   - Bugbot reviews only changes since its last review and edits its summary in place. Grok's Pages mark old cards "Updated below". Cursor's Slack status line is edited under the thread.
   - Worklog should edit its existing Slack message, brief or digest card rather than post a new one.
   - Briefs should say what changed since the last brief, and when nothing changed, say "nothing new". "A quiet run is still a successful run."

8. **(d) Borrow, with limits: a person's assistant is the chief of staff for their other agents.**
   - **What it does:** routes requests to the person's Cursor agents, Grok Bots and Claude Code; merges their status into the morning brief; and owns the single "needs you" list.
   - **Principles to copy:**
     - Cursor's coordinator "doesn't write code itself… delegates… brings the finished work back";
     - Grok's "single owner per stage";
     - the vendor's chief-of-staff prompt, which asks for each item's source, why it matters, the next step, and "whether I owe a decision".
   - **Avoid** Primary Bot's undocumented proactivity, where the watched signals, interruption rate and off switch are all unpublished. Instead, show exactly what the assistant watches, like Cursor Projects' **"Listening" pill** listing every subscription, and let users remove each one.

9. **(e) Borrow: "save as automation" from a successful conversation. Skip screen-recorded demonstrations.**
   - Worklog isn't a computer-use agent, so the useful part of "teach a task" is the promotion ladder: **one-off → saved skill → scheduled automation**.
   - After a good answer ("list my PRs waiting on review"), offer to save it. Before saving, require Grok's fields:
     - owner;
     - schedule and time zone;
     - input source;
     - expected output;
     - approval boundary;
     - **what to do when a source is missing** (report failure, never stale data).
   - Add **Test** (a real run), keep the last 20 runs, and use **narrow event triggers**. Warn about "every new message"-style triggers.
   - **Auto-pause** automations the owner has ignored for a long time after asking once. Grok does this, and it is already on Worklog's roadmap.

10. **(f) Borrow: thread-native "ask someone's assistant" in Slack and Discord.**
    - **Invocation.** `@worklog ask @sam …` in a thread reads the **entire thread** (as Cursor does).
    - **Where it replies.** In-thread, as Worklog's app, never as Sam. It records who asked. **Each thread is one conversation** that it follows without another mention (as Grok does).
    - **Permissions.** Teammate mode is decided by the asker; this is Worklog's existing rule. If the question needs Sam, the assistant uses `leave_note_for_owner`, and Sam's answer is **posted back into the same thread**, like Grok's Team Bot handoff.
    - **Sensitive content.** In public or Slack Connect channels, post a short answer or acknowledgement. Keep sensitive detail in DM, following the `@bot` on X pattern and Cursor's "external channels" summary toggle.
    - **Approvals in threads.** Only the requester can answer an approval card.
    - **GitHub equivalent.** `@worklog` on a PR or issue posts one in-place status comment, not a stream of comments.

**Also avoid**

- **Shared credentials across agents.** Grok's shared computer means every Bot can reach every login. Keep Worklog's per-member tokens and query-enforced privacy.
- **Broad listeners and high-frequency schedules.** They drain usage and add noise.
- **Opaque auto-memory.** Cursor removed its Memories UI and moved to reviewable rules. Keep Worklog memory visible and editable, and keep the team/private split explicit. Grok saves team memory only when someone says so, and announces it.
- **Vendor metrics as ground truth.** Bugbot's 78% is self-measured, so build Worklog's own replay set as planned.

---

## Sources

**Cursor (primary)**

- Docs: [cloud agents](https://cursor.com/docs/cloud-agent.md), [API endpoints](https://cursor.com/docs/cloud-agent/api/endpoints.md), [webhooks](https://cursor.com/docs/cloud-agent/api/webhooks.md), [agent metadata](https://cursor.com/docs/cloud-agent/metadata.md), [hooks](https://cursor.com/docs/hooks.md), [Slack](https://cursor.com/docs/integrations/slack.md), [Linear](https://cursor.com/docs/integrations/linear.md), [Bugbot](https://cursor.com/docs/bugbot.md), [rules](https://cursor.com/docs/rules.md), [automations](https://cursor.com/docs/cloud-agent/automations.md), [Agents Window](https://cursor.com/docs/agent/agents-window.md), [Projects](https://cursor.com/docs/agent/projects.md), [analytics](https://cursor.com/docs/account/teams/analytics.md), [Cursor Blame](https://cursor.com/docs/integrations/cursor-blame.md), [Rollouts](https://cursor.com/docs/rollouts.md), [PR Routing & Approval](https://cursor.com/docs/approval-agents.md), [mobile](https://cursor.com/docs/cloud-agent/mobile.md), [release notes](https://cursor.com/docs/release-notes.md).
- Changelogs: [1.0](https://cursor.com/changelog/1-0), [1.2](https://cursor.com/changelog/1-2).
- Blog: [Bugbot learning](https://cursor.com/blog/bugbot-learning), [Building Bugbot](https://cursor.com/blog/building-bugbot).

**Grok Bot (primary)**

- Announcement: [x.ai/news/introducing-grok-bot](https://x.ai/news/introducing-grok-bot).
- docs.x.ai: [overview](https://docs.x.ai/grok-bot/overview), [team bots](https://docs.x.ai/grok-bot/team-bots), [skills and routines](https://docs.x.ai/grok-bot/skills-routines-and-automations), [chat and collaboration](https://docs.x.ai/grok-bot/chat-and-collaboration), [bots](https://docs.x.ai/grok-bot/bots), [security](https://docs.x.ai/grok-bot/security), [tag on X](https://docs.x.ai/grok-bot/tag-on-x).
- cursor.com docs: [grok-bot](https://cursor.com/docs/grok-bot.md), [settings](https://cursor.com/docs/grok-bot/settings.md), [work](https://cursor.com/docs/grok-bot/work.md), [teams](https://cursor.com/docs/grok-bot/teams.md), [security](https://cursor.com/docs/grok-bot/security.md), [use cases](https://cursor.com/docs/grok-bot/use-cases.md).
- cursor.com help: [routines](https://cursor.com/help/grok-bot/routines.md), [team bots](https://cursor.com/help/grok-bot/team-bots.md), [pages](https://cursor.com/help/grok-bot/pages.md), [group chats](https://cursor.com/help/grok-bot/group-chats.md), [connect apps](https://cursor.com/help/grok-bot/connect-apps.md).

**Secondary**

- [Gigazine on Grok Bot](https://gigazine.net/gsc_news/en/20260812-spacexai-grok-bot/)
- [Flavio Copes deep dive](https://flaviocopes.com/grok-bot/)
- [ProgressiveRobot on Primary Bot](https://www.progressiverobot.com/2026/10/02/primary-bot-grok-4-7-base-model-proactive-grok-bot/)
- [Composio guide](https://composio.dev/content/guide-to-frok-bot)
- [Digital Applied](https://www.digitalapplied.com/blog/grok-bot-ai-teammates-launch-cloud-computer-2026)
- [OrcaRouter timeline](https://www.orcarouter.ai/ar/blog/grok-bot-launch) [U]
- SpaceX–Cursor deal: [Tribune/PTI](https://www.tribuneindia.com/news/business/spacex-to-acquire-ai-coding-startup-cursor-in-60-billion-deal-expects-q3-2026-close/), [Gigazine](https://gigazine.net/gsc_news/en/20260617-spacex-acquires-curso-anysphere/)
- Cursor forum on Memories: [1](https://forum.cursor.com/t/custom-modes-and-memories-gone-in-2-1/143744), [2](https://forum.cursor.com/t/are-my-memories-gone/144057)

**Casa candidates**

- [Capx Casa blog](https://capx.ai/blog/casa-runs-the-company), [docs: harnesses](https://capx.ai/docs/harnesses), [concepts](https://capx.ai/docs/concepts), [governance](https://capx.ai/docs/governance), [GitHub](https://github.com/Capx-AI/casa)
- [Cassidy AI](https://www.cassidyai.com/)
- [getcasa.com Casa AI](https://getcasa.com/updates/casa-ai)
