import type { AppContext } from "#context";
import {
  countFeedbackByKind,
  countFeedbackBySignal,
  countHighPriorityFrom,
  countPushesSince,
  findLastPushAt,
  getAttentionById,
  insertFeedback,
  insertNotification,
  listAttentionByState,
  listOpenAttention,
  listPushedAttention,
  listTeamVisibleAttentionIds,
  setAttentionDigested,
  updateAttentionById,
  upsertAttention,
} from "#db/queries/attention";
import type { AttentionItem } from "#db/queries/attention";
import { setCheckDueBy } from "#db/queries/automations";
import { findMemberById } from "#db/queries/members";
import type { FEEDBACK_SIGNALS, Priority } from "#db/schema";
import { transact } from "#db/transact";
import { badRequest, notFound } from "#lib/errors";
import { generateId } from "#lib/ids";
import { DAY_MS } from "#lib/time";

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
  /** When what raised it happened at its source, for a later resolve to compare with. */
  sourceAt?: Date | null;
};

/** How many high-priority items one sender may raise for one person per day; the rest become normal. */
const SENDER_HIGH_QUOTA = { human: 2, agent: 1 } as const;
/** An urgent item pulls that person's attention check forward to now + this, merging bursts. */
const URGENT_DEBOUNCE_MS = 3 * 60_000;

export async function raiseAttention(
  ctx: AppContext,
  input: AttentionInput
): Promise<AttentionItem | null> {
  return await transact(ctx, async (tx) => {
    const now = tx.now();
    const priority = await applySenderQuota(tx, input);
    const row = await upsertAttention(tx.db, {
      row: {
        id: generateId(),
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
        sourceAt: input.sourceAt ?? null,
        createdAt: now,
        updatedAt: now,
      },
      onlyIfNew: input.onlyIfNew ?? false,
      replace: input.replace ?? false,
    });
    if (!row) {
      return null;
    }

    if (row.priority === "high") {
      await setCheckDueBy(tx.db, {
        memberId: input.memberId,
        at: new Date(now.getTime() + URGENT_DEBOUNCE_MS),
      });
    }
    await tx.bus.publish({
      workspaceId: input.workspaceId,
      audienceId: input.memberId,
      type: "attention.updated",
      data: {
        id: row.id,
        kind: row.kind,
        title: row.title,
        priority: row.priority,
        state: row.state,
      },
    });
    return row;
  });
}

async function applySenderQuota(
  ctx: AppContext,
  input: AttentionInput
): Promise<Priority> {
  if (input.priority !== "high" || !input.fromId) {
    return input.priority;
  }
  const sender = await findMemberById(ctx.db, { id: input.fromId });
  const quota = SENDER_HIGH_QUOTA[sender?.kind ?? "human"];
  const sent = await countHighPriorityFrom(ctx.db, {
    memberId: input.memberId,
    fromId: input.fromId,
    exceptDedupeKey: input.dedupeKey,
    since: new Date(ctx.now().getTime() - DAY_MS),
  });
  return sent >= quota ? "normal" : "high";
}

export async function listAttention(
  ctx: AppContext,
  memberId: string,
  state?: AttentionItem["state"]
) {
  if (!state || state === "open") {
    return await listOpenAttention(ctx.db, { memberId, now: ctx.now() });
  }
  return await listAttentionByState(ctx.db, { memberId, state });
}

export async function updateAttention(
  ctx: AppContext,
  memberId: string,
  id: string,
  patch: { state: AttentionItem["state"]; snoozedUntil?: Date | null }
) {
  const resolved = patch.state === "done" || patch.state === "dismissed";
  const row = await updateAttentionById(ctx.db, {
    id,
    memberId,
    set: {
      state: patch.state,
      snoozedUntil:
        patch.state === "snoozed" ? (patch.snoozedUntil ?? null) : null,
      resolvedAt: resolved ? ctx.now() : null,
      ...(patch.state === "done" ? { actedAt: ctx.now() } : {}),
      updatedAt: ctx.now(),
    },
  });
  if (!row) {
    throw notFound("Attention item");
  }
  await ctx.bus.publish({
    workspaceId: row.workspaceId,
    audienceId: memberId,
    type: "attention.updated",
    data: {
      id: row.id,
      kind: row.kind,
      title: row.title,
      priority: row.priority,
      state: row.state,
    },
  });
  return row;
}

