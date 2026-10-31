import { tool } from "ai";

import { ACTIONS, describeAction } from "#agent/actions";
import { requestApproval } from "#agent/review";

import { safe } from "./scope";
import type { Scope } from "./scope";

// A routine runs again and again on its own, so it always waits for the owner's own Allow, even
// when they asked for it: the request shows exactly what will run, and when.
export function proposeRoutineTool(scope: Scope) {
  const { owner } = scope;
  return tool({
    description: `Suggest a routine: instructions you'll run on a schedule and report on when there's something worth saying (e.g. "every Friday at 16:00, list reviews still waiting on ${owner.name}"). Use it when they ask, or when you notice them asking for the same thing again and again. It waits for their OK in their attention list.`,
    inputSchema: ACTIONS.create_routine.input,
    execute: safe(async (input) => {
      const id = await requestApproval(
        scope,
        "create_routine",
        input,
        `Runs ${input.schedule.type} at ${input.schedule.at}: ${input.instructions.slice(0, 200)}`
      );
      return {
        proposed: true,
        approvalId: id,
        next: `Tell ${owner.name} you've suggested to ${describeAction("create_routine", input)}; it starts once they allow it in their attention list.`,
      };
    }),
  });
}
