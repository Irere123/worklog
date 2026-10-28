import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";

import type { DbOrTx } from "#db";
import { addJobCall } from "#db/queries/jobs";
import type { NewJob } from "#db/queries/jobs";
import { inboundEvents } from "#db/schema";

export type InboundEvent = typeof inboundEvents.$inferSelect;

/**
 * The delivery and the job that processes it, in one statement: both commit or neither does,
 * without the round trips of a transaction around them. Undefined for a redelivery.
 *
 * When the job's key already names one waiting to start, adding it again would change nothing,
 * but it would still NOTIFY, and Postgres commits notifying transactions one at a time, waiting
 * for the disk each time: under a burst that, not the work, sets how fast webhooks are taken. So
 * the waiting job is locked instead, until this commits; Graphile Worker skips locked jobs, so it
 * can't start and miss this delivery. A job that already started, or is backing off after a
 * failure, gets the job added as usual.
 */
export async function insertInboundEventWithJob(
  db: DbOrTx,
  params: {
    row: typeof inboundEvents.$inferInsert;
    job: NewJob & { key: string };
  }
) {
  const insert = db
    .insert(inboundEvents)
    .values(params.row)
    .onConflictDoNothing()
    .returning({ id: inboundEvents.id });
  const result = await db.execute<{ id: string }>(sql`
    with stored as (${insert.getSQL()}),
    waiting as (
      select 1 from graphile_worker._private_jobs
      where key = ${params.job.key} and locked_at is null and attempts = 0
      for update
    )
    select stored.id,
      case when exists (select 1 from waiting) then null else ${addJobCall(params.job)} end
    from stored`);
  return result.rows[0];
}

export async function findInboundEventById(db: DbOrTx, params: { id: string }) {
  const [row] = await db
    .select()
    .from(inboundEvents)
    .where(eq(inboundEvents.id, params.id));
  return row;
}

export async function findInboundEventByDelivery(
  db: DbOrTx,
  params: { connectionId: string; deliveryId: string }
) {
  const [row] = await db
    .select({
      id: inboundEvents.id,
      status: inboundEvents.status,
      lane: inboundEvents.lane,
    })
    .from(inboundEvents)
    .where(
      and(
        eq(inboundEvents.connectionId, params.connectionId),
        eq(inboundEvents.deliveryId, params.deliveryId)
      )
    );
  return row;
}

/**
 * What a lane's drain takes next, oldest first: new deliveries, and failed ones due another try.
 * Live deliveries go before pages read back by a sync, so history never holds up what just
 * happened.
 */
export async function listWaitingDeliveries(
  db: DbOrTx,
  params: { connectionId: string; lane: number; limit: number }
) {
  return await db
    .select()
    .from(inboundEvents)
    .where(
      and(
        eq(inboundEvents.connectionId, params.connectionId),
        eq(inboundEvents.lane, params.lane),
        or(
          eq(inboundEvents.status, "pending"),
          // The database's clock, which also decides when the retry's job runs.
          and(
            eq(inboundEvents.status, "failed"),
            isNotNull(inboundEvents.retryAt),
            sql`${inboundEvents.retryAt} <= now()`
          )
        )
      )
    )
    .orderBy(
      sql`${inboundEvents.via} = 'sync'`,
      asc(inboundEvents.receivedAt),
      asc(inboundEvents.id)
    )
    .limit(params.limit);
}

/**
 * Lanes holding a delivery left waiting longer than it should: pending well after it arrived, or
 * failed and well past its retry. Their drain was lost (a race in queuing it, a worker that died).
 * On the database's clock, like the retries.
 */
export async function listStrandedLanes(
  db: DbOrTx,
  params: { olderThanMs: number; limit: number }
) {
  const before = sql`now() - make_interval(secs => ${params.olderThanMs / 1000})`;
  return await db
    .selectDistinct({
      connectionId: inboundEvents.connectionId,
      lane: inboundEvents.lane,
    })
    .from(inboundEvents)
    .where(
      or(
        and(
          eq(inboundEvents.status, "pending"),
          sql`${inboundEvents.receivedAt} < ${before}`
        ),
        and(
          eq(inboundEvents.status, "failed"),
          isNotNull(inboundEvents.retryAt),
          sql`${inboundEvents.retryAt} < ${before}`
        )
      )
    )
    .limit(params.limit);
}

// A live delivery waiting in the lane, so history can step aside for it.
export async function findLiveWaiting(
  db: DbOrTx,
  params: { connectionId: string; lane: number }
) {
  const [row] = await db
    .select({ id: inboundEvents.id })
    .from(inboundEvents)
    .where(
      and(
        eq(inboundEvents.connectionId, params.connectionId),
        eq(inboundEvents.lane, params.lane),
        eq(inboundEvents.status, "pending"),
        sql`${inboundEvents.via} <> 'sync'`
      )
    )
    .limit(1);
  return row;
}

// The next failed delivery in the lane due another try, if any.
export async function findNextRetryAt(
  db: DbOrTx,
  params: { connectionId: string; lane: number }
) {
  const [row] = await db
    .select({ at: inboundEvents.retryAt })
    .from(inboundEvents)
    .where(
      and(
        eq(inboundEvents.connectionId, params.connectionId),
        eq(inboundEvents.lane, params.lane),
        eq(inboundEvents.status, "failed"),
        isNotNull(inboundEvents.retryAt)
      )
    )
    .orderBy(asc(inboundEvents.retryAt))
    .limit(1);
  return row?.at ?? null;
}

// A redelivery of one that failed for good: back in line, with its attempts kept for the record.
// Only one that failed: a retry may have just succeeded.
export async function requeueInboundEvent(db: DbOrTx, params: { id: string }) {
  await db
    .update(inboundEvents)
    .set({ status: "pending", retryAt: null })
    .where(
      and(eq(inboundEvents.id, params.id), eq(inboundEvents.status, "failed"))
    );
}

