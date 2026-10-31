# How always-on agents work, and what Worklog's assistant takes from it

_Researched 2026-10-31 and 2026-11-01, from Lee Robinson's Stanford CS146S lecture "How always-on agents work" (2026-10-08), which explains how Grok Bot works. YouTube refused every download from this server, but Robinson also posted the full 45-minute recording natively on X, and that copy downloaded. All 46 slides were read frame by frame: slide changes were found with scene detection (the speaker's inset cropped out), every slide was read at full size, and a frame every 15 seconds across the whole recording was checked against them, so nothing between slide changes was missed. The talk was transcribed locally with Whisper (small.en). Two written guides to the lecture, read first, agree with the recording on everything they cover. Sources are listed at the end._

_Status: everything in §3 is implemented; see docs/ARCHITECTURE.md, "Attention lifecycle", "The assistant", "Memory" and "Scheduling". §4 lists what's left._

How claims are labeled:

- **[slide]**: read off a slide.
- **[said]**: said in the talk, from the transcript (machine transcription, so wording is approximate).
- **[code]**: read in this repo.

---

## 0. Recommendation (TL;DR)

The lecture's core point is that an always-on agent is the same model-calls-tools loop students write in week one. What changes is everything around the loop: the agent lives on a server, sleeps when there's nothing to do, wakes on events, keeps all state in a database, and treats silence as the default. Worklog was already built this way, as a server with a Postgres job queue, scheduled automations, deterministic gates before the model, and an inbox. Its gaps were in the parts that make the assistant feel like a colleague and keep it safe: learning during the day, coming back on its own when asked, staying quiet when there's nothing to say, keeping its prompt stable, checking visible actions with a second model, and keeping its harness tidy (one turn at a time, compaction off the hot path).

## 1. What the lecture says

