import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import {
  attentionFeedback,
  attentionItems,
  automations,
  members,
  notifications,
  FEEDBACK_SIGNALS,
  type Priority,
} from "../db/schema";
import { badRequest, notFound } from "../lib/errors";
import { newId } from "../lib/ids";
import { DAY_MS } from "../lib/time";

export type AttentionRow = typeof attentionItems.$inferSelect;
export type FeedbackSignal = (typeof FEEDBACK_SIGNALS)[number];

export type AttentionInput = {
  workspaceId: string;
  memberId: string;
  kind: string;
  title: string;
  body?: string | null;
  url?: string | null;
  cardId?: string | null;
  activityId?: string | null;
  fromId?: string | null;
  priority: Priority;
  /** Items with the same key collapse into one (count++), and re-open if they were resolved. */
  dedupeKey: string;
  actions?: { id: string; label: string }[] | null;
  meta?: Record<string, unknown> | null;
  /** Don't touch an existing item with this key (for periodic nudges that shouldn't bump counts). */
  onlyIfNew?: boolean;
  /** Replace kind and priority instead of keeping the highest seen (an agent's thread reflects its latest state). */
  replace?: boolean;
};

/** How many high-priority items one sender may raise for one person per day; the rest become normal. */
const SENDER_HIGH_QUOTA = { human: 2, agent: 1 } as const;
/** An urgent item pulls that person's attention check forward to now + this, merging bursts. */
const URGENT_DEBOUNCE_MS = 3 * 60_000;

export async function raiseAttention(ctx: AppContext, input: AttentionInput): Promise<AttentionRow | null> {
  const now = ctx.now();
  const priority = await applySenderQuota(ctx, input);
  const values = {
    id: newId("att"),
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    kind: input.kind,
    title: input.title,
    body: input.body ?? null,
    url: input.url ?? null,
    cardId: input.cardId ?? null,
    activityId: input.activityId ?? null,
    fromId: input.fromId ?? null,
    priority,
    dedupeKey: input.dedupeKey,
    actions: input.actions ?? null,
    meta: input.meta ?? null,
    createdAt: now,
    updatedAt: now,
  };
  const insert = ctx.db.insert(attentionItems).values(values);
  const [row] = input.onlyIfNew
    ? await insert.onConflictDoNothing().returning()
    : await insert
        .onConflictDoUpdate({
          target: [attentionItems.memberId, attentionItems.dedupeKey],
          set: {
            title: input.title,
            body: input.body ?? null,
            activityId: input.activityId ?? null,
            fromId: input.fromId ?? null,
            ...(input.replace ? { kind: input.kind } : {}),
            // Keep the highest priority seen for this item (unless replacing).
            priority: input.replace ? priority : sql`case when ${rank(priority)} > ${rankSql()} then ${priority} else ${attentionItems.priority} end`,
            count: sql`${attentionItems.count} + 1`,
            state: "open",
            resolvedAt: null,
            // Something new happened: the proactive check should look at it again.
            consideredAt: null,
            disposition: null,
            reason: null,
            updatedAt: now,
          },
        })
        .returning();
  if (!row) return null;

  if (row.priority === "high") {
    await ctx.db
      .update(automations)
      .set({ nextRunAt: sql`least(${automations.nextRunAt}, ${new Date(now.getTime() + URGENT_DEBOUNCE_MS).toISOString()}::timestamptz)` })
      .where(and(eq(automations.memberId, input.memberId), eq(automations.kind, "check"), eq(automations.enabled, true)));
  }
  await ctx.bus.publish({
    workspaceId: input.workspaceId,
    audienceId: input.memberId,
    type: "attention.updated",
    data: { id: row.id, kind: row.kind, title: row.title, priority: row.priority, state: row.state },
  });
  return row;
}

const rank = (p: Priority) => ({ low: 0, normal: 1, high: 2 })[p];
const rankSql = () => sql`(case ${attentionItems.priority} when 'high' then 2 when 'normal' then 1 else 0 end)`;

async function applySenderQuota(ctx: AppContext, input: AttentionInput): Promise<Priority> {
  if (input.priority !== "high" || !input.fromId) return input.priority;
  const [sender] = await ctx.db.select({ kind: members.kind }).from(members).where(eq(members.id, input.fromId));
  const quota = SENDER_HIGH_QUOTA[sender?.kind ?? "human"];
  const [{ n }] = (await ctx.db
    .select({ n: count() })
    .from(attentionItems)
    .where(
      and(
        eq(attentionItems.memberId, input.memberId),
        eq(attentionItems.fromId, input.fromId),
        eq(attentionItems.priority, "high"),
        ne(attentionItems.dedupeKey, input.dedupeKey),
        gte(attentionItems.updatedAt, new Date(ctx.now().getTime() - DAY_MS)),
      ),
    )) as [{ n: number }];
  return n >= quota ? "normal" : "high";
}

