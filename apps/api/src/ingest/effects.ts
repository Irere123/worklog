import type {
  BoardEffect,
  ExternalActor,
  Signal,
  WorklogEvent,
} from "#connectors/types";
import type { AppContext } from "#context";
import {
  findAttentionResolvedThrough,
  setOpenAttentionDone,
  upsertAttentionResolution,
} from "#db/queries/attention";
import { findActiveBoard } from "#db/queries/boards";
import { findCardByExternalKey, listCardIdsByRefs } from "#db/queries/cards";
import type { CardRow } from "#db/queries/cards";
import { findMemberById } from "#db/queries/members";
import type { Member } from "#db/queries/members";
import type { Priority } from "#db/schema";
import { raiseAttention } from "#work/attention";
import type { AttentionInput } from "#work/attention";
import * as board from "#work/board";

import { resolveActor } from "./identity";
import type { People } from "./people";

export type BoardScope = {
  workspaceId: string;
  namespace: string;
  boardId?: string;
  source: string;
  /** Resolved before the transaction, so effects don't write identities inside it. */
  people?: People;
};

export async function findCardIds(
  ctx: AppContext,
  workspaceId: string,
  refs: WorklogEvent["cardRefs"]
) {
  if (!refs) {
    return [];
  }
  return await listCardIdsByRefs(ctx.db, {
    workspaceId,
    externalKeys: refs.externalKeys ?? [],
    numbers: refs.numbers ?? [],
  });
}

async function memberFor(
  ctx: AppContext,
  scope: BoardScope,
  who: ExternalActor,
  at: Date
) {
  const known = scope.people?.get(who.id);
  if (known) {
    return known.member;
  }
  const { memberId } = await resolveActor(
    ctx,
    scope.workspaceId,
    scope.namespace,
    who,
    at,
    { acted: false }
  );
  if (!memberId) {
    return null;
  }
  return (await findMemberById(ctx.db, { id: memberId })) ?? null;
}

export async function applyBoardEffects(
  ctx: AppContext,
  scope: BoardScope,
  effects: BoardEffect[],
  actor: Member | null,
  at: Date
) {
  const touched: string[] = [];
  for (const effect of effects) {
    const card = await findCardByExternalKey(ctx.db, {
      workspaceId: scope.workspaceId,
      externalKey: effect.externalKey,
    });
    const cardId = await applyBoardEffect(ctx, scope, effect, card, {
      actor,
      at,
    });
    if (cardId) {
      touched.push(cardId);
    }
  }
  return touched;
}

async function applyBoardEffect(
  ctx: AppContext,
  scope: BoardScope,
  effect: BoardEffect,
  card: CardRow | undefined,
  by: { actor: Member | null; at: Date }
) {
  const silent = { silent: true };
  switch (effect.type) {
    case "upsert_card": {
      if (card || !scope.boardId) {
        return null;
      }
      const target = await findActiveBoard(ctx.db, {
        workspaceId: scope.workspaceId,
        id: scope.boardId,
      });
      if (!target) {
        return null;
      }
      const created = await board.createCard(
        ctx,
        by.actor,
        scope.workspaceId,
        {
          boardId: target.id,
          title: effect.title,
          body: effect.body,
          source: scope.source,
          externalKey: effect.externalKey,
          externalUrl: effect.url,
        },
        silent
      );
      return created.id;
    }
    case "close_card": {
      if (card && card.stage !== "done") {
        await board.close(
          ctx,
          by.actor,
          scope.workspaceId,
          card.number,
          silent
        );
      }
      return card?.id ?? null;
    }
    case "reopen_card": {
      if (card && card.stage === "done") {
        await board.reopen(
          ctx,
          by.actor,
          scope.workspaceId,
          card.number,
          silent
        );
      }
      return card?.id ?? null;
    }
    case "assign_card": {
      const who = await memberFor(ctx, scope, effect.who, by.at);
      if (card && who) {
        await board.assign(
          ctx,
          by.actor,
          scope.workspaceId,
          card.number,
          who.id,
          silent
        );
      }
      return null;
    }
    default: {
      return null;
    }
  }
}

const REVIEW_PRIORITY: Record<string, Priority> = {
  changes_requested: "high",
  approved: "normal",
  commented: "low",
};

const REVIEW_VERB: Record<string, string> = {
  approved: "approved",
  changes_requested: "requested changes on",
  commented: "reviewed",
};

type Notice = Pick<
  AttentionInput,
  "kind" | "title" | "body" | "priority" | "dedupeKey"
>;

type SignalContext = {
  actor: Member | null;
  actorIsBot: boolean;
  activityId: string | null;
  cardId: string | null;
  raise: boolean;
  /** Read back from an API: create what's missing, never reopen what someone dismissed. */
  onlyIfNew?: boolean;
};

export async function applySignals(
  ctx: AppContext,
  scope: BoardScope,
  event: WorklogEvent,
  info: SignalContext
) {
  const thread = event.thread ?? event.id;
  for (const signal of event.signals ?? []) {
    if (signal.type === "resolve") {
      await resolveItems(ctx, scope, thread, signal, event.occurredAt);
    } else if (info.raise) {
      await raiseFor(ctx, scope, event, signal, info);
    }
  }
}

