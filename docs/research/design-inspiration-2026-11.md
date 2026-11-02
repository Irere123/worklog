# Design inspiration, November 2026

Research date: 2026-11-01. This note covers what well-regarded product teams are shipping now and what Worklog should take from it, screen by screen. The assistant chat gets the most detail. Everything here sits under [DESIGN.md](../DESIGN.md) and the [web app brief](web-app-design.md). Where they conflict, they win.

**How each claim was checked**

- **[seen]**: I opened the page in headless Chromium and looked at the screenshot. For ChatGPT, I sent a real logged-out prompt and captured frames while it answered.
- **[src]**: I read the source code or the published document.
- **[2nd]**: a secondary source, such as a teardown, a search summary or a changelog snippet. Treat these as observed behaviour, not a spec.

## 1. Sources

| Source | URL | Result |
| --- | --- | --- |
| Godly | https://godly.website | [seen] Masonry gallery: monochrome chrome, filter chips, a jobs rail. Mostly marketing sites, with little product UI. |
| Refero | https://refero.design | [seen] Has become a prompt-first "research mode": a composer, mode chips and a list of suggestions marked with ↳. |
| Mobbin | https://mobbin.com/explore/web | [seen] The public page is categories only; the screens are behind a login. |
| Curated | https://curated.design | [seen] Also prompt-first ("What are you building?"), with category chips and a count ("2,925 websites"). |
| Land-book | https://land-book.com | [seen] Landing-page gallery; nothing to learn for app UI. |
| Cosmos | https://www.cosmos.so/discover | [seen] Only warm-grey skeletons rendered. Even those match the final layout. |
| Saaspo, SiteInspire | saaspo.com, siteinspire.com | Blocked by Cloudflare or a Vercel checkpoint. Skipped. |
| Linear, "A calmer interface…" | https://linear.app/now/behind-the-latest-design-refresh | [src] The March 2026 refresh. Details in §2.2. |
| Linear Agent Interaction Guidelines | https://linear.app/developers/aig, https://linear.app/developers/agent-interaction | [src] Six principles, plus the session states and activity types. |
| Vercel Web Interface Guidelines | https://github.com/vercel-labs/web-interface-guidelines | [src] Read on GitHub, because vercel.com blocks headless browsers. |
| Rauno, Interfaces | https://github.com/raunofreiberg/interfaces | [src] |
| Emil Kowalski | https://emilkowal.ski/ui/great-animations (blocked); his rules via the local `emil-design-eng` skill | [src] |
| Devouring Details, Raycast, Things | devouringdetails.com, raycast.com, culturedcode.com/things | Devouring Details and raycast.com/core-features/ai failed the browser check, and raycast.com's home page returned a 500. Things has nothing beyond what the existing brief already takes. |
| Vercel AI Elements | https://github.com/vercel/ai-elements (`packages/elements/src`) | [src] Read 16 components: reasoning, tool, chain-of-thought, task, plan, queue, conversation, message, prompt-input, suggestion, context, sources, inline-citation, shimmer, confirmation and checkpoint. |
| ChatGPT | https://chatgpt.com | [seen] Logged out, two prompts, frames at 1.2s, 2.5s, 4s and the end. |
| Grok | https://grok.com | [seen] Saw the empty state and composer. A logged-out reply hits a sign-up wall. |
| Cursor 3 and the Agents Window | https://cursor.com/changelog/3-0 | [2nd] The site blocks bots, so this comes from changelog snippets in search results and our [earlier notes](inspirations-cursor-grok-casa.md). |
| Grok Bot | our [earlier notes](inspirations-cursor-grok-casa.md) §2 | [src] Approval cards, needs-you states. |
| Perplexity and ChatGPT citations | https://aiuxplayground.com/teardowns/perplexity/citations, …/chatgpt/citations | [2nd] Perplexity itself blocks headless browsers. |
| Claude.ai, v0 | claude.ai, v0.app | Login wall and Vercel checkpoint. Nothing verified this round. |