/** Open items, including snoozed ones whose snooze has expired. Highest priority, then newest. */
export async function listOpenAttention(ctx: AppContext, memberId: string, limit = 100) {
  return ctx.db
    .select()
    .from(attentionItems)
    .where(and(eq(attentionItems.memberId, memberId), openOrWoken(ctx)))
    .orderBy(sql`case ${attentionItems.priority} when 'high' then 0 when 'normal' then 1 else 2 end`, desc(attentionItems.updatedAt))
    .limit(limit);
}

const openOrWoken = (ctx: AppContext) =>
  or(eq(attentionItems.state, "open"), and(eq(attentionItems.state, "snoozed"), lte(attentionItems.snoozedUntil, ctx.now())))!;

export async function listAttention(ctx: AppContext, memberId: string, state?: AttentionRow["state"]) {
  if (!state || state === "open") return listOpenAttention(ctx, memberId);
  return ctx.db
    .select()
    .from(attentionItems)
    .where(and(eq(attentionItems.memberId, memberId), eq(attentionItems.state, state)))
    .orderBy(desc(attentionItems.updatedAt))
    .limit(100);
}

export async function getAttention(ctx: AppContext, memberId: string, id: string) {
  const [row] = await ctx.db
    .select()
    .from(attentionItems)
    .where(and(eq(attentionItems.id, id), eq(attentionItems.memberId, memberId)));
  if (!row) throw notFound("Attention item");
  return row;
}

export async function updateAttention(
  ctx: AppContext,
  memberId: string,
  id: string,
  patch: { state: AttentionRow["state"]; snoozedUntil?: Date | null },
) {
  const resolved = patch.state === "done" || patch.state === "dismissed";
  const [row] = await ctx.db
    .update(attentionItems)
    .set({
      state: patch.state,
      snoozedUntil: patch.state === "snoozed" ? (patch.snoozedUntil ?? null) : null,
      resolvedAt: resolved ? ctx.now() : null,
      ...(patch.state === "done" ? { actedAt: ctx.now() } : {}),
      updatedAt: ctx.now(),
    })
    .where(and(eq(attentionItems.id, id), eq(attentionItems.memberId, memberId)))
    .returning();
  if (!row) throw notFound("Attention item");
  await ctx.bus.publish({
    workspaceId: row.workspaceId,
    audienceId: memberId,
    type: "attention.updated",
    data: { id: row.id, kind: row.kind, title: row.title, priority: row.priority, state: row.state },
  });
  return row;
}

// ---------------------------------------------------------------------------
// The proactive check's bookkeeping
// ---------------------------------------------------------------------------

/** Open items the proactive check hasn't evaluated since they last changed. */
export async function unconsideredAttention(ctx: AppContext, memberId: string) {
  return ctx.db
    .select()
    .from(attentionItems)
    .where(and(eq(attentionItems.memberId, memberId), openOrWoken(ctx), isNull(attentionItems.consideredAt)))
    .orderBy(desc(attentionItems.updatedAt));
}

export async function markConsidered(ctx: AppContext, decisions: { id: string; disposition: "push" | "digest" | "drop"; reason: string }[]) {
  for (const d of decisions) {
    await ctx.db
      .update(attentionItems)
      .set({
        consideredAt: ctx.now(),
        disposition: d.disposition,
        reason: d.reason,
        ...(d.disposition === "push" ? { pushedAt: ctx.now() } : {}),
      })
      .where(eq(attentionItems.id, d.id));
  }
}

/** Open items with something new since they were last pushed or digested — what a digest should list. */
export async function digestableAttention(ctx: AppContext, memberId: string) {
  return ctx.db
    .select()
    .from(attentionItems)
    .where(
      and(
        eq(attentionItems.memberId, memberId),
        openOrWoken(ctx),
        or(isNull(attentionItems.digestedAt), sql`${attentionItems.digestedAt} < ${attentionItems.updatedAt}`),
        or(isNull(attentionItems.pushedAt), sql`${attentionItems.pushedAt} < ${attentionItems.updatedAt}`),
      ),
    )
    .orderBy(sql`case ${attentionItems.priority} when 'high' then 0 when 'normal' then 1 else 2 end`, desc(attentionItems.updatedAt));
}

export async function markDigested(ctx: AppContext, ids: string[]) {
  if (!ids.length) return;
  await ctx.db
    .update(attentionItems)
    .set({ digestedAt: ctx.now(), consideredAt: sql`coalesce(${attentionItems.consideredAt}, ${ctx.now().toISOString()}::timestamptz)` })
    .where(inArray(attentionItems.id, ids));
}

