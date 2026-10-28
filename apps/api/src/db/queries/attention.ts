import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  max,
  ne,
  or,
  sql,
} from "drizzle-orm";

import type { DbOrTx } from "#db";
import {
  activities,
  attentionFeedback,
  attentionItems,
  attentionResolutions,
  notifications,
} from "#db/schema";
import type { Priority } from "#db/schema";
import { notFound } from "#lib/errors";

export type AttentionItem = typeof attentionItems.$inferSelect;

// `onlyIfNew` and `replace` mean what they do on `AttentionInput` in attention/service.ts.
export async function upsertAttention(
  db: DbOrTx,
  params: {
    row: typeof attentionItems.$inferInsert & {
      priority: Priority;
      updatedAt: Date;
    };
    onlyIfNew: boolean;
    replace: boolean;
  }
) {
  const { row, onlyIfNew, replace } = params;
  const insert = db.insert(attentionItems).values(row);
  const [item] = onlyIfNew
    ? await insert.onConflictDoNothing().returning()
    : await insert
        .onConflictDoUpdate({
          target: [attentionItems.memberId, attentionItems.dedupeKey],
          set: {
            title: row.title,
            body: row.body ?? null,
            activityId: row.activityId ?? null,
            fromId: row.fromId ?? null,
            ...(replace ? { kind: row.kind } : {}),
            priority: replace
              ? row.priority
              : sql`case when ${rank(row.priority)} > ${rankSql()} then ${row.priority} else ${attentionItems.priority} end`,
            count: sql`${attentionItems.count} + 1`,
            state: "open",
            resolvedAt: null,
            // Something new happened: the proactive check should look at it again.
            consideredAt: null,
            disposition: null,
            reason: null,
            sourceAt: sql`greatest(${attentionItems.sourceAt}, excluded.source_at)`,
            updatedAt: row.updatedAt,
          },
        })
        .returning();
  return item;
}

function rank(p: Priority) {
  return { low: 0, normal: 1, high: 2 }[p];
}

function rankSql() {
  return sql`(case ${attentionItems.priority} when 'high' then 2 when 'normal' then 1 else 0 end)`;
}

const byPriority = sql`case ${attentionItems.priority} when 'high' then 0 when 'normal' then 1 else 2 end`;

// A snoozed item counts as open again once its snooze has passed.
function openOrWoken(now: Date) {
  return or(
    eq(attentionItems.state, "open"),
    and(
      eq(attentionItems.state, "snoozed"),
      lte(attentionItems.snoozedUntil, now)
    )
  );
}

export async function countHighPriorityFrom(
  db: DbOrTx,
  params: {
    memberId: string;
    fromId: string;
    exceptDedupeKey: string;
    since: Date;
  }
) {
  const [row] = await db
    .select({ n: count() })
    .from(attentionItems)
    .where(
      and(
        eq(attentionItems.memberId, params.memberId),
        eq(attentionItems.fromId, params.fromId),
        eq(attentionItems.priority, "high"),
        ne(attentionItems.dedupeKey, params.exceptDedupeKey),
        gte(attentionItems.updatedAt, params.since)
      )
    );
  return row?.n ?? 0;
}

export async function listOpenAttention(
  db: DbOrTx,
  params: { memberId: string; now: Date; limit?: number }
) {
  return await db
    .select()
    .from(attentionItems)
    .where(
      and(eq(attentionItems.memberId, params.memberId), openOrWoken(params.now))
    )
    .orderBy(byPriority, desc(attentionItems.updatedAt))
    .limit(params.limit ?? 100);
}

export async function listAttentionByState(
  db: DbOrTx,
  params: { memberId: string; state: AttentionItem["state"] }
) {
  return await db
    .select()
    .from(attentionItems)
    .where(
      and(
        eq(attentionItems.memberId, params.memberId),
        eq(attentionItems.state, params.state)
      )
    )
    .orderBy(desc(attentionItems.updatedAt))
    .limit(100);
}

export async function getAttentionById(
  db: DbOrTx,
  params: { id: string; memberId: string }
) {
  const [row] = await db
    .select()
    .from(attentionItems)
    .where(
      and(
        eq(attentionItems.id, params.id),
        eq(attentionItems.memberId, params.memberId)
      )
    );
  if (!row) {
    throw notFound("Attention item");
  }
  return row;
}