async function raiseFor(
  ctx: AppContext,
  scope: BoardScope,
  event: WorklogEvent,
  signal: Exclude<Signal, { type: "resolve" }>,
  info: SignalContext
) {
  const who = await memberFor(ctx, scope, signal.who, event.occurredAt);
  if (!who || who.id === info.actor?.id) {
    return;
  }
  const actorName =
    info.actor?.name ?? event.actor?.name ?? event.actor?.handle ?? "Someone";
  const notice = describeSignal(signal, event, actorName);
  if (await resolvedSince(ctx, scope, who.id, notice, event.occurredAt)) {
    return;
  }
  await raiseAttention(ctx, {
    workspaceId: scope.workspaceId,
    memberId: who.id,
    url: event.object?.url ?? event.url ?? null,
    cardId: info.cardId,
    activityId: info.activityId,
    fromId: info.actor?.id ?? null,
    ...notice,
    priority: capForBots(notice.priority, info.actorIsBot),
    onlyIfNew: info.onlyIfNew,
    sourceAt: event.occurredAt,
  });
}

const RESOLVABLE = new Set(["review.requested", "assigned"]);

async function resolvedSince(
  ctx: AppContext,
  scope: BoardScope,
  memberId: string,
  notice: Notice,
  at: Date
) {
  if (!RESOLVABLE.has(notice.kind)) {
    return false;
  }
  const through = await findAttentionResolvedThrough(ctx.db, {
    workspaceId: scope.workspaceId,
    memberId,
    dedupeKey: notice.dedupeKey,
  });
  return through !== null && through >= at;
}

function capForBots(priority: Priority, actorIsBot: boolean) {
  const capped: Priority =
    actorIsBot && priority === "high" ? "normal" : priority;
  return capped;
}

function describeSignal(
  signal: Exclude<Signal, { type: "resolve" }>,
  event: WorklogEvent,
  actorName: string
) {
  const what = event.object?.title ?? event.title;
  const thread = event.thread ?? event.id;
  if (signal.type === "review_requested") {
    return {
      kind: "review.requested",
      title: `${actorName} wants your review: ${what}`,
      priority: "high",
      dedupeKey: `review:${thread}`,
    } satisfies Notice;
  }
  if (signal.type === "mentioned") {
    return {
      kind: "mention",
      title: `${actorName} mentioned you${mentionPlace(event, what)}`,
      body: signal.excerpt ?? null,
      priority: signal.priority ?? "high",
      dedupeKey: `mention:${event.id}`,
    } satisfies Notice;
  }
  if (signal.type === "assigned") {
    return {
      kind: "assigned",
      title: `You were assigned ${what}`,
      priority: "normal",
      dedupeKey: `assigned:${thread}`,
    } satisfies Notice;
  }
  return {
    kind: "pr.review",
    title: `${actorName} ${REVIEW_VERB[signal.state] ?? "reviewed"} ${what}`,
    body: event.body?.slice(0, 280) ?? null,
    priority: REVIEW_PRIORITY[signal.state] ?? "normal",
    dedupeKey: `review-result:${thread}`,
  } satisfies Notice;
}

function mentionPlace(event: WorklogEvent, what: string) {
  if (event.object?.title) {
    return `: ${event.object.title}`;
  }
  if (event.container?.type === "channel") {
    return ` in #${event.container.name}`;
  }
  return `: ${what}`;
}

async function resolveItems(
  ctx: AppContext,
  scope: BoardScope,
  thread: string,
  signal: Extract<Signal, { type: "resolve" }>,
  at: Date
) {
  const key =
    signal.what === "review_requested"
      ? `review:${thread}`
      : `assigned:${thread}`;
  const who = signal.who ? await memberFor(ctx, scope, signal.who, at) : null;
  if (signal.who && !who) {
    return;
  }
  await upsertAttentionResolution(ctx.db, {
    workspaceId: scope.workspaceId,
    memberId: who?.id ?? "",
    dedupeKey: key,
    at,
  });
  await setOpenAttentionDone(ctx.db, {
    workspaceId: scope.workspaceId,
    dedupeKey: key,
    memberId: who?.id,
    before: at,
    at: ctx.now(),
  });
}

const AGENT_BODY_MAX = 1000;

export async function applyAgentState(
  ctx: AppContext,
  input: {
    workspaceId: string;
    agentName: string;
    onBehalfOfId: string | null;
    state: string | null;
    title: string;
    /** What the agent said beyond its title: the plan to approve, the error it hit. */
    body?: string | null;
    url: string | null;
    activityId: string | null;
    /** The card the agent was working on, so the decision is made with the card in view. */
    cardId: string | null;
    thread: string;
    agentId: string | null;
  }
) {
  if (!input.onBehalfOfId || !input.state || input.state === "working") {
    return;
  }
  const spec = {
    needs_you: {
      priority: "high" as const,
      title: `${input.agentName} needs you: ${input.title}`,
    },
    failed: {
      priority: "normal" as const,
      title: `${input.agentName} couldn't finish: ${input.title}`,
    },
    finished: {
      priority: "low" as const,
      title: `${input.agentName} finished: ${input.title}`,
    },
  }[input.state];
  if (!spec) {
    return;
  }
  await raiseAttention(ctx, {
    workspaceId: input.workspaceId,
    memberId: input.onBehalfOfId,
    kind: `agent.${input.state}`,
    title: spec.title,
    body: input.body?.slice(0, AGENT_BODY_MAX) ?? null,
    url: input.url,
    activityId: input.activityId,
    cardId: input.cardId,
    fromId: input.agentId,
    priority: spec.priority,
    dedupeKey: `agent:${input.thread}`,
    replace: true,
  });
}
