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
import { APPROVAL_KIND, UPKEEP_KINDS } from "#db/schema";
import type { AutomationKind, TurnStep } from "#db/schema";
import { log } from "#telemetry/log";

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
  /** When it was read: snapshots from two processes can arrive out of order, and the later wins. */
  asOf: Date;
};

export type ReportStep = (step: Omit<TurnStep, "at">) => void;

type Owner = { workspaceId: string; ownerId: string };

const RUN_STALE_MS = 15 * 60_000;

const STEP_TEXT_CHARS = 200;

const queued = new Map<string, Promise<void>>();
const sending = new Map<string, Promise<void>>();

/**
 * What the owner's assistant is doing, at a glance: answering, running a routine, waiting on them
 * for an OK, or done with something they haven't looked at yet. A teammate's question shows only
 * that one is being answered: what they asked is theirs.
 */
export async function assistantPresence(ctx: AppContext, ownerId: string) {
  const now = ctx.now();
  const agent = await getPersonalAgent(ctx.db, { ownerId });
  const [turns, automations, waiting, unseen] = await Promise.all([
    listRunningTurns(ctx.db, { agentId: agent.id, now }),
    listAutomations(ctx.db, { memberId: ownerId }),
    countOpenAttention(ctx.db, { memberId: ownerId, kind: APPROVAL_KIND, now }),
    listUnseenReplies(ctx.db, { askerId: ownerId, agentId: agent.id }),
  ]);
  const working: Working[] = [
    ...turns.map((turn) =>
      turn.askerId === ownerId
        ? ({
            kind: "reply",
            conversationId: turn.id,
            title: turn.title,
            inbox: turn.inbox,
            step: turn.step,
          } satisfies Working)
        : ({ kind: "teammate" } satisfies Working)
    ),
    ...automations.flatMap((a) =>
      a.runningSince !== null &&
      now.getTime() - a.runningSince.getTime() < RUN_STALE_MS
        ? ([
            {
              kind: "routine",
              automationId: a.id,
              routine: a.kind,
              name: a.name,
              since: a.runningSince,
            },
          ] satisfies Working[])
        : []
    ),
  ];
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
    asOf: now,
  } satisfies Presence;
}

/**
 * The step a turn reports when its reply's words start to flow, after any lookups, so the owner's
 * view can tell writing from still looking things up. Not a tool: no tool has this name.
 */
export const WRITING_STEP = "writing";

/**
 * Presence for one turn, reported to the assistant's owner: that it started, each step it takes,
 * and that it ended. Only the end is waited for: presence is a courtesy, the answer is the work,
 * and a tool shouldn't start late so a sidebar can say it started.
 */
export async function turnPresence(
  ctx: AppContext,
  conversation: ConversationRow,
  until: Date
) {
  const ownerId = await ownerOf(ctx, conversation);
  const tell = async () => {
    if (ownerId !== null) {
      await presenceChanged(ctx, {
        workspaceId: conversation.workspaceId,
        ownerId,
      });
    }
  };
  const record = async (step: Omit<TurnStep, "at">) => {
    try {
      await setConversationTurnStep(ctx.db, {
        id: conversation.id,
        until,
        step: { ...step, at: ctx.now().toISOString() },
      });
    } catch (error) {
      log.warn("assistant: couldn't record a step", { error });
      return;
    }
    await tell();
  };
  void tell();
  const step: ReportStep = (taken) => {
    if (conversation.mode === "owner") {
      void record(taken);
    }
  };
  return { step, ended: tell };
}

/**
 * Sends the owner's open tabs their assistant's presence as it is now, whole, so no tab has to
 * read it again. Call it after the change commits. Never throws: a missed snapshot is corrected by
 * the next.
 */
export async function presenceChanged(ctx: AppContext, owner: Owner) {
  const waiting = queued.get(owner.ownerId);
  if (waiting) {
    await waiting;
    return;
  }
  const next = sendAfter(sending.get(owner.ownerId), ctx, owner);
  queued.set(owner.ownerId, next);
  await next;
}

/** Whether a routine's runs show as the assistant at work: upkeep runs too often to be news. */
export function showsAtWork(automation: Pick<Automation, "kind">) {
  return !UPKEEP_KINDS.includes(automation.kind);
}

/** The same tools, each calling `report` as it starts. */
export function reportingSteps(tools: ToolSet, report: ReportStep) {
  const reported: ToolSet = Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      const { execute } = tool;
      if (execute === undefined) {
        return [name, tool];
      }
      const reporting: typeof execute = async (input, options) => {
        report({ tool: name, input: stepInput(input) });
        const result: unknown = await execute(input, options);
        return result;
      };
      return [name, { ...tool, execute: reporting }];
    })
  );
  return reported;
}

async function sendAfter(
  before: Promise<void> | undefined,
  ctx: AppContext,
  owner: Owner
) {
  await before;
  queued.delete(owner.ownerId);
  const send = announce(ctx, owner);
  sending.set(owner.ownerId, send);
  await send;
  if (sending.get(owner.ownerId) === send) {
    sending.delete(owner.ownerId);
  }
}

async function announce(ctx: AppContext, { workspaceId, ownerId }: Owner) {
  try {
    await ctx.bus.publish({
      workspaceId,
      audienceId: ownerId,
      type: "assistant.updated",
      data: await assistantPresence(ctx, ownerId),
    });
  } catch (error) {
    log.warn("assistant: couldn't announce presence", { error });
  }
}

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

function nextRoutine(automations: Automation[], now: Date) {
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

function stateOf(working: Working[], waiting: number, done: unknown[]) {
  if (working.length > 0) {
    return "working" satisfies Presence["state"];
  }
  if (waiting > 0) {
    return "waiting" satisfies Presence["state"];
  }
  const state: Presence["state"] = done.length > 0 ? "done" : "idle";
  return state;
}

function stepInput(input: unknown) {
  if (typeof input !== "object" || input === null) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(input).flatMap(([key, value]) => {
      let kept: [string, unknown][] = [];
      if (typeof value === "string") {
        kept = [[key, value.slice(0, STEP_TEXT_CHARS)]];
      } else if (typeof value === "number" || typeof value === "boolean") {
        kept = [[key, value]];
      }
      return kept;
    })
  );
}
