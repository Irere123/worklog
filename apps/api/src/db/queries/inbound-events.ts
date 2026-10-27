import { and, asc, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import type { DbOrTx } from "#db";
import { inboundEvents } from "#db/schema";

export type InboundEvent = typeof inboundEvents.$inferSelect;

// A redelivery (same connection and delivery id) inserts nothing and returns undefined.
export async function insertInboundEvent(
  db: DbOrTx,
  row: typeof inboundEvents.$inferInsert
) {
  const [inserted] = await db
    .insert(inboundEvents)
    .values(row)
    .onConflictDoNothing()
    .returning({ id: inboundEvents.id });
  return inserted;
}

export async function findInboundEventById(db: DbOrTx, params: { id: string }) {
  const [row] = await db
    .select()
    .from(inboundEvents)
    .where(eq(inboundEvents.id, params.id));
  return row;
}

// Counts the attempt, whether it succeeded or failed.
export async function updateInboundAttempt(
  db: DbOrTx,
  params: {
    id: string;
    set: Partial<
      Pick<InboundEvent, "status" | "outcome" | "error" | "processedAt">
    >;
  }
) {
  await db
    .update(inboundEvents)
    .set({ ...params.set, attempts: sql`${inboundEvents.attempts} + 1` })
    .where(eq(inboundEvents.id, params.id));
}

export async function listInboundEvents(
  db: DbOrTx,
  params: {
    connectionId: string;
    status?: InboundEvent["status"];
    limit: number;
  }
) {
  return await db
    .select()
    .from(inboundEvents)
    .where(
      and(
        eq(inboundEvents.connectionId, params.connectionId),
        params.status ? eq(inboundEvents.status, params.status) : undefined
      )
    )
    .orderBy(desc(inboundEvents.receivedAt))
    .limit(params.limit);
}

// Oldest first: replay must process deliveries in the order they arrived.
export async function listInboundEventIds(
  db: DbOrTx,
  params: { workspaceId: string; connectionId: string; since?: Date }
) {
  const rows = await db
    .select({ id: inboundEvents.id })
    .from(inboundEvents)
    .where(
      and(
        eq(inboundEvents.connectionId, params.connectionId),
        eq(inboundEvents.workspaceId, params.workspaceId),
        params.since ? gte(inboundEvents.receivedAt, params.since) : undefined
      )
    )
    .orderBy(asc(inboundEvents.receivedAt));
  return rows.map((r) => r.id);
}

export async function countInboundEventsByStatus(
  db: DbOrTx,
  params: { connectionId: string; since: Date }
) {
  return await db
    .select({ status: inboundEvents.status, n: count() })
    .from(inboundEvents)
    .where(
      and(
        eq(inboundEvents.connectionId, params.connectionId),
        gte(inboundEvents.receivedAt, params.since)
      )
    )
    .groupBy(inboundEvents.status);
}

export async function listInboundOutcomes(
  db: DbOrTx,
  params: { connectionId: string; since: Date; limit: number }
) {
  const rows = await db
    .select({ outcome: inboundEvents.outcome })
    .from(inboundEvents)
    .where(
      and(
        eq(inboundEvents.connectionId, params.connectionId),
        gte(inboundEvents.receivedAt, params.since)
      )
    )
    .limit(params.limit);
  return rows.map((r) => r.outcome);
}

export async function listInboundFailures(
  db: DbOrTx,
  params: { connectionId: string; limit: number }
) {
  return await db
    .select({
      at: inboundEvents.receivedAt,
      error: inboundEvents.error,
      eventType: inboundEvents.eventType,
    })
    .from(inboundEvents)
    .where(
      and(
        eq(inboundEvents.connectionId, params.connectionId),
        eq(inboundEvents.status, "failed")
      )
    )
    .orderBy(desc(inboundEvents.receivedAt))
    .limit(params.limit);
}

// One connection and a bounded batch per call: each delete is then a short range on
// (connection_id, received_at) that holds few locks and doesn't keep autovacuum waiting. Pending
// deliveries stay, because the queue hasn't processed them yet.
export async function deleteFinishedDeliveries(
  db: DbOrTx,
  params: { connectionId: string; before: Date; limit: number }
) {
  const batch = db
    .select({ id: inboundEvents.id })
    .from(inboundEvents)
    .where(
      and(
        eq(inboundEvents.connectionId, params.connectionId),
        lt(inboundEvents.receivedAt, params.before),
        inArray(inboundEvents.status, ["processed", "ignored", "failed"])
      )
    )
    .limit(params.limit);
  const deleted = await db
    .delete(inboundEvents)
    .where(inArray(inboundEvents.id, batch))
    .returning({ id: inboundEvents.id });
  return deleted.length;
}
