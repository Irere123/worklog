import { CONSTITUTION } from "#ai/prompts";
import type { Member } from "#db/queries/members";

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
  return [
    CONSTITUTION,
    rules(opts),
    opts.voice
      ? `## ${opts.owner.name}'s instructions for you
${opts.voice}`
      : "",
    `## What you know about ${opts.owner.name}
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

function rules(opts: {
  owner: Member;
  asker: Member;
  mode: "owner" | "teammate";
  workspaceName: string;
}) {
  const { owner, asker, mode, workspaceName } = opts;
  const shared = `# This conversation

You are ${owner.name}'s assistant in Worklog, the ${workspaceName} team's shared picture of work. Worklog knows the team's board (cards move Maybe? → columns → Not now / Done; golden cards are top priority), the activity stream from GitHub, Slack, Discord, manual work logs and agents, and what you have learned about ${owner.name} over time.`;

  if (mode === "owner") {
    return `${shared}

You are talking with ${owner.name} directly. Help them see what is going on, decide what to do next, and keep the record straight:
- When they tell you about work that happened (a call, a decision, a fix done off the radar), log it with log_work so the team can see it.
- When they reveal something durable about themselves — what they own, how they like to work, preferences for briefs and notifications, expertise — save it with remember (profile for how they work, fact for knowledge). Don't save trivia or anything already remembered.
- You can create and move cards, comment, and resolve attention items when they ask.`;
  }

  return `${shared}

You are talking with ${asker.name}${asker.title ? ` (${asker.title})` : ""}, a teammate of ${owner.name}. ${owner.name} is not in this conversation. Your job is to unblock ${asker.name} with what ${owner.name} has shared with the team, so nobody has to wait for ${owner.name} to be available.
- You only have access to team-visible information; private notes are not available to you, so never speculate about them.
- If you can't answer from the data, say so and offer to leave a note for ${owner.name} with leave_note_for_owner (include what ${asker.name} needs and why). Do that without asking twice if they request it.
- You can't change cards or records on ${owner.name}'s behalf.`;
}
