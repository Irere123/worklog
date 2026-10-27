import { recordActivity } from "#activity/service";
import {
  assertAction,
  raiseAttention,
  updateAttention,
} from "#attention/service";
import type { AppContext } from "#context";
import { getAttentionById } from "#db/queries/attention";
import {
  getCardByNumber,
  listDriftingAssignments,
  listStaleCards,
} from "#db/queries/cards";
import type { Member } from "#db/queries/members";
import { badRequest } from "#lib/errors";
import { DAY_MS } from "#lib/time";

import { close, getCard, postpone, transition } from "./service";

export async function keepAlive(
  ctx: AppContext,
  actor: Member,
  number: number
) {
  const card = await getCardByNumber(ctx.db, {
    workspaceId: actor.workspaceId,
    number,
  });
  await recordActivity(ctx, {
    workspaceId: actor.workspaceId,
    actorId: actor.id,
    source: "worklog",
    kind: "card.kept",
    title: `#${card.number} ${card.title}`,
    body: "Still on it",
    cardId: card.id,
  });
  return await getCard(ctx, actor.workspaceId, number);
}

const DRIFT_ACTIONS = [
  { id: "keep", label: "Still on it" },
  { id: "not_now", label: "Not now" },
  { id: "done", label: "It's done" },
];

// Asks once per quiet spell.
export async function nudgeDrifting(ctx: AppContext): Promise<number> {
  const rows = await listDriftingAssignments(ctx.db, { now: ctx.now() });
  let raised = 0;
  for (const { card, days, memberId } of rows) {
    const driftsOn = new Date(card.lastActiveAt.getTime() + days * DAY_MS);
    const item = await raiseAttention(ctx, {
      workspaceId: card.workspaceId,
      memberId,
      kind: "card.drifting",
      title: `#${card.number} ${card.title} drifts to Not now on ${driftsOn.toISOString().slice(0, 10)} — still on it?`,
      cardId: card.id,
      priority: "normal",
      dedupeKey: `drift:${card.id}:${card.lastActiveAt.getTime()}`,
      actions: DRIFT_ACTIONS,
      meta: { cardNumber: card.number },
      onlyIfNew: true,
    });
    if (item) {
      raised += 1;
    }
  }
  return raised;
}

export async function sweepEntropy(ctx: AppContext): Promise<number> {
  const stale = await listStaleCards(ctx.db, { now: ctx.now() });
  for (const card of stale) {
    await transition(ctx, null, card.workspaceId, card.number, {
      stage: "not_now",
      kind: "card.auto_postponed",
      verb: "Drifted to Not now after no activity",
    });
  }
  return stale.length;
}

// The one-click answers on an attention item. Only drift items have actions today; when another
// kind gets some, this dispatcher moves above the domains it calls.
export async function performAttentionAction(
  ctx: AppContext,
  member: Member,
  id: string,
  actionId: string
) {
  const item = await getAttentionById(ctx.db, { id, memberId: member.id });
  assertAction(item, actionId);
  switch (item.kind) {
    case "card.drifting": {
      const number = Number(item.meta?.cardNumber);
      if (actionId === "keep") {
        await keepAlive(ctx, member, number);
      } else if (actionId === "not_now") {
        await postpone(ctx, member, member.workspaceId, number);
      } else if (actionId === "done") {
        await close(ctx, member, member.workspaceId, number);
      }
      break;
    }
    default: {
      throw badRequest(`No actions are wired up for ${item.kind} items`);
    }
  }
  return await updateAttention(ctx, member.id, id, { state: "done" });
}