// `memberId` is optional for the proactive check, whose ids come from that member's own items.
export async function updateAttentionById(
  db: DbOrTx,
  params: {
    id: string;
    memberId?: string;
    set: Partial<
      Pick<
        AttentionItem,
        | "state"
        | "snoozedUntil"
        | "resolvedAt"
        | "actedAt"
        | "updatedAt"
        | "consideredAt"
        | "disposition"
        | "reason"
        | "pushedAt"
      >
    >;
  }
) {
  const [row] = await db
    .update(attentionItems)
    .set(params.set)
    .where(
      and(
        eq(attentionItems.id, params.id),
        params.memberId
          ? eq(attentionItems.memberId, params.memberId)
          : undefined
      )
    )
    .returning();
  return row;
}

export async function listUnconsideredAttention(
  db: DbOrTx,
  params: { memberId: string; now: Date }
) {
  return await db
    .select()
    .from(attentionItems)
    .where(
      and(
        eq(attentionItems.memberId, params.memberId),
        openOrWoken(params.now),
        isNull(attentionItems.consideredAt)
      )
    )
    .orderBy(desc(attentionItems.updatedAt));
}

export async function listDigestableAttention(
  db: DbOrTx,
  params: { memberId: string; now: Date }
) {
  return await db
    .select()
    .from(attentionItems)
    .where(
      and(
        eq(attentionItems.memberId, params.memberId),
        openOrWoken(params.now),
        or(
          isNull(attentionItems.digestedAt),
          sql`${attentionItems.digestedAt} < ${attentionItems.updatedAt}`
        ),
        or(
          isNull(attentionItems.pushedAt),
          sql`${attentionItems.pushedAt} < ${attentionItems.updatedAt}`
        )
      )
    )
    .orderBy(byPriority, desc(attentionItems.updatedAt));
}

// A digested item counts as considered, so the proactive check doesn't push it again.
export async function setAttentionDigested(
  db: DbOrTx,
  params: { ids: string[]; at: Date }
) {
  if (!params.ids.length) {
    return;
  }
  await db
    .update(attentionItems)
    .set({
      digestedAt: params.at,
      consideredAt: sql`coalesce(${attentionItems.consideredAt}, ${params.at.toISOString()}::timestamptz)`,
    })
    .where(inArray(attentionItems.id, params.ids));
}

export async function listPushedAttention(
  db: DbOrTx,
  params: { memberId: string; since: Date }
) {
  return await db
    .select({
      state: attentionItems.state,
      actedAt: attentionItems.actedAt,
    })
    .from(attentionItems)
    .where(
      and(
        eq(attentionItems.memberId, params.memberId),
        gte(attentionItems.pushedAt, params.since)
      )
    );
}

// Without `memberId`, closes the open item for everyone who has it.
// With `before`, only items raised by something that happened before then: a late resolve leaves
// a newer request open.
export async function setOpenAttentionDone(
  db: DbOrTx,
  params: {
    workspaceId: string;
    dedupeKey: string;
    memberId?: string;
    before?: Date;
    at: Date;
  }
) {
  await db
    .update(attentionItems)
    .set({ state: "done", resolvedAt: params.at, updatedAt: params.at })
    .where(
      and(
        eq(attentionItems.workspaceId, params.workspaceId),
        eq(attentionItems.dedupeKey, params.dedupeKey),
        eq(attentionItems.state, "open"),
        params.memberId
          ? eq(attentionItems.memberId, params.memberId)
          : undefined,
        params.before
          ? or(
              isNull(attentionItems.sourceAt),
              lte(attentionItems.sourceAt, params.before)
            )
          : undefined
      )
    );
}

// Keeps the latest source time, whichever order resolves arrive in.
// Whatever the items' state: the text of something edited or deleted at its source mustn't linger.
export async function updateAttentionText(
  db: DbOrTx,
  params: { workspaceId: string; dedupeKey: string; body: string | null }
) {
  await db
    .update(attentionItems)
    .set({ body: params.body })
    .where(
      and(
        eq(attentionItems.workspaceId, params.workspaceId),
        eq(attentionItems.dedupeKey, params.dedupeKey)
      )
    );
}

