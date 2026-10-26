import { and, eq, inArray } from "drizzle-orm";

import { raiseAttention } from "../attention/service";
import type { AttentionInput } from "../attention/service";
import * as board from "../board/service";
import type { AppContext } from "../context";
import { attentionItems, cards, members } from "../db/schema";
import type { Priority } from "../db/schema";
import { resolveActor } from "./identity";
import type { BoardEffect, ExternalActor, Signal, WorklogEvent } from "./types";

type Member = typeof members.$inferSelect;
type CardRow = typeof cards.$inferSelect;
type Scope = {
  workspaceId: string;
  namespace: string;
  boardId?: string;
  source: string;
};

/** Cards an event refers to: external keys (from issue trackers) and Worklog numbers (WL-12). */
export async function findCardIds(
  ctx: AppContext,
  workspaceId: string,
  refs: WorklogEvent["cardRefs"]
): Promise<string[]> {
  if (!refs) {
    return [];
  }
  const { externalKeys = [], numbers = [] } = refs;
  const conds = [];
  if (externalKeys.length > 0) {
    conds.push(inArray(cards.externalKey, externalKeys));
  }
  if (numbers.length > 0) {
    conds.push(inArray(cards.number, numbers));
  }
  if (conds.length === 0) {
    return [];
  }
  const rows = await Promise.all(
    conds.map((c) =>
      ctx.db
        .select({ id: cards.id })
        .from(cards)
        .where(and(eq(cards.workspaceId, workspaceId), c))
    )
  );
  return [...new Set(rows.flat().map((r) => r.id))];
}

async function memberFor(
  ctx: AppContext,
  scope: Scope,
  who: ExternalActor,
  at: Date
): Promise<Member | null> {
  const { memberId } = await resolveActor(
    ctx,
    scope.workspaceId,
    scope.namespace,
    who,
    at
  );
  if (!memberId) {
    return null;
  }
  const [m] = await ctx.db
    .select()
    .from(members)
    .where(eq(members.id, memberId));
  return m ?? null;
}

/**
 * Board effects from issue trackers. They run before the activity is written so it can link to the
 * card, and they're silent: the source event's own activity is the record of what happened.
 */
export async function applyBoardEffects(
  ctx: AppContext,
  scope: Scope,
  effects: BoardEffect[],
  actor: Member | null,
  at: Date
) {
  const touched: string[] = [];
  for (const effect of effects) {
    const [card] = await ctx.db
      .select()
      .from(cards)
      .where(
        and(
          eq(cards.workspaceId, scope.workspaceId),
          eq(cards.externalKey, effect.externalKey)
        )
      );
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

/** One effect on the card it names (if that card exists yet). Returns the card it touched, if any. */
async function applyBoardEffect(
  ctx: AppContext,
  scope: Scope,
  effect: BoardEffect,
  card: CardRow | undefined,
  by: { actor: Member | null; at: Date }
): Promise<string | null> {
  const silent = { silent: true };
  switch (effect.type) {
    case "upsert_card": {
      if (card || !scope.boardId) {
        return null;
      }
      const created = await board.createCard(
        ctx,
        by.actor,
        scope.workspaceId,
        {
          boardId: scope.boardId,
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
      // Effect types this server doesn't know (a newer connector) are ignored.
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

/** Signals become attention items for the people they concern — never for the person who acted. */
export async function applySignals(
  ctx: AppContext,
  scope: Scope,
  event: WorklogEvent,
  ctxInfo: {
    actor: Member | null;
    actorIsBot: boolean;
    activityId: string | null;
    cardId: string | null;
  }
) {
  const actorName =
    ctxInfo.actor?.name ??
    event.actor?.name ??
    event.actor?.handle ??
    "Someone";
  const thread = event.thread ?? event.id;

  for (const signal of event.signals ?? []) {
    if (signal.type === "resolve") {
      await resolveItems(ctx, scope, thread, signal, event.occurredAt);
      continue;
    }
    const who = await memberFor(ctx, scope, signal.who, event.occurredAt);
    if (!who || who.id === ctxInfo.actor?.id) {
      continue;
    }
    const notice = describeSignal(signal, event, actorName);
    await raiseAttention(ctx, {
      workspaceId: scope.workspaceId,
      memberId: who.id,
      url: event.object?.url ?? event.url ?? null,
      cardId: ctxInfo.cardId,
      activityId: ctxInfo.activityId,
      fromId: ctxInfo.actor?.id ?? null,
      ...notice,
      priority: capForBots(notice.priority, ctxInfo.actorIsBot),
    });
  }
}

/** Bots can ask, but they can't interrupt: their signals are never high priority. */
function capForBots(priority: Priority, actorIsBot: boolean): Priority {
  return actorIsBot && priority === "high" ? "normal" : priority;
}

/** What a signal asks of the person it names, as an attention item. */
function describeSignal(
  signal: Exclude<Signal, { type: "resolve" }>,
  event: WorklogEvent,
  actorName: string
): Notice {
  const what = event.object?.title ?? event.title;
  const thread = event.thread ?? event.id;
  if (signal.type === "review_requested") {
    return {
      kind: "review.requested",
      title: `${actorName} wants your review: ${what}`,
      priority: "high",
      dedupeKey: `review:${thread}`,
    };
  }
  if (signal.type === "mentioned") {
    return {
      kind: "mention",
      title: `${actorName} mentioned you${mentionPlace(event, what)}`,
      body: signal.excerpt ?? null,
      priority: signal.priority ?? "high",
      dedupeKey: `mention:${event.id}`,
    };
  }
  if (signal.type === "assigned") {
    return {
      kind: "assigned",
      title: `You were assigned ${what}`,
      priority: "normal",
      dedupeKey: `assigned:${thread}`,
    };
  }
  return {
    kind: "pr.review",
    title: `${actorName} ${REVIEW_VERB[signal.state] ?? "reviewed"} ${what}`,
    body: event.body?.slice(0, 280) ?? null,
    priority: REVIEW_PRIORITY[signal.state] ?? "normal",
    dedupeKey: `review-result:${thread}`,
  };
}

/** ": PR title", " in #channel" (chat), or ": headline". */
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
  scope: Scope,
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
  await ctx.db
    .update(attentionItems)
    .set({ state: "done", resolvedAt: ctx.now(), updatedAt: ctx.now() })
    .where(
      and(
        eq(attentionItems.workspaceId, scope.workspaceId),
        eq(attentionItems.dedupeKey, key),
        eq(attentionItems.state, "open"),
        who ? eq(attentionItems.memberId, who.id) : undefined
      )
    );
}

/**
 * Agent work: tell the human it was done for — loudly only when the agent is waiting on them
 * (Grok Bot / Cursor pattern: never notify while it's working).
 */
export async function applyAgentState(
  ctx: AppContext,
  input: {
    workspaceId: string;
    agentName: string;
    onBehalfOfId: string | null;
    state: string | null;
    title: string;
    url: string | null;
    activityId: string | null;
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
    url: input.url,
    activityId: input.activityId,
    fromId: input.agentId,
    priority: spec.priority,
    dedupeKey: `agent:${input.thread}`,
    replace: true,
  });
}
