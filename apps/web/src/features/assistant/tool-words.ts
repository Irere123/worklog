import type { Member } from "#features/cards/card-bits";

import type { Step } from "./steps";

// How the assistant's tool calls read in a person's words. Kept apart from the components so the
// wording can be read, and changed, in one place.

type Words = { doing: string; did: string };

const VERBS: Record<string, Words> = {
  search_activity: { doing: "Searching activity", did: "Searched activity" },
  search_cards: { doing: "Searching the board", did: "Searched the board" },
  get_card: { doing: "Reading a card", did: "Read a card" },
  work_snapshot: {
    doing: "Checking what they’re on",
    did: "Checked what they’re on",
  },
  team_directory: { doing: "Looking up the team", did: "Looked up the team" },
  my_attention: { doing: "Checking your inbox", did: "Checked your inbox" },
  recall: { doing: "Remembering", did: "Remembered" },
  remember: { doing: "Saving to memory", did: "Saved to memory" },
  forget: { doing: "Forgetting", did: "Forgot" },
  follow_up: { doing: "Setting a follow-up", did: "Set a follow-up" },
  look_into: { doing: "Looking into it", did: "Looked into it" },
  log_work: { doing: "Logging work", did: "Logged work" },
  create_card: { doing: "Adding a card", did: "Added a card" },
  move_card: { doing: "Moving a card", did: "Moved a card" },
  comment_on_card: { doing: "Commenting", did: "Commented" },
  answer_attention: { doing: "Answering", did: "Answered" },
  resolve_attention: {
    doing: "Clearing an inbox item",
    did: "Cleared an inbox item",
  },
  attention_feedback: {
    doing: "Noting your feedback",
    did: "Noted your feedback",
  },
  propose_routine: { doing: "Proposing a routine", did: "Proposed a routine" },
  leave_note_for_owner: { doing: "Leaving a note", did: "Left a note" },
};

function field(input: unknown, key: string): string | undefined {
  const value: unknown =
    typeof input === "object" && input !== null
      ? Object.getOwnPropertyDescriptor(input, key)?.value
      : undefined;
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}

const STAGES: Record<string, string> = {
  triage: "Maybe? cards",
  active: "cards in progress",
  not_now: "Not now cards",
  done: "done cards",
};

type Said = {
  running: boolean;
  input: unknown;
  /** A person's first name for a handle the tool was given. */
  name: (handle: string | undefined) => string | undefined;
};

function quoted(value: string | undefined, max = 48) {
  if (!value) {
    return null;
  }
  return `“${value.length > max ? `${value.slice(0, max - 1)}…` : value}”`;
}

const cardOf = (input: unknown) =>
  field(input, "number") ?? field(input, "cardNumber");

// Tools whose line names its subject: "Read #4", "Checked what Jean is on".
const SENTENCES: Record<string, (said: Said) => string | null | undefined> = {
  work_snapshot: ({ running, input, name }) => {
    const who = name(field(input, "person"));
    return who && `${running ? "Checking" : "Checked"} what ${who} is on`;
  },
  get_card: ({ running, input }) => {
    const card = cardOf(input);
    return card && `${running ? "Reading" : "Read"} #${card}`;
  },
  move_card: ({ running, input }) => {
    const card = cardOf(input);
    const to = field(input, "to");
    return (
      card && `${running ? "Moving" : "Moved"} #${card}${to ? ` to ${to}` : ""}`
    );
  },
  comment_on_card: ({ running, input }) => {
    const card = cardOf(input);
    return card && `${running ? "Commenting on" : "Commented on"} #${card}`;
  },
};

// Tools whose verb takes what they were asked: "Searched activity for “blocked”".
const DETAILS: Record<string, (said: Said) => string | null | undefined> = {
  search_activity: ({ input, name }) => {
    const query = quoted(field(input, "query"));
    const who = name(field(input, "person"));
    return [query && `for ${query}`, who && `by ${who}`]
      .filter(Boolean)
      .join(" ");
  },
  search_cards: ({ input }) => {
    const query = quoted(field(input, "query"));
    const stage = field(input, "stage");
    return [query && `for ${query}`, stage && `· ${STAGES[stage] ?? stage}`]
      .filter(Boolean)
      .join(" ");
  },
  create_card: ({ input }) => quoted(field(input, "title")),
  recall: ({ input }) => {
    const query = quoted(field(input, "query"));
    return query && `about ${query}`;
  },
  remember: ({ input }) => quoted(field(input, "content"), 56),
  follow_up: ({ input }) => quoted(field(input, "what")),
  log_work: ({ input }) => quoted(field(input, "text")),
  look_into: ({ input }) => quoted(field(input, "task")),
};

/** What a tool call did, in a line a person would write: "Searched activity for “blocked”". */
export function describe(
  step: Extract<Step, { kind: "tool" }>,
  people: Map<string, Member>
) {
  const running = step.status === "running";
  const said: Said = {
    running,
    input: step.input,
    name: (handle) => {
      const person = handle
        ? [...people.values()].find((p) => p.handle === handle)
        : undefined;
      return handle ? (person?.name.split(" ")[0] ?? `@${handle}`) : undefined;
    },
  };
  const sentence = SENTENCES[step.tool]?.(said);
  if (sentence) {
    return sentence;
  }
  const words = VERBS[step.tool] ?? {
    doing: `Using ${step.tool.replaceAll("_", " ")}`,
    did: `Used ${step.tool.replaceAll("_", " ")}`,
  };
  const verb = running ? words.doing : words.did;
  const detail = DETAILS[step.tool]?.(said);
  return detail ? `${verb} ${detail}` : verb;
}

export function summarize(reads: Step[], people: Map<string, Member>) {
  const tools = reads.filter((s) => s.kind === "tool");
  const [only] = tools;
  if (!only) {
    return "Thought it through";
  }
  if (tools.length === 1) {
    return describe(only, people);
  }
  return `Checked ${tools.length} things`;
}

// What a held write would do, as the end of "Wants your OK to …".
export const ASKS: Record<string, (input: unknown) => string> = {
  comment_on_card: (input) => `comment on #${cardOf(input) ?? "a card"}`,
  move_card: (input) => {
    const to = field(input, "to");
    return `move #${cardOf(input) ?? "a card"}${to ? ` to ${to}` : ""}`;
  },
  create_card: (input) => `add ${quoted(field(input, "title")) ?? "a card"}`,
  log_work: (input) =>
    `log ${quoted(field(input, "text")) ?? "work"} for the team`,
  answer_attention: () => "answer a question for you",
  resolve_attention: () => "clear an inbox item",
  propose_routine: () => "start a routine",
};