export async function recordNotification(
  ctx: AppContext,
  input: { workspaceId: string; memberId: string; automationId?: string | null; kind: string; itemIds: string[]; subject: string; body: string; reason?: string | null; deliveredTo: string[] },
) {
  await ctx.db.insert(notifications).values({ id: newId("ntf"), automationId: null, reason: null, ...input, createdAt: ctx.now() });
}

export async function pushBudget(ctx: AppContext, memberId: string, since: Date) {
  const [stats] = (await ctx.db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.memberId, memberId), eq(notifications.kind, "push"), gte(notifications.createdAt, since)))) as [{ n: number }];
  const [latest] = await ctx.db
    .select({ at: notifications.createdAt })
    .from(notifications)
    .where(and(eq(notifications.memberId, memberId), eq(notifications.kind, "push")))
    .orderBy(desc(notifications.createdAt))
    .limit(1);
  return { pushesToday: Number(stats.n), lastPushAt: latest?.at ?? null };
}

// ---------------------------------------------------------------------------
// Feedback: the learning signal
// ---------------------------------------------------------------------------

export async function giveFeedback(ctx: AppContext, memberId: string, id: string, signal: FeedbackSignal) {
  const item = await getAttention(ctx, memberId, id);
  await ctx.db.insert(attentionFeedback).values({
    id: newId("fbk"),
    workspaceId: item.workspaceId,
    memberId,
    attentionId: item.id,
    kind: item.kind,
    signal,
    createdAt: ctx.now(),
  });
  return { kind: item.kind, muted: (await mutedKinds(ctx, memberId)).has(item.kind) };
}

/**
 * Kinds this person keeps rejecting are held for digests instead of pushed: one explicit
 * "less like this", or 3+ "not useful" with no "useful" in the last 14 days.
 */
export async function mutedKinds(ctx: AppContext, memberId: string): Promise<Set<string>> {
  const rows = await ctx.db
    .select({ kind: attentionFeedback.kind, signal: attentionFeedback.signal, n: count() })
    .from(attentionFeedback)
    .where(and(eq(attentionFeedback.memberId, memberId), gte(attentionFeedback.createdAt, new Date(ctx.now().getTime() - 14 * DAY_MS))))
    .groupBy(attentionFeedback.kind, attentionFeedback.signal);
  const byKind = new Map<string, Record<string, number>>();
  for (const r of rows) byKind.set(r.kind, { ...byKind.get(r.kind), [r.signal]: Number(r.n) });
  const muted = new Set<string>();
  for (const [kind, s] of byKind) {
    if (s.useful) continue;
    if ((s.less_like_this ?? 0) >= 1 || (s.not_useful ?? 0) >= 3) muted.add(kind);
  }
  return muted;
}

/** How well the proactive side is doing for this person — push precision and engagement. */
export async function attentionMetrics(ctx: AppContext, memberId: string, days = 14) {
  const since = new Date(ctx.now().getTime() - days * DAY_MS);
  const [pushes, pushedItems, feedback, muted] = await Promise.all([
    ctx.db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.memberId, memberId), eq(notifications.kind, "push"), gte(notifications.createdAt, since))),
    ctx.db
      .select({ state: attentionItems.state, acted: isNotNull(attentionItems.actedAt) })
      .from(attentionItems)
      .where(and(eq(attentionItems.memberId, memberId), gte(attentionItems.pushedAt, since))),
    ctx.db
      .select({ signal: attentionFeedback.signal, n: count() })
      .from(attentionFeedback)
      .where(and(eq(attentionFeedback.memberId, memberId), gte(attentionFeedback.createdAt, since)))
      .groupBy(attentionFeedback.signal),
    mutedKinds(ctx, memberId),
  ]);
  const fb = Object.fromEntries(FEEDBACK_SIGNALS.map((s) => [s, Number(feedback.find((f) => f.signal === s)?.n ?? 0)])) as Record<FeedbackSignal, number>;
  const rated = fb.useful + fb.not_useful + fb.less_like_this;
  const acted = pushedItems.filter((p) => p.acted || p.state === "done").length;
  const dismissed = pushedItems.filter((p) => p.state === "dismissed").length;
  return {
    days,
    pushes: Number(pushes[0]?.n ?? 0),
    itemsPushed: pushedItems.length,
    actedOnRate: pushedItems.length ? acted / pushedItems.length : null,
    dismissalRate: pushedItems.length ? dismissed / pushedItems.length : null,
    feedback: fb,
    precision: rated ? fb.useful / rated : null,
    mutedKinds: [...muted],
  };
}

export function assertAction(item: AttentionRow, actionId: string) {
  if (!item.actions?.some((a) => a.id === actionId)) throw badRequest(`"${actionId}" isn't an action on this item`);
}