export async function upsertAttentionResolution(
  db: DbOrTx,
  params: {
    workspaceId: string;
    /** Empty when resolved for everyone. */
    memberId: string;
    dedupeKey: string;
    at: Date;
  }
) {
  await db
    .insert(attentionResolutions)
    .values({
      workspaceId: params.workspaceId,
      memberId: params.memberId,
      dedupeKey: params.dedupeKey,
      resolvedThrough: params.at,
    })
    .onConflictDoUpdate({
      target: [
        attentionResolutions.workspaceId,
        attentionResolutions.dedupeKey,
        attentionResolutions.memberId,
      ],
      set: {
        resolvedThrough: sql`greatest(${attentionResolutions.resolvedThrough}, excluded.resolved_through)`,
      },
    });
}

// The member's own resolution or one for everyone, whichever is later.
export async function findAttentionResolvedThrough(
  db: DbOrTx,
  params: { workspaceId: string; memberId: string; dedupeKey: string }
) {
  const [row] = await db
    .select({ at: max(attentionResolutions.resolvedThrough) })
    .from(attentionResolutions)
    .where(
      and(
        eq(attentionResolutions.workspaceId, params.workspaceId),
        eq(attentionResolutions.dedupeKey, params.dedupeKey),
        inArray(attentionResolutions.memberId, [params.memberId, ""])
      )
    );
  return row?.at ?? null;
}

export async function deleteAttentionResolutionsBefore(
  db: DbOrTx,
  params: { before: Date }
) {
  const deleted = await db
    .delete(attentionResolutions)
    .where(lt(attentionResolutions.resolvedThrough, params.before))
    .returning({ key: attentionResolutions.dedupeKey });
  return deleted.length;
}

export async function insertNotification(
  db: DbOrTx,
  row: typeof notifications.$inferInsert
) {
  await db.insert(notifications).values(row);
}

export async function countPushesSince(
  db: DbOrTx,
  params: { memberId: string; since: Date }
) {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.memberId, params.memberId),
        eq(notifications.kind, "push"),
        gte(notifications.createdAt, params.since)
      )
    );
  return row?.n ?? 0;
}

export async function findLastPushAt(db: DbOrTx, params: { memberId: string }) {
  const [row] = await db
    .select({ at: notifications.createdAt })
    .from(notifications)
    .where(
      and(
        eq(notifications.memberId, params.memberId),
        eq(notifications.kind, "push")
      )
    )
    .orderBy(desc(notifications.createdAt))
    .limit(1);
  return row?.at;
}

export async function insertFeedback(
  db: DbOrTx,
  row: typeof attentionFeedback.$inferInsert
) {
  await db.insert(attentionFeedback).values(row);
}

export async function countFeedbackByKind(
  db: DbOrTx,
  params: { memberId: string; since: Date }
) {
  return await db
    .select({
      kind: attentionFeedback.kind,
      signal: attentionFeedback.signal,
      n: count(),
    })
    .from(attentionFeedback)
    .where(
      and(
        eq(attentionFeedback.memberId, params.memberId),
        gte(attentionFeedback.createdAt, params.since)
      )
    )
    .groupBy(attentionFeedback.kind, attentionFeedback.signal);
}

export async function countFeedbackBySignal(
  db: DbOrTx,
  params: { memberId: string; since: Date }
) {
  return await db
    .select({ signal: attentionFeedback.signal, n: count() })
    .from(attentionFeedback)
    .where(
      and(
        eq(attentionFeedback.memberId, params.memberId),
        gte(attentionFeedback.createdAt, params.since)
      )
    )
    .groupBy(attentionFeedback.signal);
}

// An item is as visible as the activity that raised it. One that no activity raised, such as a
// teammate's note to the owner, stays private.
export async function listTeamVisibleAttentionIds(
  db: DbOrTx,
  params: { ids: string[] }
) {
  if (!params.ids.length) {
    return [];
  }
  const rows = await db
    .select({ id: attentionItems.id })
    .from(attentionItems)
    .innerJoin(activities, eq(activities.id, attentionItems.activityId))
    .where(
      and(
        inArray(attentionItems.id, params.ids),
        eq(activities.visibility, "team")
      )
    );
  return rows.map((r) => r.id);
}
