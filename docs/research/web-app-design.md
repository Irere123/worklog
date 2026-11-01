# Web app design brief

Research date: 2026-11-01. This note guides the first web app (`apps/web`): which products each surface borrows from, the UI fundamentals the design system follows, and the stack. Sources are linked inline. Claims marked **[unverified]** come from secondary sources only.

## 1. Inspirations, by surface

| Surface | Borrow from | What we take |
| --- | --- | --- |
| Board | **Fizzy** ([help guide](https://help.fizzy.do/3/fizzy-help-guide), [source](https://github.com/basecamp/fizzy)) | Not now and Done at the edges, collapsed to vertical pills with counts. New cards land in Maybe? (our `triage` stage). No manual ordering; golden tickets are the only way to the top. A round countdown badge in the last quarter of the drift window ("Closes in 5 days"). Closure stamps that name who closed and when, styled differently when the system did it. A card meta line: number, creator, age, last activity, → assignees. The pin stack (at the foot of the sidebar on every page, `P` and `⇧P`), `#` to link a card from a comment or description, and Fizzy's keys: `1` Home, `2` Assigned to me, `3` Added by me, `B` new board, `F` filter, and on a card `E` edit, `A` assign, `T` tag, `D` done, `⇧N` watch. |
| Board | **Linear** ([agents](https://linear.app/docs/agents-in-linear), [AIG](https://linear.app/developers/aig)) | Agents get a badge wherever people appear, and a human stays accountable for them. |
| Attention | **Linear inbox and triage** ([inbox](https://linear.app/docs/inbox), [triage](https://linear.app/docs/triage)), **GitHub notifications** ([docs](https://docs.github.com/en/subscriptions-and-notifications/how-tos/viewing-and-triaging-notifications/managing-notifications-from-your-inbox)), **HEY** ([features](https://www.hey.com/features/)), **Superhuman** [unverified keys] | One verb per key: J/K move, E done, H snooze, X dismiss, Y allow, N deny, Z undo. A reason on every row (why it's here). Snooze picks natural times. Dismissing teaches Worklog what to mute (our feedback endpoint). A calm empty state that says when the next snoozed item returns. |
| Activity | **Fizzy home**, **Vercel activity log** ([docs](https://vercel.com/docs/activity-log)), **HEY Paper Trail** | Day-grouped feed, newest first, live. Source icon, actor (with agent badge), verb, object, relative time with the exact time on hover. Filters as words. Repeated events collapse into one row (`count`). |
| People / Now | **Linear agent session states**, **Basecamp check-ins** ([page](https://basecamp.com/features/checkins)) | Per person: what they're on now, what's next, recent work, and a working / needs you / finished / failed state for agents. |
| Assistant | **Claude and ChatGPT memory** ([Claude](https://support.claude.com/en/articles/11817273-using-claude-s-chat-search-and-memory-to-build-on-previous-context)), **Copilot agent sessions** ([docs](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/track-copilot-sessions)), **Perplexity** steps ([case study](https://www.langchain.com/breakoutagents/perplexity)), **Raycast AI** saved prompts | A thinking state right away, and Stop always visible during a reply (Esc). Stopping keeps what was written. Sending mid-reply steers (our `interrupt`). Thumbs up or down per reply. Memory is a page you can read, filter and forget from. The owner's instructions are a separate pane the assistant can't edit. Asking a teammate's assistant shows a banner saying it only sees their team-visible work. Suggested prompts on an empty chat. |
| Briefs | **Linear Pulse** ([docs](https://linear.app/docs/pulse)), **ChatGPT Pulse** [unverified] | Finite, dated briefs read like a page, never an endless feed. A "make one now" button. |
| Settings | **Vercel integrations** ([docs](https://vercel.com/docs/integrations/install-an-integration/manage-integrations-reference)) | One row per connection: status, last event, manage. A health page with recent deliveries and failures. API tokens show the secret once. Delivery targets are labelled team or private. Routines show the next run and have Run now. |
| Shell | **Linear 2024 and 2026 redesigns** ([2024](https://linear.app/now/how-we-redesigned-the-linear-ui), [2026](https://linear.app/now/behind-the-latest-design-refresh)), **Things 3** ([features](https://culturedcode.com/things/features/)) | An inverted-L chrome with a sidebar a few notches dimmer than content. A warm, low-saturation gray. Small icons, no coloured icon tiles. Header actions in the same place on every page. ⌘K for everything; `?` lists the shortcuts. Calm whitespace. |

Height shut down in September 2025 and Campsite is winding down, so they were left out. No work or agents product called "Casa" turned up.

**Avoid:** priority fields and drag-to-reorder (Fizzy dropped both on purpose), badge counts on everything (count only attention), rows that can't say why they're there, opaque agent work, memory you can't inspect, endless AI feeds, and decorative glass and gradients in dense UI.

## 2. Fundamentals the design system follows

- **Colour.** A 12-step scale per hue with fixed roles ([Radix](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)):
  - 1–2 for backgrounds
  - 3–5 for component states
  - 6–8 for borders and focus
  - 9–10 for solid fills
  - 11 for muted text and 12 for text

  Values are OKLCH, written as `light-dark()` pairs, so `color-scheme` alone switches the theme. Components use role tokens, never raw values. Neutrals lean warm (Linear 2026). There is one accent (indigo). Status colours are green (done), amber (needs you), red (failed or blocked) and violet (agents). Gold is reserved for golden tickets.

- **Type.**
  - Fonts: Inter Variable with optical sizing, and Geist Mono for numbers, ids and keys.
  - Sizes: 13px label (the default), 12px meta, 11px caption, 14px reading copy (chat, briefs, card bodies), 15/18/24px titles.
  - Weights: 400, 500 and 600 only, and never a change of weight on hover.
  - `tabular-nums` for counts and times; `text-wrap: balance` on headings, `pretty` on paragraphs.
- **Space and shape.**
  - A 4px grid.
  - Heights: rows and buttons 32px (28px small), sidebar items 28px.
  - Radii: 4px badges, 6px controls, 8px cards and popovers, 12px dialogs.
  - Borders for structure. Shadows only for things that float, two layers plus a hairline ([Vercel guidelines](https://vercel.com/design/guidelines)).
- **Motion** ([Emil Kowalski](https://emilkowal.ski/ui/great-animations), [Rauno](https://interfaces.rauno.me)).
  - 150–200ms ease-out, animating only transform and opacity.
  - Popovers scale from 0.96 at the trigger's origin.
  - No animation on keyboard actions, the command menu or theme switches.
  - Reduced motion falls back to opacity.
- **Interaction.**
  - `:focus-visible` rings on everything; hit targets of at least 24px.
  - Links for navigation, so Cmd-click works.
  - Optimistic updates with rollback, and Undo instead of confirm dialogs for reversible actions.
  - Skeletons for first loads; spinners inside the button that started the action.
  - State that matters lives in the URL: the open card, filters and tabs.
- **Accessibility.**
  - Every drag has a menu alternative ("Move to…"), following [Atlassian's guidance](https://atlassian.design/components/pragmatic-drag-and-drop/accessibility-guidelines).
  - Streaming replies are not live regions. A separate polite status says "responding" and "done", and the message carries `aria-busy`.

## 3. Stack

| Need | Choice | Why |
| --- | --- | --- |
| Framework | TanStack Start (SPA mode) with TanStack Router | Typed file routes, search params as state. SPA mode because every page sits behind sign-in, so the server has nothing to render. |
| Styling | StyleX (`@stylexjs/unplugin`) | Typed, atomic, colocated styles; `defineVars` tokens with `light-dark()` values. |
| Data | TanStack Query with `openapi-fetch` and types generated from the API's OpenAPI spec | One contract: a renamed field fails the typecheck. Live updates invalidate queries from the `/v1/events` stream. |
| Forms, shortcuts, lists | TanStack Form, TanStack Hotkeys, TanStack Virtual, TanStack Pacer | One family, maintained together. |
| Primitives | Base UI 1.x | Headless, accessible, maintained by full-time staff, with `--transform-origin` for popover motion. |
| Command menu, toasts | cmdk, sonner | Small and proven. |
| Drag and drop | Pragmatic drag and drop | Powers Trello and Jira, headless, native drag and drop, and comes with accessibility guidance. |
| Chat | `@ai-sdk/react` `useChat` | The API already streams the AI SDK's UI-message protocol. |
| Icons | @phosphor-icons/react | A set chosen on purpose, not the default: a filled weight for small icons and the active nav item, and real GitHub, GitLab, Slack and Discord marks for sources. Imported with the `Icon` suffix (`TrayIcon`); the unsuffixed names are deprecated. |

## 4. Phones before the mobile app

The web app is how people try Worklog on a phone until the Expo app exists, so it has to hold up on a 390px screen and install to the home screen.

- **Installable.** A web app manifest with maskable icons and shortcuts to Inbox, the assistant and Activity. It opens standalone at Home.
- **Navigation.** Under 860px the sidebar becomes a drawer behind a top bar that keeps the inbox count and search one tap away.
- **One pane at a time.** Split views (inbox, briefs, assistant, settings, a person) collapse to a single column. Opening an inbox item shows its detail over the list, with a way back.
- **The board scrolls sideways,** one column at a time with scroll snapping, as Trello and Linear do on mobile.
- **No zoom on focus.** Inputs are at least 16px under 640px, because iOS zooms into anything smaller.
- **Hit targets** stay at least 24px, and primary actions 32px or more.