export async function markConsidered(
  ctx: AppContext,
  decisions: {
    id: string;
    disposition: "push" | "digest" | "drop";
    reason: string;
  }[]
) {
  for (const d of decisions) {
    await updateAttentionById(ctx.db, {
      id: d.id,
      set: {
        consideredAt: ctx.now(),
        disposition: d.disposition,
        reason: d.reason,
        ...(d.disposition === "push" ? { pushedAt: ctx.now() } : {}),
      },
    });
  }
}

export async function markDigested(ctx: AppContext, ids: string[]) {
  await setAttentionDigested(ctx.db, { ids, at: ctx.now() });
}

export async function recordNotification(
  ctx: AppContext,
  input: {
    workspaceId: string;
    memberId: string;
    automationId?: string | null;
    kind: string;
    itemIds: string[];
    subject: string;
    body: string;
    teamBody?: string | null;
    reason?: string | null;
    deliveredTo: string[];
  }
) {
  await insertNotification(ctx.db, {
    id: generateId(),
    automationId: null,
    teamBody: null,
    reason: null,
    ...input,
    createdAt: ctx.now(),
  });
}

// The items a team-visible message may mention.
export async function teamVisibleAttention(
  ctx: AppContext,
  items: AttentionItem[]
) {
  const visible = new Set(
    await listTeamVisibleAttentionIds(ctx.db, { ids: items.map((i) => i.id) })
  );
  return items.filter((i) => visible.has(i.id));
}

export async function pushBudget(
  ctx: AppContext,
  memberId: string,
  since: Date
) {
  const [pushesToday, lastPushAt] = await Promise.all([
    countPushesSince(ctx.db, { memberId, since }),
    findLastPushAt(ctx.db, { memberId }),
  ]);
  return { pushesToday, lastPushAt: lastPushAt ?? null };
}

export async function giveFeedback(
  ctx: AppContext,
  memberId: string,
  id: string,
  signal: FeedbackSignal
) {
  const item = await getAttentionById(ctx.db, { id, memberId });
  await insertFeedback(ctx.db, {
    id: generateId(),
    workspaceId: item.workspaceId,
    memberId,
    attentionId: item.id,
    kind: item.kind,
    signal,
    createdAt: ctx.now(),
  });
  const muted = await mutedKinds(ctx, memberId);
  return { kind: item.kind, muted: muted.has(item.kind) };
}

export async function mutedKinds(
  ctx: AppContext,
  memberId: string
): Promise<Set<string>> {
  const rows = await countFeedbackByKind(ctx.db, {
    memberId,
    since: new Date(ctx.now().getTime() - 14 * DAY_MS),
  });
  const byKind = new Map<string, Record<string, number>>();
  for (const r of rows) {
    byKind.set(r.kind, { ...byKind.get(r.kind), [r.signal]: r.n });
  }
  const muted = new Set<string>();
  for (const [kind, s] of byKind) {
    if ((s.useful ?? 0) > 0) {
      continue;
    }
    if ((s.less_like_this ?? 0) >= 1 || (s.not_useful ?? 0) >= 3) {
      muted.add(kind);
    }
  }
  return muted;
}

export async function attentionMetrics(
  ctx: AppContext,
  memberId: string,
  days = 14
) {
  const since = new Date(ctx.now().getTime() - days * DAY_MS);
  const [pushes, pushedItems, feedback, muted] = await Promise.all([
    countPushesSince(ctx.db, { memberId, since }),
    listPushedAttention(ctx.db, { memberId, since }),
    countFeedbackBySignal(ctx.db, { memberId, since }),
    mutedKinds(ctx, memberId),
  ]);
  const countOf = (signal: FeedbackSignal) =>
    feedback.find((f) => f.signal === signal)?.n ?? 0;
  const fb: Record<FeedbackSignal, number> = {
    useful: countOf("useful"),
    not_useful: countOf("not_useful"),
    less_like_this: countOf("less_like_this"),
  };
  const rated = fb.useful + fb.not_useful + fb.less_like_this;
  const acted = pushedItems.filter(
    (p) => p.actedAt !== null || p.state === "done"
  ).length;
  const dismissed = pushedItems.filter((p) => p.state === "dismissed").length;
  return {
    days,
    pushes,
    itemsPushed: pushedItems.length,
    actedOnRate: pushedItems.length ? acted / pushedItems.length : null,
    dismissalRate: pushedItems.length ? dismissed / pushedItems.length : null,
    feedback: fb,
    precision: rated ? fb.useful / rated : null,
    mutedKinds: [...muted],
  };
}

export function assertAction(item: AttentionItem, actionId: string) {
  const offered = item.actions ?? [];
  if (!offered.some((a) => a.id === actionId)) {
    throw badRequest(`"${actionId}" isn't an action on this item`);
  }
}
