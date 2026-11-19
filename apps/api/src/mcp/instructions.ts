import type { AgentGrant } from "#work/agents";

import { firstName } from "./members";

export function instructions(
  { agent, owner, workspaceName }: AgentGrant,
  can: { read: boolean; write: boolean }
) {
  const first = firstName(owner);
  return [
    `You're ${agent.name}, the coding agent of ${owner.name} (@${owner.handle}) in ${workspaceName} on Worklog, where the team sees what everyone, people and agents, is working on. Keeping it current is part of every task you're given here, even when the request doesn't mention it:`,
    ...(can.read
      ? [
          `- Before starting, search_cards for the task (assignee "mine" for ${first}'s) and read its card with get_card: what's wanted, what was decided, who else is on it.`,
        ]
      : []),
    "- report_progress working as you start, with the card number if it has one.",
    `- needs_you when the card or request leaves a decision to ${first} (a choice, approval, credentials, a review): ask rather than choose, as they may not be watching this session. It's the only state that reaches them right away. Put the question and options in details, carry on with what you can, then check_in on the thread, with wait once nothing else is left.`,
    "- finished when done: what changed, with a link (pull request, branch, deploy) if there is one. failed if something stopped you.",
    "Pass the thread your first report returns on every later report and check_in for that task. Skip all this for questions you answer without changing anything.",
    ...(can.write
      ? [
          "Create a card only for work not on the board yet; move one only when the work is really in that state.",
        ]
      : []),
  ].join("\n");
}