## 2. Patterns observed

### 2.1 Galleries: what recurs among the best of 2026

1. **Galleries now lead with a composer.** Refero and Curated both open on a centred prompt box, with mode chips inside it and a short list of suggested prompts below. ChatGPT and Grok look the same. The composer has become the most probable screen, so a composer alone no longer says anything about a product (DESIGN.md, editor's pass 1).
2. **Monochrome chrome.** The chrome is black or ink pill buttons on off-white, with colour only in the content. Grok's page is a warm off-white, close to our paper neutrals.
3. **Filter chips in a row,** with a count beside them ("2,925 websites").
4. **Skeletons that match the final layout** (Cosmos): warm grey, with the same card and caption rhythm as the loaded page.
5. **Serif display type** for one headline (Refero, Geist Serif on Godly), never in the working UI.

### 2.2 Design engineering

- **Linear's 2026 refresh** [src]. Its rule is "Don't compete for attention you haven't earned":
  - The sidebar is "a few notches dimmer" than content, the tabs are more compact, and there are fewer and smaller icons, with no coloured icon backgrounds.
  - "Structure should be felt not seen": fewer separators, with softer contrast and rounded ends.
  - Header actions (share, copy link, open PR) sit in the same place on every page.
  - The palette moved from blue-grey toward "a warmer gray that still feels crisp… go too warm and it looks muddy". They tuned token hue, chroma and lightness with an in-app dev-toolbar tool built in a couple of hours.
- **Linear AIG** [src]. An agent:
  - discloses that it's an agent and works through the platform's normal actions;
  - gives instant but unobtrusive feedback, and is transparent about its state: thinking, waiting for input, executing or finished, with its reasoning and tool calls open to inspection;
  - disengages when asked, and has a human who stays accountable for it.

  Session states are `pending`, `active`, `error`, `awaitingInput`, `complete` and `stale`. Activity types are thought, action, elicitation, response and error.

- **Vercel guidelines** [src], the rules our docs don't already cover: loading states get a ~150–300ms show delay and a ~300–500ms minimum, so fast responses don't flicker. In-progress labels end in "…". Only the first tooltip in a group waits. Interaction states raise contrast, and status never relies on colour alone. Use curly quotes, and a non-breaking space inside `⌘ K` and `10 MB`. `theme-color` matches the background, drawers get `overscroll-behavior: contain`, and no screen is a dead end.
- **Rauno** [src]: no transitions when the theme switches, and interaction animation at or under 200ms. Frequent, low-novelty actions don't animate (context menus, adding or removing list items, hovering trivial buttons). Menus open on `mousedown`, focus rings use `box-shadow` so they follow the radius, ↑/↓ move through lists and ⌘⌫ deletes, and disabled buttons get no tooltip.
- **Emil Kowalski** [src]: ease-out is `cubic-bezier(0.23, 1, 0.32, 1)`, and keyboard-initiated actions never animate. The pressed state is `scale(0.97)`; things enter from `scale(0.95)` plus opacity, never from 0. Popovers scale from their trigger, while modals stay centred. Prefer CSS transitions, which can be interrupted, to keyframes, and use a 2px blur to hide a crossfade that doesn't sit right.

### 2.3 AI chat today

**ChatGPT** [seen]

- **Send becomes Stop in place.** The round send button turns into a filled square while the reply runs. It goes back to a pale, disabled arrow once the reply ends and the box is empty.
- **The question moves to the top.** On send, the user's message scrolls to the top of the viewport and the reply grows below it, with empty space reserved underneath. It doesn't follow the bottom.
- **Pending is quiet:** first a single pulsing dot where the reply will start, then one muted line with an icon ("🌐 Searching the web") above a hairline, which the text replaces.
- **Anatomy:**
  - The user's message is a tinted bubble, right-aligned, about 70% wide.
  - The assistant's reply has no bubble and no avatar: a reading column about 768px wide, with headings, lists, small labelled tags ("Best for simplicity") and code blocks with a language label and a copy button.
  - Sources come as a closing list of links marked ↗.
- **Actions:** small muted icons sit under the finished reply: copy, share and "More actions" (accessible names "Copy response", "Share", "More actions"). A "Scroll to bottom" button appears when you're scrolled up.
- **The composer** has a `+` for "Add files and more", a removable "Web search" chip, an "Expanded composer" toggle, dictation and voice.

**Grok** [seen]

- A warm off-white page, and the headline "What should we explore?".
- The composer's placeholder says "Type / to use slash commands". It has a `+`, a mode chip ("Fast ▾") and a round send button that stays pale until you type.

**Vercel AI Elements** [src]. These are the de facto building blocks:

- **Reasoning:** opens on its own while streaming and closes 1s after it ends. The trigger shimmers "Thinking...", then reads "Thought for N seconds", or "a few seconds" when the duration is unknown.
- **Tool:** a header with the tool name, a status badge and a chevron. The statuses are Pending, Running, Awaiting Approval, Responded, Completed, Error and Denied. Opening it shows Parameters, then a Result or Error.
- **Steps:** Chain of thought marks steps complete (muted), active (full ink) or pending (half-muted). Task is a collapsible title with file chips. Queue lists pending and done items, done ones struck through, with actions on hover.
- **Approvals and history:** Confirmation has request, accepted and rejected states. Checkpoint is a bookmark you can restore the conversation to. `MessageBranch` pages versions (‹ 1 of 3 ›).
- **Sources:** "Used N sources" with a chevron, and InlineCitation, a hostname badge with +N that opens a hover card paging 1/N.
- **Around the thread:** Context is a ring meter of % used, tokens and cost. Suggestion is a sideways-scrolling row of outlined pills. Conversation uses `use-stick-to-bottom`, with a round ↓ button only when you're scrolled up.
- **PromptInput:** Enter submits but waits while an IME composition is open. The submit icon goes ↵ → spinner (submitted) → ■ (streaming; clicking it stops) → × (error). It takes attachments by paste and drop, and has a `+` action menu, a model select and a slash-command list.

**Citations** [2nd]

- Perplexity and ChatGPT put a publisher chip at the end of a claim ("foxsports +2"). It opens a popover anchored to the chip that pages 1/2 between sources.
- A favicon stack and "10 sources" in the action bar opens a side panel.
- Research steps fold into "Completed 2 steps".
- Perplexity's thumbs-down asks for a reason: Out of date, Inaccurate, Wrong sources, Too long or Too short.
- Selecting text offers "Check sources".

**Cursor 3** [2nd]

- **Queue and steer are two different acts.** A queued message waits until the task finishes and is listed under the active task, where you can drag to reorder. A follow-up sent now steers the turn at its next tool call.
- Todo cards stay visible after every item is done.
- Thinking blocks fold even while streaming.
- One sidebar holds every agent, wherever it was started.
- In Slack, it posts a plan only when the plan helps, and keeps one status line edited in place.

**Grok Bot** [src, earlier notes]

- Approval cards offer Allow once, Always allow or Deny, and only the person who asked can answer.
- States are needs you, working and new result.

### 2.4 What the best ones share

1. Text from the assistant has no bubble; the person's message has a quiet one.
2. Work shows as one-line, present-tense status that settles into a past-tense summary with a count or a time: "Thought for 6s", "Completed 2 steps", "Used 4 sources".
3. Each control has one place: send and stop share it, and actions sit under the turn.
4. The question you asked stays in view; the page never chases the bottom against your scroll.
5. Every claim can be checked from where it's made.
6. The chrome is monochrome with few icons, and colour is saved for state.

## 3. Recommendations

Priorities: **P1** to do next, **P2** soon, **P3** when the surface is touched anyway. The current chat already gets several things right: one-line tool steps with "doing" and "did" verbs, Stop with Esc, the polite status region, ratings and suggested prompts. Keep them.

### 3.1 Assistant chat: the spec

**Message anatomy (P1)**

- **Your turn:** a right-aligned bubble on neutral step 3, radius 12px, at most min(80%, 560px), in 14px reading copy. Drop your own avatar, since you know who you are.
- **The agent's turn:**
  - No bubble, in a 680px reading column at 14/22.
  - A header line opens a run of agent turns: the agent's face (20px rounded square), its name and the time, formatted like the log line. That keeps DESIGN.md's "each agent has a face" without an avatar on every turn.
- **Order inside a turn:** work rows (reasoning and tools), then the text, then "Based on…" sources, then actions.

**Work rows: tool calls (P1).** One component, also used in Activity and the card panel (§3.2).

- **Shape:** one line, 28px high: a 14px Phosphor icon for the tool, muted, then a phrase that names the object.
  - "Read #8 Login fails on Safari", with `#8` in mono as a link.
  - "Searched activity for “deploy” · 12 results".
  - "Saved to memory: prefers mornings".

  Build the object from the tool's input and output, and never show the raw tool name.

- **Running:** a present-tense verb ending in "…", with a slow shimmer in ink colour; under reduced motion it's static.
- **Done:** a past-tense verb and the tool's own icon. No green check: success is the default and doesn't need a mark.
- **Error:** `WarningCircleIcon` in red with plain words and a way out: "Couldn’t read #8. It may have been deleted · Retry".
- **Awaiting approval:** the row expands into an inline card with the operation and its inputs, plus **Allow once / Always allow / Deny**. The same item shows in the Inbox as attention, and only the requester can answer it. Afterwards the row reads "You allowed: Send to #design" or "You declined…".
- **Fold reads, never writes.** When a turn ends, three or more consecutive read rows fold into one row: "Checked 4 things · 3s ›".
  - Writes (create, move, comment, log, send, remember) never fold. Each stays visible as a log line with **Undo** where it can be reversed, because writes are the record.
- **Expanded,** a row shows input and output as labelled key-values in 12px; the raw JSON sits behind "Show raw". Replace today's JSON dump.

**Reasoning (P2, when the model streams reasoning parts)**

- A row reads "Thinking…" while the model streams reasoning, then "Thought for 6s" in tabular numbers.
- It stays **collapsed by default**, unlike AI Elements, which opens while streaming: calm wins.
- Expanded, it shows 13px muted text behind a left hairline.
- If reasoning takes under 1s, show no row. Use `BrainIcon` or no icon, never sparkles.

**Pending and streaming (P1)**

- **Pending:** right after send, the agent's header line appears with a small pulsing ink dot where text will start (ChatGPT). Work rows or text replace it.
- **The polite status region and `aria-busy` stay.** The visible "Thinking…" label shows only if nothing arrives within ~300ms, following Vercel's show-delay rule.
- **Streaming:** each new chunk fades in over 120ms with opacity only, and there's no blinking cursor. Keep incomplete Markdown hidden until it closes, as Streamdown does.
- **Stopping** keeps the text so far, adds a muted "Stopped" meta line and offers Retry.
- **Errors appear inline** under the turn as well as in the toast: "That didn’t finish: the model took too long. Retry."

**Scroll (P1)**

- On send, scroll so your message sits at the top of the viewport, and give the reply a minimum height of the viewport minus the composer.
- Follow new text only while you're at the bottom.
- When you're scrolled up, show a 32px round `ArrowDownIcon` button centred just above the composer, with a dot when new text has arrived.
- The button must not cover the last line or a hint (editor's pass 4).

**Actions (P1, with branches at P3)**

- **Agent turns:** Copy, Helpful, Not helpful, Retry (`ArrowClockwiseIcon`) and More (`DotsThreeIcon`). More offers Copy as Markdown, Turn into a card and Pin.
  - They're always shown on the latest turn. On older turns they appear on hover or focus-within, behind `media.hover`, and always show on touch.
  - Icons are 16px with 28px hit targets, and tooltips carry their shortcut.
  - After a copy, the icon becomes a check for 1.5s.
- **Not helpful** opens a small menu of reasons: Wrong, Out of date, Missed something, Wrong card or person, Too long. Its result goes to feedback, as Perplexity's does.
- **Your last message** gets Edit (`PencilSimpleIcon`, or ↑ in an empty composer), which edits in place and runs again, and Copy.
- **P3:** Retry and Edit keep the earlier version, with a "‹ 2 of 2 ›" pager on the turn.

**Sources (P2).** This is what only Worklog can do: an answer cites the logbook.

- **Inline:** cards as mono `#8` links, and people by name. A claim drawn from activity ends in a chip made of the source mark and a count ("GitHub +2"). It opens an anchored popover of the actual `ActivityLine` rows, paging 1/3.
- **At the foot of the turn:** "Based on 6 events" with a stack of source marks. It opens a side sheet (a full-width sheet on phones) listing those log lines.
- Show no "AI can make mistakes" footer. The citations do that job, and honestly.

**Composer (P1 for the basics, P2 for mentions and the queue)**

- **Box:** a hairline-bordered box with radius 12px. The text is 14px, or 16px under 640px. It grows up to 40% of the viewport.
- **Placeholder:** "Ask Atlas about your work…", with the agent's real name.
- **Keys:** Enter sends, Shift+Enter makes a new line, and Enter does nothing during IME composition.
- **Bottom row, left:**
  - A `+` menu: Attach a file, Link a card `#`, Mention someone `@`.
  - In teammate mode, a scope chip ("Team-visible only") replaces the banner. It's honest about what that assistant can see.
- **Bottom row, right:** a 28px round ink send button (`ArrowUpIcon`), pale while the box is empty.
  - It becomes Stop (`StopIcon`, filled) in the same spot while a reply runs, and Esc does the same.
  - Swap the icons with no slide; a 100ms opacity crossfade is enough.
- **Typing during a reply:**
  - Enter **queues** the message. It shows as a muted row above the composer ("Queued: …", with edit and remove) and sends when the turn ends.
  - ⌘Enter **sends now** and steers the turn: today's `interrupt`.
  - Label both actions in the tooltip.
- **Triggers:** `#` autocompletes cards, `@` people and agents, and `/` commands: `/log`, `/card`, `/remember`, `/forget`, `/brief`. Each is a cmdk list anchored above the composer, with no animation.
- **Skip** the token or context meter and the model picker. People don't manage tokens here, and Memory is the context page they can read.

**Empty state (P2)**

- Show the agent's face (44px), its name, and one honest line on what it can see: "Knows your cards, your inbox and the last 30 days of activity."
- Below that, three suggestions built from real state, such as "What’s blocking #12?", "What shipped since Monday?" or "Anything I should answer today? (3 waiting)".
- Show them as a left-aligned list marked `ArrowElbowDownRightIcon`, which Refero uses, not a sideways pill scroller that hides options.

**Conversation list (P2)**

- Group under sticky 11px captions: Today, Yesterday, Previous 7 days, then month names.
- Titles get an ellipsis at a word end.
- A running conversation shows a small pulsing dot, and one waiting on your approval shows an amber dot (needs you).
- Rename and Delete sit in a `…` menu. Delete is undoable through a toast.
- Search the list with `/` when it's focused.

**Keys:** Esc stops. ↑ in an empty composer edits your last message. ⌘⇧C copies the last reply. `J`/`K` move between turns once the composer is blurred. All of them are listed under `?`.

**Motion:**

- New turns enter with opacity and `translateY(4px)` over 180ms ease-out.
- Fold and unfold through `grid-template-rows: 0fr → 1fr` over 200ms. It's instant when a key triggered it, and under reduced motion.
- Nothing animates on send.

### 3.2 Other surfaces

- **Shell (P1).** Following Linear: dim the sidebar a step or two below content, cut icon count and size, and drop coloured icon backgrounds. Use softer, fewer borders, and keep header actions in one slot on every page. Set `theme-color` from the background token and suppress transitions while the theme switches. A dev-only hue, chroma and lightness tuner would let us warm the neutral without going muddy.
- **Home (P2).** The composer-first look is now everyone's. Lead instead with a sentence only Worklog can write, taken from the log ("Since yesterday: 3 cards moved, 1 needs you"), with the composer and state-built suggestions beneath. Skeletons mirror the final rows.
- **Inbox (P1).** Approval items use the chat's approval card (Allow once, Always allow, Deny). Dismissing asks for an optional one-tap reason (Not mine, Already handled, Too noisy) that trains muting. Row actions appear on hover or focus, with key hints.
- **Board and card panel (P2).** While an agent works a card, the card shows one live status line edited in place ("Atlas is reading #8…"), as Cursor does in Slack, never a series of posts. The panel's history uses the shared work rows, so agent bursts fold into "Atlas did 6 things · 2m ›" while writes stay visible.
- **Activity (P1).** Agent runs and repeated events use the same fold. The exact time is on hover, day headers are sticky, and skeletons match `ActivityLine`.
- **Briefs (P2).** Claims carry the chat's source chips and "Based on N events" sheet. The page has a finite end ("That’s everything since Monday"), and "Not helpful" asks for reasons, as in chat.
- **People (P2).** Map agent sessions onto working / needs you / finished / failed, plus Linear's **stale** for a working agent that has gone silent past a threshold. Every state has a text label, not colour alone.
- **Settings (P3).** The Memory page lists what the assistant remembers, with source and date, and an undoable Forget. Connection rows show their last event.
- **Command menu (P1).** No open or close animation, and it opens on keydown. The last item is always "Ask Atlas: “<query>”", which carries the text into the chat composer. Results are grouped under captions, with shortcut hints at the right edge.

### 3.3 Avoid

- Glowing or gradient composers. Godly's sponsor slot has a blue neon one.
- Purple or sparkle "AI" marks and brain-sparkle hybrids. `design-check` already fails sparkles.
- Reasoning that auto-opens, and spinners stacked in every row.
- Token or cost meters and model pickers in a teammate's tool.
- Disclaimers in place of citations, and sideways-scrolling suggestion pills.
- Bubbles around the assistant's text, avatars on every turn, and raw JSON as the default tool detail.

## 4. Applied on 2026-11-01

What the web app took from §3, and what it left.

- **Taken:** no bubble or per-turn avatar on replies, with a face, name and time line instead; steps in plain words with each tool's icon and result counts; lookups folding into "Checked N things · 3s" while writes stay in view; reasoning folded even while it streams; held writes inline with Allow and Deny; "Thinking…" only after 300ms; Send becoming Stop; actions pinned on the latest reply, with copy turning into a check; "Not helpful" asking what was off; a scroll-to-latest button; Markdown that closes unfinished marks while streaming; inline errors with Try again; stopping keeping what was written; `#` card links in the composer; ↑ to bring back the last question; suggestions built from real state; the conversation list grouped by recency; card hover previews; what a lookup found, listed when a step opens; agent run states on People; renaming a conversation by clicking its title, and deleting one with Undo; an agent's live run shown on its card, in the tile, the panel and the hover preview; "Less like this" offered in the toast that confirms a dismiss.
- **Left for later:** a queue for messages sent mid-reply (Enter still steers, as ARCHITECTURE.md describes); editing a sent message and reply versions, which the append-only history doesn't allow yet; source chips inside the reply text; a dev-only colour tuner.