/**
 * Of these deliveries, the ones still waiting, locked until the transaction ends, so whatever else
 * might process one (a job queued before lanes) waits and then finds it done.
 */
export async function lockWaitingDeliveries(
  db: DbOrTx,
  params: { ids: string[] }
) {
  const rows = await db
    .select({ id: inboundEvents.id })
    .from(inboundEvents)
    .where(
      and(
        inArray(inboundEvents.id, params.ids),
        inArray(inboundEvents.status, ["pending", "failed"])
      )
    )
    .orderBy(asc(inboundEvents.id))
    .for("update");
  return new Set(rows.map((r) => r.id));
}

// Counts the attempt, whether it succeeded or failed. `retryInMs` sets when a failed one is tried
// again, on the database's clock, which is also the one its job and the drain go by.
export async function updateInboundAttempt(
  db: DbOrTx,
  params: {
    id: string;
    set: Partial<
      Pick<
        InboundEvent,
        "status" | "outcome" | "error" | "retryAt" | "processedAt"
      >
    >;
    retryInMs?: number | null;
  }
) {
  const retry =
    params.retryInMs === undefined
      ? {}
      : {
          retryAt:
            params.retryInMs === null
              ? null
              : sql`now() + make_interval(secs => ${params.retryInMs / 1000})`,
        };
  await db
    .update(inboundEvents)
    .set({
      ...params.set,
      ...retry,
      attempts: sql`${inboundEvents.attempts} + 1`,
    })
    .where(eq(inboundEvents.id, params.id));
}

/** Deliveries processed together in one transaction, marked done in one write. */
export async function updateInboundOutcomes(
  db: DbOrTx,
  params: {
    rows: {
      id: string;
      status: "processed" | "ignored";
      outcome: Record<string, unknown>;
    }[];
    now: Date;
  }
) {
  if (params.rows.length === 0) {
    return;
  }
  const values = sql.join(
    params.rows.map(
      (r) =>
        sql`(${r.id}::text, ${r.status}::text, ${JSON.stringify(r.outcome)}::jsonb)`
    ),
    sql`, `
  );
  await db.execute(sql`
    update inbound_events as i set
      status = v.status,
      outcome = v.outcome,
      error = null,
      retry_at = null,
      attempts = i.attempts + 1,
      processed_at = ${params.now}
    from (values ${values}) as v(id, status, outcome)
    where i.id = v.id
  `);
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
  params: {
    workspaceId: string;
    connectionId: string;
    lane: number;
    since?: Date;
    until: Date;
  }
) {
  const rows = await db
    .select({ id: inboundEvents.id })
    .from(inboundEvents)
    .where(
      and(
        eq(inboundEvents.connectionId, params.connectionId),
        eq(inboundEvents.workspaceId, params.workspaceId),
        eq(inboundEvents.lane, params.lane),
        // Pending and failed ones are still the drain's: replayed, their effects would be lost.
        inArray(inboundEvents.status, ["processed", "ignored"]),
        params.since ? gte(inboundEvents.receivedAt, params.since) : undefined,
        lte(inboundEvents.receivedAt, params.until)
      )
    )
    .orderBy(asc(inboundEvents.receivedAt), asc(inboundEvents.id));
  return rows.map((r) => r.id);
}

export async function listInboundLanes(
  db: DbOrTx,
  params: { connectionId: string; since?: Date }
) {
  const rows = await db
    .selectDistinct({ lane: inboundEvents.lane })
    .from(inboundEvents)
    .where(
      and(
        eq(inboundEvents.connectionId, params.connectionId),
        params.since ? gte(inboundEvents.receivedAt, params.since) : undefined
      )
    );
  return rows.map((r) => r.lane);
}

export async function countPendingInboundEvents(
  db: DbOrTx,
  params: { connectionId: string }
) {
  const [row] = await db
    .select({
      n: count(),
      oldest: sql<Date | null>`min(${inboundEvents.receivedAt})`.mapWith(
        (v: string | null) => (v ? new Date(v) : null)
      ),
    })
    .from(inboundEvents)
    .where(
      and(
        eq(inboundEvents.connectionId, params.connectionId),
        eq(inboundEvents.status, "pending")
      )
    );
  return { n: row?.n ?? 0, oldest: row?.oldest ?? null };
}

// How long deliveries waited to be processed, over the most recent ones.
export async function listInboundLags(
  db: DbOrTx,
  params: { connectionId: string; since: Date; limit: number }
) {
  const rows = await db
    .select({
      ms: sql<number>`extract(epoch from (${inboundEvents.processedAt} - ${inboundEvents.receivedAt})) * 1000`.mapWith(
        Number
      ),
    })
    .from(inboundEvents)
    .where(
      and(
        eq(inboundEvents.connectionId, params.connectionId),
        gte(inboundEvents.receivedAt, params.since),
        sql`${inboundEvents.processedAt} is not null`
      )
    )
    .orderBy(desc(inboundEvents.receivedAt))
    .limit(params.limit);
  return rows.map((r) => r.ms);
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

export async function countInboundEventsBetween(
  db: DbOrTx,
  params: { connectionId: string; since: Date; until: Date }
) {
  const [row] = await db
    .select({ n: count() })
    .from(inboundEvents)
    .where(
      and(
        eq(inboundEvents.connectionId, params.connectionId),
        gte(inboundEvents.receivedAt, params.since),
        lt(inboundEvents.receivedAt, params.until)
      )
    );
  return row?.n ?? 0;
}

// The most recent ones, so a busy connection's health reflects what it does now.
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
    .orderBy(desc(inboundEvents.receivedAt))
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
