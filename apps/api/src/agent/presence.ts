import type { ToolSet } from "ai";

import type { AppContext } from "#context";
import { countOpenAttention } from "#db/queries/attention";
import { listAutomations } from "#db/queries/automations";
import type { Automation } from "#db/queries/automations";
import {
  listRunningTurns,
  listUnseenReplies,
  setConversationTurnStep,
} from "#db/queries/conversations";
import type { ConversationRow } from "#db/queries/conversations";
import { findMemberById, getPersonalAgent } from "#db/queries/members";
import type { Member } from "#db/queries/members";
import { UPKEEP_KINDS } from "#db/schema";
import type { AutomationKind, TurnStep } from "#db/schema";
import { log } from "#telemetry/log";

import { APPROVAL_KIND } from "./actions";

export type Working =
  | {
      kind: "reply";
      conversationId: string;
      title: string | null;
      inbox: boolean;
      step: TurnStep | null;
    }
  | { kind: "teammate" }
  | {
      kind: "routine";
      automationId: string;
      routine: AutomationKind;
      name: string;
      since: Date;
    };

export type Presence = {
  state: "working" | "waiting" | "done" | "idle";
  working: Working[];
  waiting: number;
  done: { conversationId: string; title: string | null; at: Date }[];
  next: { automationId: string; name: string; at: Date } | null;
};

/** What the owner's tabs are told; a step comes with it so they needn't read presence again. */
type Change = { conversationId: string; step: TurnStep } | null;

/**
 * Longer than a routine takes: a run that died without clearing its mark stops counting as work
 * after this, as the scheduler's own lease does.
 */
const RUN_STALE_MS = 15 * 60_000;

// A step's input is shown as a few words ("Searched activity for “blocked”"); long text isn't.
const STEP_TEXT_CHARS = 200;

/**
 * What the owner's assistant is doing, at a glance: answering, running a routine, waiting on them
 * for an OK, or done with something they haven't looked at yet. A teammate's question shows only
 * that one is being answered: what they asked is theirs.
 */
export async function assistantPresence(
  ctx: AppContext,
  owner: Member
): Promise<Presence> {
  const now = ctx.now();
  const agent = await getPersonalAgent(ctx.db, { ownerId: owner.id });
  const [turns, automations, waiting, unseen] = await Promise.all([
    listRunningTurns(ctx.db, { agentId: agent.id, now }),
    listAutomations(ctx.db, { memberId: owner.id }),
    countOpenAttention(ctx.db, {
      memberId: owner.id,
      kind: APPROVAL_KIND,
      now,
    }),
    listUnseenReplies(ctx.db, { askerId: owner.id, agentId: agent.id }),
  ]);
  const working: Working[] = [
    ...turns.map((turn): Working =>
      turn.askerId === owner.id
        ? {
            kind: "reply",
            conversationId: turn.id,
            title: turn.title,
            inbox: turn.inbox,
            step: turn.step,
          }
        : { kind: "teammate" }
    ),
    ...automations.flatMap((a): Working[] =>
      a.runningSince !== null &&
      now.getTime() - a.runningSince.getTime() < RUN_STALE_MS
        ? [
            {
              kind: "routine",
              automationId: a.id,
              routine: a.kind,
              name: a.name,
              since: a.runningSince,
            },
          ]
        : []
    ),
  ];
  // The inbox thread's briefs and pings already reach people as notifications; done is for
  // answers to what they asked.
  const done = unseen.flatMap((c) =>
    !c.inbox && c.repliedAt !== null
      ? [{ conversationId: c.id, title: c.title, at: c.repliedAt }]
      : []
  );
  return {
    state: stateOf(working, waiting, done),
    working,
    waiting,
    done,
    next: nextRoutine(automations, now),
  };
}

/**
 * Presence for one turn, reported to the assistant's owner: that it started, each step it takes,
 * and that it ended. Reporting never fails the turn: presence is a courtesy, the answer is the
 * work.
 */
export async function turnPresence(
  ctx: AppContext,
  conversation: ConversationRow,
  until: Date
) {
  const ownerId = await ownerOf(ctx, conversation);
  const tell = async (change: Change) => {
    if (ownerId !== null) {
      await presenceChanged(ctx, {
        workspaceId: conversation.workspaceId,
        ownerId,
        change,
      });
    }
  };
  await tell(null);
  return {
    step: async (step: Omit<TurnStep, "at">) => {
      const taken = { ...step, at: ctx.now().toISOString() };
      try {
        await setConversationTurnStep(ctx.db, {
          id: conversation.id,
          until,
          step: taken,
        });
      } catch (error) {
        log.warn("assistant: couldn't record a step", { error });
        return;
      }
      // What a teammate's turn is doing stays theirs: the owner hears only that it's running.
      await tell(
        conversation.mode === "owner"
          ? { conversationId: conversation.id, step: taken }
          : null
      );
    },
    ended: async () => {
      await tell(null);
    },
  };
}

/** Tells the owner's open tabs to look again, or what changed when that's all they need. */
export async function presenceChanged(
  ctx: AppContext,
  params: { workspaceId: string; ownerId: string; change?: Change }
) {
  try {
    await ctx.bus.publish({
      workspaceId: params.workspaceId,
      audienceId: params.ownerId,
      type: "assistant.updated",
      data: params.change ?? {},
    });
  } catch (error) {
    log.warn("assistant: couldn't announce presence", { error });
  }
}

/** Whether a routine's runs show as the assistant at work: upkeep runs too often to be news. */
export function showsAtWork(automation: Pick<Automation, "kind">) {
  return !UPKEEP_KINDS.includes(automation.kind);
}

/** The same tools, each calling `report` as it starts. */
export function reportingSteps(
  tools: ToolSet,
  report: (step: Omit<TurnStep, "at">) => Promise<void>
): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      const { execute } = tool;
      if (execute === undefined) {
        return [name, tool];
      }
      const reporting: typeof execute = async (input, options) => {
        await report({ tool: name, input: stepInput(input) });
        const result: unknown = await execute(input, options);
        return result;
      };
      return [name, { ...tool, execute: reporting }];
    })
  );
}

// In the owner's own conversation they are the asker; only a teammate's needs the agent looked up.
async function ownerOf(ctx: AppContext, conversation: ConversationRow) {
  if (conversation.mode === "owner") {
    return conversation.askerId;
  }
  const agent = await findMemberById(ctx.db, {
    id: conversation.agentId,
    workspaceId: conversation.workspaceId,
  });
  return agent?.ownerId ?? null;
}

function nextRoutine(automations: Automation[], now: Date): Presence["next"] {
  let next: Presence["next"] = null;
  for (const a of automations) {
    if (
      a.enabled &&
      showsAtWork(a) &&
      a.nextRunAt !== null &&
      a.nextRunAt > now &&
      (next === null || a.nextRunAt < next.at)
    ) {
      next = { automationId: a.id, name: a.name, at: a.nextRunAt };
    }
  }
  return next;
}

function stateOf(
  working: Working[],
  waiting: number,
  done: unknown[]
): Presence["state"] {
  if (working.length > 0) {
    return "working";
  }
  if (waiting > 0) {
    return "waiting";
  }
  return done.length > 0 ? "done" : "idle";
}

function stepInput(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(input).flatMap(([key, value]): [string, unknown][] => {
      if (typeof value === "string") {
        return [[key, value.slice(0, STEP_TEXT_CHARS)]];
      }
      if (typeof value === "number" || typeof value === "boolean") {
        return [[key, value]];
      }
      return [];
    })
  );
}
