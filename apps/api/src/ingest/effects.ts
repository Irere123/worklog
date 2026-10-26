import { and, eq, inArray } from "drizzle-orm";
import { raiseAttention } from "../attention/service";
import * as board from "../board/service";
import type { AppContext } from "../context";
import { attentionItems, cards, members, type Priority } from "../db/schema";
import { resolveActor } from "./identity";
import type { BoardEffect, ExternalActor, Signal, WorklogEvent } from "./types";

type Member = typeof members.$inferSelect;
type Scope = { workspaceId: string; namespace: string; boardId?: string; source: string };

/** Cards an event refers to: external keys (from issue trackers) and Worklog numbers (WL-12). */
export async function findCardIds(ctx: AppContext, workspaceId: string, refs: WorklogEvent["cardRefs"]): Promise<string[]> {
  if (!refs) return [];
  const conds = [];
  if (refs.externalKeys?.length) conds.push(inArray(cards.externalKey, refs.externalKeys));
  if (refs.numbers?.length) conds.push(inArray(cards.number, refs.numbers));
  if (!conds.length) return [];
  const rows = await Promise.all(
    conds.map((c) => ctx.db.select({ id: cards.id }).from(cards).where(and(eq(cards.workspaceId, workspaceId), c))),
  );
  return [...new Set(rows.flat().map((r) => r.id))];
}

async function memberFor(ctx: AppContext, scope: Scope, who: ExternalActor, at: Date): Promise<Member | null> {
  const { memberId } = await resolveActor(ctx, scope.workspaceId, scope.namespace, who, at);
  if (!memberId) return null;
  const [m] = await ctx.db.select().from(members).where(eq(members.id, memberId));
  return m ?? null;
}

/**
 * Board effects from issue trackers. They run before the activity is written so it can link to the
 * card, and they're silent: the source event's own activity is the record of what happened.
 */
export async function applyBoardEffects(ctx: AppContext, scope: Scope, effects: BoardEffect[], actor: Member | null, at: Date) {
  const touched: string[] = [];
  for (const effect of effects) {
    const [card] = await ctx.db
      .select()
      .from(cards)
      .where(and(eq(cards.workspaceId, scope.workspaceId), eq(cards.externalKey, effect.externalKey)));
    switch (effect.type) {
      case "upsert_card": {
        if (card || !scope.boardId) break;
        const created = await board.createCard(
          ctx,
          actor,
          scope.workspaceId,
          { boardId: scope.boardId, title: effect.title, body: effect.body, source: scope.source, externalKey: effect.externalKey, externalUrl: effect.url },
          { silent: true },
        );
        touched.push(created.id);
        break;
      }
      case "close_card":
        if (card && card.stage !== "done") await board.close(ctx, actor, scope.workspaceId, card.number, { silent: true });
        if (card) touched.push(card.id);
        break;
      case "reopen_card":
        if (card && card.stage === "done") await board.reopen(ctx, actor, scope.workspaceId, card.number, { silent: true });
        if (card) touched.push(card.id);
        break;
      case "assign_card": {
        const who = await memberFor(ctx, scope, effect.who, at);
        if (card && who) await board.assign(ctx, actor, scope.workspaceId, card.number, who.id, { silent: true });
        break;
      }
    }
  }
  return touched;
}

const REVIEW_PRIORITY: Record<string, Priority> = { changes_requested: "high", approved: "normal", commented: "low" };

/** Signals become attention items for the people they concern — never for the person who acted. */
export async function applySignals(
  ctx: AppContext,
  scope: Scope,
  event: WorklogEvent,
  ctxInfo: { actor: Member | null; actorIsBot: boolean; activityId: string | null; cardId: string | null },
) {
  const actorName = ctxInfo.actor?.name ?? event.actor?.name ?? event.actor?.handle ?? "Someone";
  const what = event.object?.title ?? event.title;
  const url = event.object?.url ?? event.url ?? null;
  const thread = event.thread ?? event.id;
  // Bots can ask, but they can't interrupt: their signals are never high priority.
  const cap = (p: Priority): Priority => (ctxInfo.actorIsBot && p === "high" ? "normal" : p);

  for (const signal of event.signals ?? []) {
    if (signal.type === "resolve") {
      await resolveItems(ctx, scope, thread, signal, event.occurredAt);
      continue;
    }
    const who = await memberFor(ctx, scope, signal.who, event.occurredAt);
    if (!who || who.id === ctxInfo.actor?.id) continue;
    const base = { workspaceId: scope.workspaceId, memberId: who.id, url, cardId: ctxInfo.cardId, activityId: ctxInfo.activityId, fromId: ctxInfo.actor?.id ?? null };
    switch (signal.type) {
      case "review_requested":
        await raiseAttention(ctx, { ...base, kind: "review.requested", title: `${actorName} wants your review: ${what}`, priority: cap("high"), dedupeKey: `review:${thread}` });
        break;
      case "mentioned": {
        const where = event.object?.title ? `: ${event.object.title}` : event.container?.type === "channel" ? ` in #${event.container.name}` : `: ${what}`;
        await raiseAttention(ctx, {
          ...base,
          kind: "mention",
          title: `${actorName} mentioned you${where}`,
          body: signal.excerpt ?? null,
          priority: cap(signal.priority ?? "high"),
          dedupeKey: `mention:${event.id}`,
        });
        break;
      }
      case "assigned":
        await raiseAttention(ctx, { ...base, kind: "assigned", title: `You were assigned ${what}`, priority: cap("normal"), dedupeKey: `assigned:${thread}` });
        break;
      case "review_result": {
        const verb = signal.state === "approved" ? "approved" : signal.state === "changes_requested" ? "requested changes on" : "reviewed";
        await raiseAttention(ctx, {
          ...base,
          kind: "pr.review",
          title: `${actorName} ${verb} ${what}`,
          body: event.body?.slice(0, 280) ?? null,
          priority: cap(REVIEW_PRIORITY[signal.state] ?? "normal"),
          dedupeKey: `review-result:${thread}`,
        });
        break;
      }
    }
  }
}

async function resolveItems(ctx: AppContext, scope: Scope, thread: string, signal: Extract<Signal, { type: "resolve" }>, at: Date) {
  const key = signal.what === "review_requested" ? `review:${thread}` : `assigned:${thread}`;
  const who = signal.who ? await memberFor(ctx, scope, signal.who, at) : null;
  if (signal.who && !who) return;
  await ctx.db
    .update(attentionItems)
    .set({ state: "done", resolvedAt: ctx.now(), updatedAt: ctx.now() })
    .where(
      and(
        eq(attentionItems.workspaceId, scope.workspaceId),
        eq(attentionItems.dedupeKey, key),
        eq(attentionItems.state, "open"),
        who ? eq(attentionItems.memberId, who.id) : undefined,
      ),
    );
}

/**
 * Agent work: tell the human it was done for — loudly only when the agent is waiting on them
 * (Grok Bot / Cursor pattern: never notify while it's working).
 */
export async function applyAgentState(
  ctx: AppContext,
  input: { workspaceId: string; agentName: string; onBehalfOfId: string | null; state: string | null; title: string; url: string | null; activityId: string | null; thread: string; agentId: string | null },
) {
  if (!input.onBehalfOfId || !input.state || input.state === "working") return;
  const spec = {
    needs_you: { priority: "high" as const, title: `${input.agentName} needs you: ${input.title}` },
    failed: { priority: "normal" as const, title: `${input.agentName} couldn't finish: ${input.title}` },
    finished: { priority: "low" as const, title: `${input.agentName} finished: ${input.title}` },
  }[input.state];
  if (!spec) return;
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
