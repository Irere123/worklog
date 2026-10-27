import { and, asc, eq, gt, isNull, lt, or } from "drizzle-orm";

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

// Workspace-wide events plus the ones addressed to this member.
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
