import { and, asc, desc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";

import type { DbOrTx } from "#db";
import { events } from "#db/schema";
import { returned } from "#lib/assert";

export type StoredEvent = typeof events.$inferSelect;

export async function insertEvent(
  db: DbOrTx,
  row: Pick<
    typeof events.$inferInsert,
    "workspaceId" | "audienceId" | "type" | "data"
  >
) {
  const rows = await db.insert(events).values(row).returning();
  return returned(rows, "event");
}

export async function insertEvents(
  db: DbOrTx,
  rows: Pick<
    typeof events.$inferInsert,
    "workspaceId" | "audienceId" | "type" | "data"
  >[]
) {
  if (rows.length === 0) {
    return [];
  }
  const inserted = await db.insert(events).values(rows).returning();
  return inserted.toSorted((a, b) => a.seq - b.seq);
}

export async function listEventsAfter(
  db: DbOrTx,
  params: {
    workspaceId: string;
    memberId: string;
    afterSeq: number;
    limit: number;
  }
): Promise<StoredEvent[]> {
  return await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.workspaceId, params.workspaceId),
        gt(events.seq, params.afterSeq),
        or(isNull(events.audienceId), eq(events.audienceId, params.memberId))
      )
    )
    .orderBy(asc(events.seq))
    .limit(params.limit);
}

export async function deleteEventsBefore(db: DbOrTx, params: { before: Date }) {
  await db.delete(events).where(lt(events.createdAt, params.before));
}

export async function listAllEventsAfter(
  db: DbOrTx,
  params: { afterSeq: number; alsoSeqs: number[]; limit: number }
): Promise<StoredEvent[]> {
  return await db
    .select()
    .from(events)
    .where(
      params.alsoSeqs.length > 0
        ? or(
            gt(events.seq, params.afterSeq),
            inArray(events.seq, params.alsoSeqs)
          )
        : gt(events.seq, params.afterSeq)
    )
    .orderBy(asc(events.seq))
    .limit(params.limit);
}

export async function findLatestEventSeq(db: DbOrTx) {
  const [row] = await db
    .select({ seq: events.seq })
    .from(events)
    .orderBy(desc(events.seq))
    .limit(1);
  return row?.seq ?? 0;
}
