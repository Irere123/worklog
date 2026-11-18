import type { AppContext } from "#context";
import { findThreadCard, setThreadCard } from "#db/queries/activities";
import { getCardByNumber } from "#db/queries/cards";
import type { Member } from "#db/queries/members";
import type { Visibility } from "#db/schema";
import { applyAgentState } from "#ingest/effects";

import { recordActivity } from "./activity";
import { resolveMember } from "./members";

export type AgentState = "working" | "needs_you" | "finished" | "failed";

export type WorkReport = {
  source: string;
  kind: string;
  title: string;
  body?: string;
  url?: string;
  cardNumber?: number;
  visibility?: Visibility;
  externalId?: string;
  occurredAt?: Date;
  thread?: string;
  importance?: number;
  onBehalfOf?: string;
  state?: AgentState;
  data?: Record<string, unknown>;
};

/**
 * Work a caller reports as itself: an agent, CI or a script. An agent's report is for the person it
 * works for unless it names another, and its state decides whether that person hears about it.
 */
export async function reportWork(
  ctx: AppContext,
  me: Member,
  input: WorkReport
) {
  const thread = input.thread ?? input.externalId ?? null;
  const card = await cardOf(ctx, me, input.cardNumber, thread);
  const onBehalfOf = await workingFor(ctx, me, input.onBehalfOf);
  const row = await recordActivity(ctx, {
    workspaceId: me.workspaceId,
    actorId: me.id,
    source: input.source,
    kind: input.kind,
    title: input.title,
    body: input.body,
    url: input.url,
    cardId: card?.id,
    visibility: input.visibility,
    externalId: input.externalId,
    occurredAt: input.occurredAt,
    threadKey: thread,
    importance:
      input.importance ?? (input.state === "needs_you" ? 0.8 : undefined),
    onBehalfOfId: onBehalfOf?.id ?? null,
    agentState: input.state ?? null,
    data: input.data,
  });
  if (row && input.state) {
    await applyAgentState(
      ctx,
      stateUpdate(
        me,
        { ...input, state: input.state },
        {
          activity: row,
          onBehalfOfId: onBehalfOf?.id ?? null,
          thread: thread ?? row.id,
        }
      )
    );
  }
  return {
    activity: row && { ...row, cardNumber: card?.number ?? null },
    onBehalfOf,
    thread: thread ?? row?.id ?? null,
  };
}

async function cardOf(
  ctx: AppContext,
  me: Member,
  number: number | undefined,
  thread: string | null
) {
  const mine =
    thread === null
      ? null
      : { workspaceId: me.workspaceId, threadKey: thread, actorId: me.id };
  if (number === undefined) {
    return mine ? ((await findThreadCard(ctx.db, mine)) ?? null) : null;
  }
  if (number === 0) {
    return null;
  }
  const card = await getCardByNumber(ctx.db, {
    workspaceId: me.workspaceId,
    number,
  });
  if (mine) {
    await setThreadCard(ctx.db, { ...mine, cardId: card.id });
  }
  return card;
}

function stateUpdate(
  me: Member,
  input: WorkReport & { state: AgentState },
  {
    activity,
    onBehalfOfId,
    thread,
  }: {
    activity: { id: string; cardId: string | null };
    onBehalfOfId: string | null;
    thread: string;
  }
) {
  return {
    workspaceId: me.workspaceId,
    agentName: me.name,
    onBehalfOfId,
    state: input.state,
    title: input.title,
    body: input.body ?? null,
    url: input.url ?? null,
    activityId: activity.id,
    cardId: activity.cardId,
    thread,
    agentId: me.id,
  };
}

async function workingFor(ctx: AppContext, me: Member, ref?: string) {
  const forRef = ref ?? (me.kind === "agent" ? me.ownerId : null);
  return forRef ? await resolveMember(ctx, me, forRef) : null;
}
