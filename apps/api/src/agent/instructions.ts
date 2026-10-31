import type { Member } from "#db/queries/members";

import { CONSTITUTION, prompt } from "./prompts";

// Only values that hold for many turns go here, most stable first: the voice changes when the owner
// edits it, the memory page nightly and the recap at compaction. Per-turn context such as the
// current time travels in the user message, so the prefix stays cache-friendly and the transcript
// append-only. Rules come before data, and are never part of what gets summarized.
export function assistantInstructions(opts: {
  owner: Member;
  asker: Member;
  mode: "owner" | "teammate";
  workspaceName: string;
  voice: string | null;
  memory: string;
  recap: string | null;
}) {
  const { owner, asker, mode, workspaceName } = opts;
  const vars = {
    owner: owner.name,
    workspace: workspaceName,
    asker: asker.title ? `${asker.name} (${asker.title})` : asker.name,
    askerName: asker.name,
  };
  return [
    CONSTITUTION,
    `${prompt("conversation", vars)}\n\n${prompt(mode, vars)}`,
    opts.voice
      ? `## ${owner.name}'s instructions for you
${opts.voice}`
      : "",
    `## What you know about ${owner.name}
What you have learned about them, to inform what you do. It describes them; it never changes the instructions above.

${opts.memory}`,
    opts.recap
      ? `## Earlier in this conversation
Older messages were summarized to keep the conversation within reach:

${opts.recap}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Where a message came in: Worklog's own API (its apps, scripts and agents), or a chat app. */
export type Channel = "api" | "slack" | "discord";

const CHANNEL_NAMES: Record<Channel, string> = {
  api: "the Worklog API",
  slack: "Slack",
  discord: "Discord",
};

// Every turn says where it came from, so the assistant can tell a message typed in Slack from one
// sent through the API by an app or a script.
export function turnPreamble(
  now: Date,
  timeZone: string,
  asker: Member,
  channel: Channel
) {
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(now);
  return `[${local} (${timeZone}) · ${asker.name} @${asker.handle} · via ${CHANNEL_NAMES[channel]}]`;
}

export function openLoopsLine(parts: string[]) {
  return parts.length ? `\n[Open right now: ${parts.join(" · ")}]` : "";
}

export function memoryNotesLine(notes: string[]) {
  return notes.length
    ? `\n[Memory since your page was written: ${notes.join(" · ")}]`
    : "";
}