The talk has six parts (the agenda lists a seventh, Q&A, which the recording doesn't include).

### 1.1 From laptop loop to server-side colleague

- **[slide]** "Your agent vs. an always-on agent": the week-one agent runs in a terminal, uses your laptop, remembers only its messages list, prints every reply, starts when you type and exits after one task. The always-on one runs on a server and survives crashes, deploys and a closed laptop; has its own small cloud VM with a desktop, browser and files; saves its state, memory and skills and summarizes old messages; messages you only through a send tool, so it can stay quiet; starts on events (your messages, schedules, Slack, phone calls, finished work); and works for months with the same memory across many conversations.
- **[said]** It's "more like a colleague": it can work quietly and come back only with something important, and "it knows when to be quiet."
- **[slide]** Four eras: copy and paste (2022–23), agents in the terminal approving each step (2024–25), apps built for agents with many running in parallel (2025–26), and now always-on agents you text.
- **[slide]** "From approving every step to steering": instead of approving each step, you redirect a working agent ("Also check the Slack thread", "Actually, make it Thursday"). An auto-review step approves safe actions so they don't wait for you. **[said]** In blind tests, the reviewing model now usually beats a human reviewing hundreds of shell commands.
- **[slide]** "As models get more capable, the interface gets simpler." Their implementation is called a Bot. The screenshot shows a list of bots (Sales Outbound, Chief of Staff, Inbox Manager, Debug…), a routine created from a request, and a "Salesforce isn't connected right now" card asking you to sign in. **[said]** Chat won because everyone knows how to text.

### 1.2 What changed in the models

- **[slide]** Six capabilities: work for hours; hand off to helpers with fresh context; use real tools (shell, files, browser, MCP); use a computer by looking and clicking; keep knowledge in files; learn by watching and save the steps as a skill.
- **[slide]** "What the agent knows lives in files": `memory/profile.md` (always in the prompt), `memory/log/2026-10.md` (dated facts, one per line), `skills/<name>/SKILL.md` ("Use this when…"), `routines/morning-brief` (a prompt plus "weekdays 8:00"). Tell it a preference once and it saves it; skills load only when needed. "Everything is computer." **[said]** A preference like lowercase messages has to be in every prompt.

### 1.3 Nothing runs when there's nothing to do

- **[slide]** "How does it stay always on?": a trigger (your message, a routine at 8:00) starts the agent process, which loads state, works, saves each step, and stops after 2 idle minutes. The computer sleeps on disk and is restored only when a tool needs it (a routine that doesn't need it leaves it asleep). Conversations, memory, routines and skills live in the server's database and storage.
- **[slide]** "What wakes the agent": you on any app, a routine (schedule or webhook), a Slack mention/DM/thread, a phone call or meeting, another agent, background work finishing, a scheduled check-in. All go through a router that drops duplicates and picks the conversation, then a conversation queue (one turn at a time), then "Anything worth saying?": send a message to the right place, or stay quiet. Every wake-up records where it came from, so the agent can tell whether you asked, a routine ran, or an outside service sent it. **[said]** Bots joining meetings to take notes is increasingly common at SpaceX; status updates should come roughly daily, depending on the task.
- **[slide]** "The agent's computer": a Firecracker VM per user with a supervised Debian container (file server, command runner, one virtual screen with its own Chrome per active agent). It sleeps a few minutes after the last activity, never mid-turn (files sync, memory and disk snapshot, machine stops), and wakes on the next tool call with logins and installed tools intact.
- **[slide]** "Three parts of the system": apps and channels (desktop, mobile and web, Slack, email/webhooks/schedules, phone calls and meetings) send into the server, whose entry point checks and routes input into a queue per conversation, then the agent loop and tools, which load and save state; tool calls go to the agent's computer. Every app shows the same conversation.
- **[slide]** "Why the agent runs on the server": thin client, thick server; work continues with the laptop closed; move between devices; ship without App Store review; offload heavy work; decouple the loop from app code; scale; agents that work for months can't live on a device. "Save everything on the server": the VM can always be rebuilt (**[said]** say, for an urgent Linux patch, without taking down the agent loop).
- **[slide]** "What happens when you hit send": the app shows the message at once and saves it with a unique ID, and the server drops IDs it has seen, so retries are safe; the message joins the conversation's queue and one turn runs, every step saved; the server sends a tiny "something changed" signal carrying no data, and each app fetches what's new; updates carry sequence numbers and an app that sees a gap reloads.
- **[slide]** "Durable workflows vs. job queues": a crashed job queue redoes finished steps; a durable workflow resumes at the failed step. Steps must be idempotent. Timers, cancellation and health checks come with engines like Temporal (**[said]** which they use).
- **[slide]** "Rules for handling new messages": your message in a 1:1 chat (or Stop) skips the line and can interrupt or stop the running turn; everything else (group chats, Slack threads, routines, helpers) waits at the back, and three quick messages become one turn. The agent works on one batch at a time.

### 1.4 The harness

- **[slide]** "One tool for talking to you": shell, files, browser, desktop, memory, skills, helper agents, cloud agents, app connectors, web search, image generation and screen recording all do work; only SendToUser reaches you, on desktop, web, mobile, Slack, email or voice. Thinking stays private; quiet is allowed; messages can be rich (files, multiple choice, secure password entry); and the last send can end the turn without another model call.
- **[slide]** "Pairing tools with the right UI": a sign-in form filled from 1Password, so the password never reaches the model; payment approvals that wait for Allow or Deny; email drafts you Send or Discard; and sometimes just an emoji reaction.
- **[slide]** "Load tool details only when needed": tool names up front, details on demand, leaving room for the conversation.
- **[slide]** "Try the cheapest option first": what it already knows, an app's API, web search, its own signed-in browser, the full desktop, and asking you last. If a connector is broken, it shouldn't work around it with the browser; it should tell you and ask.
- **[slide]** "Three ways to use a computer": read the page structure, click on pixels (1280×800), or ask a person at logins, codes, captchas or payments. A helper does the clicking so screenshots don't fill the main context.
- **[slide]** "One main agent, many helpers": the main agent answers quick questions and hands bigger tasks to a general, computer-use, video or cloud coding helper with a complete description, getting back a short report; a to-do list tracks every request, and it can check on, message or stop helpers.
- **[slide]** "Tips for designing agent tools": don't add or remove tools between turns (return a clear error instead); keep each description and schema under 4,000 characters; use a dedicated tool for saving state so reviewers can see what changes; write errors that say what to do next ("The computer is asleep. Use Shell or Read to wake it, then try again.").
- **[slide]** "How we keep it safe": automatic review (a separate model checks risky actions; if it blocks one you get an approval request, and no answer in 15 seconds means blocked); track the source (email and webhook text is labeled untrusted, memories are information, not instructions); asks first (it won't email or message people unless asked, and new routines need your OK); keep secrets hidden (passwords in environment variables, never to the model; actions on your own laptop need approval).

### 1.5 Context engineering

- **[slide]** "Keep the start of the prompt the same": tool definitions, the system prompt with a snapshot of memory and routines, and a first message with environment details and tool names stay identical until the next summary; history is only appended; the newest message carries the time, short notes on anything that changed, then your message.
- **[slide]** "Keep the main context small": long outputs go to files, screenshots and tool-heavy work to helpers, old messages to summaries, old memories stay searchable, and instructions become skills with a one-line pointer.
- **[slide]** "Treat a cache miss like a bug": the start stays identical until the next summary; a deploy that changes a tool description gives running conversations a note instead of new text; everything is built in a fixed, sorted order; tools are never added or removed for one turn; each section is hashed so a change can be located; the server prepares the prompt early, when you open the chat or start typing, to warm the cache.
- **[slide]** "Summarize while you're away": after a big turn (prompt over 100,000 tokens), about 10 minutes later while the provider's cache is still warm, write a summary using the same start of the prompt, so it reuses the cache; your next message starts from the summary. It's skipped if background work is about to wake the agent anyway, keeps the agent's last few messages to you word for word, and can also run mid-turn when a turn gets too long.
- **[slide]** "How the agent remembers": a profile of core facts always in the prompt (up to 100 facts in 4,000 characters), a log of dated events (the 30 most relevant recent ones in the prompt), short-lived notes, and everything else behind a memory search tool. Important facts rank higher and older ones slowly lower; after each turn a pass adds and replaces facts and can only remove facts it was shown; facts about you are shared by all your agents, each writing its own file; the model is told memories are information, not instructions.

### 1.6 Where this is going

- **[slide]** Training the model for the product: pre-training, supervised fine-tuning on the harness (tools and formats, when to send a quick reply, what an ideal response looks like), then reinforcement learning on real agent tasks (long instructions, skills and memories, clicking the right spot, working with other bots). The main agent is tuned for fast replies, helpers for long tasks.
- **[slide]** "Product and model improve together": an inner loop every day (a bot gets something wrong, it becomes an eval, the harness, prompt or inference is fixed, the evals are checked, the fix ships) and an outer loop every few months (train the next model on the harness and evals, swap it in, people use it in new ways, new behaviours to evaluate). "Every bot that doesn't work well becomes an eval."
- **[slide]** "Delete the product": assume models will get much better, build as little as you can around them, and remove what they no longer need.
- **[slide]** Expected in 6 to 12 months: longer projects, better memory ("they remember how you and your team work, and keep improving at it"), more powerful tools, simpler interfaces (texting, maybe voice only), skills they weren't trained for, and knowledge written down so agents can use it.
- **[slide]** Open problems: testing long-running agents; correct memory (replacing outdated facts, forgetting when asked, never making things up); prompt injection; when to speak (too many messages is noise, too few and you can't tell what it's doing); coordination of many agents sharing a computer and memory; cost (idle agents must be nearly free and active ones cheap).
- **[slide]** "The new building blocks": every web app had a server, database, cache and CRUD interface; every agent product will have durable workflows, memory and skills, connectors and auth, payments and identity, computer use, triggers and scheduled jobs, text and voice channels, and evals and observability. Takeaways: architecture compounds; build your own (start from the week-one agent and add a server, a computer and memory); learn the fundamentals.

### 1.7 Said, not on the slides

- **[said]** The router's real job is deciding whether something is worth bothering you about; a colleague who reports every bit of progress is annoying, and an update a day is often enough.
- **[said]** Untrusted input, like a phishing email or a webhook, must never reach the model as if it were your instruction; defending against prompt injection is still early.
- **[said]** For irreversible actions like sending an email, ask first, and keep passwords out of the conversation with product workflows.
- **[said]** Cache misses hit hard when OpenClaw users ran agents around the clock on subscription plans early in 2026, a usage pattern harnesses weren't tuned for. A fixed, hashed section order keeps an A/B test from breaking everyone's cache.
- **[said]** Memory works best when it's tended like a garden: core facts every time, dated logs, scratch notes that fade after half an hour or so, and files for everything else, like a brain keeping today's facts close.
- **[said]** Group chats full of bots are new, with little training data, and incidents like Moltbook and the Hugging Face attack show how badly multi-agent settings can go, so models have to be trained to behave in them.
- **[said]** Expect far more tokens flowing a year from now, which makes efficiency in models, inference and harnesses matter more. Every new product will either have an agent side or become data for someone else's agent.
- **[said]** Robinson still reads the code he ships, to understand its architecture, and mentions an open-source clone of Grok Bot on GitHub as a way to learn how the pieces fit.

## 2. Where Worklog already stood

**[code]** Much of the lecture's architecture was already here, under other names:

| Lecture | Worklog |
| --- | --- |
| Server-side loop, state in a database | `agent/loop.ts`; conversations and messages in Postgres, replayed verbatim |
| Durable workflows, retries | Graphile Worker jobs committed with their writes, retried with backoff |
| Router: dedupe, assign, queue | The ingest pipeline (lanes, ledger); `raiseAttention` collapses items by key and pulls the check forward with a 3-minute debounce |
| Routines (prompts on a schedule) | Automations: briefs, digests, the attention check, nightly memory, custom automations |
| Quiet is allowed | The check's deterministic gates and budget, the model allowed only to demote; custom automations can decide "quiet" |
| Prompt cache discipline | Stable instructions, per-turn context in the user message, append-only history, provider pinned for cache locality |
| Layered memory | Digest page, profile and facts, dated journal, `recall` with typo tolerance, nightly consolidation, weekly tidy |
| Untrusted content | `UNTRUSTED_NOTE` everywhere, outbound URL sanitizing, privacy enforced in queries |
| Memory never instructs | The constitution and voice can't be written by the assistant |

## 3. What changed

| # | Change | Lecture idea |
| --- | --- | --- |
| 1 | **The assistant learns once a conversation goes quiet.** A pass over what the owner said since the last pass writes private memory the same day, and later conversations know it. | A memory pass after every turn; tell it a preference once |
| 2 | **Settling waits for quiet.** Learning and compaction run ten minutes after the last message, debounced on the database clock, and compaction only skips the wait past twice its budget. | Compact after the user leaves; a cache miss is a bug |
| 3 | **One turn at a time per conversation, in arrival order.** Messages wait in the conversation's line (`turn_queue`) and the turn holds a lease (`turn_until`), so a message sent mid-answer reads that answer, and three sent in a row are answered in order. A streamed turn keeps the conversation until it's stored, whatever errors it hit. | A queue per conversation, one turn running at a time |
| 4 | **Follow-ups.** `follow_up` brings something back to the owner at the time they asked, through the attention check, past the day's budget, within active hours. Only ever to the owner. | "Actually do that on Thursday"; the agent comes back on its own |
| 5 | **Quiet briefs.** A scheduled brief with nothing in it records a quiet run instead of sending "nothing happened". | Quiet is allowed |
| 6 | **Learning from what people do.** When the last three pings of a kind were all dismissed and nothing of that kind was acted on, that kind is held for the digest, like "not useful" feedback. Acting on one, in Worklog or at its source, undoes it. | Learn from watching; when to speak is its own heuristic |
| 7 | **Passes only touch lines they were shown, and read only the owner's words.** Every pass filters `supersedes`/`forget` to the ids in its prompt. Messages store what was typed apart from what Worklog added for the model, and the pass reads a JSON transcript with roles, so text someone else wrote can't pass for the owner. Memory is framed as information, never instructions. | The memory pass may only remove facts it was shown; memory informs, never instructs; untrusted text is tagged |
| 8 | **Coming back after a while.** The first turn after two hours away lists what's in flight again, in the user message, so the prefix stays cached. | The newest message carries the time and what changed |
| 9 | **Sending again is safe.** Messages carry the client's id (`clientMessageId`, or useChat's message id), unique per conversation; a resend gets the first answer back instead of a second turn. | Clients give each message a unique id and the server drops duplicates |
| 10 | **Cache misses are logged.** A turn that should have read its history from the prompt cache and didn't logs a warning. The open-loops glance also lists the follow-ups still to come, so the assistant knows what it promised. | A cache miss is a bug |
| 11 | **Ratings.** A reply can be rated helpful or unhelpful, with a note. The owner's ratings feed the memory pass ("too long; answer first" becomes a line about how they want answers), and every rating is kept with what it answered (`GET /v1/ratings`). | The inner loop: a mistake becomes an eval |
| 12 | **A memory page that holds still.** A conversation keeps the memory page its first turn took (the digest, plus what was learned and forgotten since) until its next summary, or until it's picked up after two hours; changes since reach the model as notes in its newest message, each once. The instructions now change only with the owner's voice or a summary. | Keep the start of the prompt the same until the next summary; the newest message carries short notes on what changed |
| 13 | **Every turn says where it came from.** The newest message names its channel (the Worklog API, Slack or Discord) as well as the time and who's asking. | Every wake-up records where it came from |
| 14 | **Tool errors say what to do next.** A tool pointed at something that isn't there answers with how to find it ("use search_cards to find the card's number"). | Write errors that say what to do next |
| 15 | **Automatic review, and approvals the owner gives by hand.** Writes teammates will see run only once a separate fast model, reading only what the owner typed, finds they asked for it. Otherwise the write waits in the owner's attention list with Allow and Deny, and their tap runs exactly what was proposed without a model. A move planted in a teammate's comment isn't acted on, and the assistant can't approve itself. | A separate model checks risky actions; you get an approval request; purpose-built controls for approvals |
| 16 | **Routines run as agent turns.** Custom automations look things up with read-only tools (the team version with a teammate's) and speak only through `send_message`, so most runs end quiet. | A routine is a prompt on a schedule; SendToUser; quiet is allowed; cheapest option first |
| 17 | **Routines the assistant suggests.** `propose_routine` turns a repeated request into a routine, and it always waits for the owner's Allow. | Learn by watching; new routines need your OK |
| 18 | **Stop and interrupt.** The owner can stop a running answer, or send a message with `interrupt` to stop it and be answered instead. | Your 1:1 message skips the line and can stop the running turn |
| 19 | **Helpers and capped lookups.** `look_into` hands heavy lookups to a helper with a fresh context and returns only its report; oversized results keep their first items and say how to narrow; tool definitions stay under 4,000 characters. | One main agent, many helpers; keep the main context small; tool descriptions under 4,000 characters |
| 20 | **Usage, cache warming and replays.** Turns record their tokens and cache hits (`GET /v1/assistant/usage`); a client can warm a conversation's cache when someone starts typing; rated replies can be replayed against today's prompts and model. | Treat a cache miss like a bug; warm the cache when you start typing; every bot that doesn't work well becomes an eval |

## 4. Not done yet, in the order I'd take them

1. **Bursts become one turn.** Messages sent in a row are answered one by one, in order. The lecture merges three quick messages into a single turn; that needs the API to answer a batch rather than one message per request.
2. **Rich replies.** SendToUser can carry multiple choice and secure password entry. Worklog's replies are Markdown; structured choices would need a client to render them.
3. **Rank memory by importance.** Recall ranks by match and recency; the lecture ranks important facts higher and lets older ones fade slowly.
4. **Watch the cache in a dashboard.** Usage is recorded per turn and summed on request; trends over time and alerts on a falling hit rate would come with observability tooling.

Two of the lecture's ideas don't fit Worklog as it is: summaries that reuse the conversation's cache (Worklog's compaction sends a small text transcript to the fast model, which already costs less than replaying the full prompt), and a cloud computer per user (Worklog's assistant works through the API's own data, not a desktop).

## Sources

- Lee Robinson, ["Stanford CS146S: How always-on agents work"](https://www.youtube.com/watch?v=L1OBRtfPS34) (2026-10-08); the same recording is posted natively in [his post on X](https://x.com/leerob/status/2108650243365736855), which is the copy read here.
- lushinshang, ["cs146s-always-on-agents"](https://github.com/lushinshang/cs146s-always-on-agents), a detailed guide in Traditional Chinese, with figures redrawn from the slides; used as a cross-check.
- Franklin Javier, ["How an agent loop works"](https://franklinjavier.com/blog/how-always-on-agents-work/), a write-up with timestamps and slide figures; used as a cross-check.
- xAI, [Introducing Grok Bot](https://x.ai/news/introducing-grok-bot) (2026-08-11) and [Designing Grok Bot for a world of persistent agents](https://x.ai/news/designing-grok-bot) (2026-09-03), cited by the guide.
- Earlier notes in this folder: [inspirations-cursor-grok-casa.md](inspirations-cursor-grok-casa.md), [proactive-agents.md](proactive-agents.md), [instinct-memory.md](instinct-memory.md).
