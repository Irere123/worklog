import { and, eq, sql } from "drizzle-orm";

import type { DbOrTx } from "#db";
import { ingestedEvents } from "#db/schema";

export type IngestedKey = {
  workspaceId: string;
  source: string;
  externalId: string;
};

const keyOf = (key: IngestedKey) =>
  and(
    eq(ingestedEvents.workspaceId, key.workspaceId),
    eq(ingestedEvents.source, key.source),
    eq(ingestedEvents.externalId, key.externalId)
  );

export async function insertIngestedEventIfNew(
  db: DbOrTx,
  params: IngestedKey & {
    connectionId: string | null;
    activityId: string | null;
  }
) {
  const rows = await db
    .insert(ingestedEvents)
    .values(params)
    .onConflictDoNothing()
    .returning({ externalId: ingestedEvents.externalId });
  return rows.length > 0;
}

export async function findIngestedEvent(db: DbOrTx, params: IngestedKey) {
  const [row] = await db
    .select({ activityId: ingestedEvents.activityId })
    .from(ingestedEvents)
    .where(keyOf(params));
  return row;
}

export async function setIngestedActivity(
  db: DbOrTx,
  params: IngestedKey & { activityId: string }
) {
  await db
    .update(ingestedEvents)
    .set({ activityId: params.activityId })
    .where(keyOf(params));
}

export async function deleteIngestedEvent(db: DbOrTx, params: IngestedKey) {
  await db.delete(ingestedEvents).where(keyOf(params));
}

export async function insertIngestedTombstone(
  db: DbOrTx,
  params: IngestedKey & { connectionId: string | null }
) {
  await db
    .insert(ingestedEvents)
    .values({ ...params, activityId: null })
    .onConflictDoNothing();
}

export async function deleteIngestedEventsBefore(
  db: DbOrTx,
  params: { connectionId: string; before: Date; limit: number }
) {
  const result = await db.execute(sql`
    delete from ingested_events
    where ctid = any(array(
      select ctid from ingested_events
      where connection_id = ${params.connectionId} and created_at < ${params.before}
      limit ${params.limit}
    ))`);
  return result.rowCount ?? 0;
}
