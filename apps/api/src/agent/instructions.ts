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

export function turnPreamble(now: Date, timeZone: string, asker: Member) {
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(now);
  return `[${local} (${timeZone}) · ${asker.name} @${asker.handle}]`;
}
