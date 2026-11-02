# Worklog's point of view

Read this before building a screen. A model asked for "an inbox" or "a dashboard" returns the most probable one, which is everyone's. This page is what makes ours Worklog's. The reasoning comes from Katie Dill's "Raise the ceiling" talk ([notes](research/raise-the-ceiling.md)), and the interaction model comes from Fizzy ([design brief](research/web-app-design.md)).

## Who we are to people

Worklog is the team's logbook. The tools write it, so nobody has to report status, and anyone can read what really happened. Three values decide close calls:

- **Honest.** Every row is something that happened, with a source, a person or agent, and a time. Every item in the inbox says why it's there. An agent's work is labelled and has a human answerable for it. Nothing is invented to fill space: an empty state says what will appear and when.
- **Calm.** Only attention gets counted: one number, on the inbox. The app stays quiet until something needs you, and things that drift fade rather than shout. Each screen has one main action, and keyboard hints sit beside the actions they trigger.
- **Human.** People appear as their faces and in their own words, and each agent has a face of its own. Neutrals are warm, like paper. Fizzy's playfulness stays: Maybe?, golden tickets, rubber stamps.

## How it sounds

Write like a thoughtful teammate leaving a note, not like a system.

- Say what happened and what to do next: "That didn't load. Check your connection, then try again," never "Something went wrong."
- Use plain verbs in the past tense for the record ("Moved to Doing", "Marked done"), and say a run of related events once: "Added this card · Moved to Doing · Assigned to Atlas."
- Name people and cards; never write "a user" or "an item." Use no exclamation marks, no "Oops," and no "Are you sure?" Prefer Undo to a confirm dialog.

## Signature details

These are the small things that make a screen ours. Use them where they fit, and don't copy them where they don't.

- **The log line:** source mark, face, name, what happened, and the time, with the exact time on hover. Runs fold into one line.
- **Card numbers** like `#8` everywhere, in mono, and always as links.
- **Agent faces** drawn from the agent's id, on a rounded square. People are circles.
- **Stamps** for closure, golden tickets for the one card that matters, and a countdown badge as a card drifts.
- **The tab knows what needs you:** the icon carries the inbox count, as a calendar's tab shows the date.

## How an agent shows its work

The assistant and every agent follow the same rules, so their work reads as part of the log, not as a black box ([research](research/design-inspiration-2026-11.md)).

- **Steps in plain words.** A tool call is one line with the tool's own icon and its object: "Searched activity for “blocked” · 3 results", "Read #8". Never a raw tool name, never a green tick for success.
- **Lookups fold, changes don't.** Once the answer starts, reads fold into "Checked 3 things · 4s"; anything that changed the record (a comment, a move, memory) stays in view as its own line.
- **Reasoning stays folded,** even while it streams. "Thinking…" says it's there; a click shows it.
- **Writes others will see wait in place.** A held write reads "Wants your OK to move #9 to Investigating" with Allow and Deny, the same request as in the inbox.
- **Work shows where it happens.** An agent's run that names a card is one line on that card ("Atlas needs you: …"), edited in place, never a stream of posts. It shows only while the run is moving or waiting on someone.
- **Every claim can be checked.** Opening a lookup lists what it found; a `#8` shows the card on hover.
- **One place for each control.** Send becomes Stop; actions sit under the reply, pinned on the latest one. Nothing animates on send, and only what arrives live moves in.

## Standards are code

The old design system scaled consistency. Ours has to scale intent, for teammates and agents building without a designer in the room. So the rules live where code is written:

- Tokens in `apps/web/src/ui/tokens.stylex.ts`, and primitives and patterns in `apps/web/src/ui/`. Reach for a pattern (`EmptyState`, `Section`, `ActivityLine`) before composing atoms.
- `bun run lint` runs `apps/web/scripts/design-check.ts`. It fails on hover outside `media.hover`, font weights off the scale, non-Phosphor icons, sparkles for AI, `transition: all` and copy that says nothing. A deliberate exception names itself: `// design-allow: <reason>`.
- `bun run contrast` checks every text pair against WCAG in light and dark.

## Done is not good: the editor's pass

A screen that renders is a draft. Before calling it finished, use it the way a person would, on a laptop and on a 390px phone, in light and dark, and fix what you find:

1. **Context:** could this screen sit unchanged in any other product? If so, it's someone else's pattern. Make it say something only Worklog knows.
2. **Every state:** check loading, empty, error, one item, many items, a long title, a missing picture and a slow network.
3. **Every pixel has a reason:** colour, weight, spacing and motion each answer "why this, not that?" "The model returned it" isn't a reason.
4. **Nothing covers anything:** no floating element hides a row, a footer or a hint, and nothing stays stuck after a tap.
5. **One level deeper than anyone will notice:** alignment across rows, tabular numbers, ellipses at word ends, focus rings, the pressed state.
