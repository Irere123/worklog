import { getConnector } from "#connectors";
import type {
  ConnectionView,
  Connector,
  InboundRequest,
  Received,
} from "#connectors/types";
import type { AppContext } from "#context";
import { findConnectionById } from "#db/queries/connections";
import type { ConnectionRow } from "#db/queries/connections";
import {
  findInboundEventByDelivery,
  insertInboundEventWithJob,
  listStrandedLanes,
  requeueInboundEvent,
} from "#db/queries/inbound-events";
import type { InboundEvent } from "#db/queries/inbound-events";
import { addJob, unlockStaleJobs } from "#db/queries/jobs";
import { transact } from "#db/transact";
import { newJob } from "#jobs/queue";
import { generateId } from "#lib/ids";

import { queueFollowUp } from "./follow-up";
import { laneOf, laneQueue } from "./lanes";
import { viewOf } from "./view";

export type Reply = { status: number; body: unknown };

export type Delivery = Pick<
  InboundEvent,
  "deliveryId" | "eventType" | "payload" | "receivedAt" | "via" | "partitionKey"
>;

/** The per-connection endpoint, for webhooks configured by hand with the connection's own secret. */
export async function receive(
  ctx: AppContext,
  connectionId: string,
  req: InboundRequest
): Promise<Reply> {
  const conn = await findConnectionById(ctx.db, { id: connectionId });
  const connector = conn ? getConnector(conn.provider) : undefined;
  if (!conn || !connector) {
    return { status: 404, body: { error: "unknown connection" } };
  }
  const view = viewOf(ctx, conn);
  const received = await connector.receive(req, view);
  if (received.type === "reject") {
    ctx.tally.rejected(conn.id, req.receivedAt, received.error);
    return { status: received.status, body: { error: received.error } };
  }
  return await accept(ctx, { connector, conn, view }, req, received, "webhook");
}

/** What happens to a verified request, whichever endpoint it came in on. */
export async function accept(
  ctx: AppContext,
  to: { connector: Connector; conn: ConnectionRow; view: ConnectionView },
  req: InboundRequest,
  received: Exclude<Received, { type: "reject" }>,
  via: "webhook" | "app"
): Promise<Reply> {
  const { connector, conn, view } = to;
  if (received.type === "respond") {
    return { status: received.status ?? 200, body: received.body };
  }
  // A command is someone asking, not something to record: a pause doesn't silence it.
  const answers =
    received.type === "interaction" &&
    (conn.status === "active" || conn.status === "paused");
  if (conn.status !== "active" && !answers) {
    // Acknowledged, so the tool doesn't give up on the hook, and dropped: a connection that isn't
    // active records nothing.
    const message = `Worklog's connection here is ${conn.status}; an admin can reconnect it.`;
    return {
      status: 200,
      body:
        received.type === "interaction" && connector.unavailable
          ? connector.unavailable(message)
          : { ok: true, ignored: `connection is ${conn.status}` },
    };
  }
  if (received.type === "interaction") {
    if (!connector.interact) {
      throw new Error(
        `The ${connector.id} connector received an interaction but can't answer it`
      );
    }
    const answered = await connector.interact(
      ctx,
      view,
      received.payload,
      req.channel
    );
    if (answered.later) {
      await queueFollowUp(ctx, view, answered.later.payload, {
        once: answered.later.once,
      });
    }
    return { status: 200, body: answered.body };
  }
  const stored = await store(ctx, conn, {
    deliveryId: received.deliveryId,
    eventType: received.eventType,
    payload: received.payload,
    receivedAt: req.receivedAt,
    via,
    partitionKey: received.partition ?? "",
  });
  ctx.tally.received(conn.id, req.receivedAt);
  return stored
    ? { status: 200, body: { ok: true } }
    : { status: 200, body: { ok: true, duplicate: true } };
}

export async function receivePushed(
  ctx: AppContext,
  conn: ConnectionRow,
  deliveryId: string,
  events: unknown[]
) {
  const stored = await store(ctx, conn, {
    deliveryId,
    eventType: "worklog.events",
    payload: { events },
    receivedAt: ctx.now(),
    via: "push",
    partitionKey: "",
  });
  ctx.tally.received(conn.id, ctx.now());
  if (!stored) {
    return { duplicate: true };
  }
  return { duplicate: false, inboundEventId: stored };
}

/**
 * The delivery and its job commit together. Stored without a job, a delivery would never be
 * processed: the provider's retry is a duplicate and gets a 200. Null for a duplicate.
 */
export async function store(
  ctx: AppContext,
  conn: Pick<ConnectionRow, "id" | "workspaceId">,
  delivery: Delivery
): Promise<string | null> {
  const lane = laneOf(delivery.partitionKey);
  const row = await insertInboundEventWithJob(ctx.db, {
    row: {
      id: generateId(),
      workspaceId: conn.workspaceId,
      connectionId: conn.id,
      lane,
      ...delivery,
      payload: storable(delivery.payload),
    },
    job: drainJob(conn.id, lane),
  });
  if (row) {
    return row.id;
  }
  return await transact(ctx, async (tx) => {
    // A redelivery of one that failed gets another go, even after it used up its attempts.
    const existing = await findInboundEventByDelivery(tx.db, {
      connectionId: conn.id,
      deliveryId: delivery.deliveryId,
    });
    if (existing?.status === "failed") {
      await requeueInboundEvent(tx.db, { id: existing.id });
      await enqueueDrain(tx, conn.id, existing.lane);
    }
    return null;
  });
}

// Postgres can't keep U+0000 in jsonb, and the provider would send the delivery again on every
// retry. Rare, so the payload is only walked when its JSON has one.
function storable(payload: unknown) {
  return JSON.stringify(payload).includes(String.raw`\u0000`)
    ? withoutNul(payload)
    : payload;
}

function withoutNul(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replaceAll("\u0000", "");
  }
  if (Array.isArray(value)) {
    return value.map(withoutNul);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k.replaceAll("\u0000", ""),
        withoutNul(v),
      ])
    );
  }
  return value;
}

/**
 * One job drains a lane: every delivery waiting in it, in order, live ones before history. A lane
 * with a drain already waiting gets no second one (the key), and two never run at once (the
 * queue). A retry is its own job, due later, so it can't push back the drain for new deliveries.
 */
export async function enqueueDrain(
  ctx: AppContext,
  connectionId: string,
  lane: number,
  runAt?: Date,
  why: "retry" | "stuck" = "retry"
) {
  await addJob(ctx.db, drainJob(connectionId, lane, runAt, why));
}

/** A minute, to stay clear of drains that are merely busy. */
const STRANDED_MS = 60_000;
/** A drain hands over after about 20 seconds; one locked this long has lost its worker. */
const DEAD_DRAIN_MS = 5 * 60_000;

/**
 * Queues a drain for every lane holding a delivery left waiting, so nothing waits much longer
 * than a minute or two for one. Queuing a lane's drain can lose a race with that drain starting
 * (Graphile Worker checks the job, then updates it, in two statements), and a worker can die
 * mid-drain, holding its lane until its drain is unlocked here to run again.
 */
export async function drainStranded(ctx: AppContext) {
  await unlockStaleJobs(ctx.db, {
    task: "ingest:lane",
    olderThanMs: DEAD_DRAIN_MS,
  });
  const lanes = await listStrandedLanes(ctx.db, {
    olderThanMs: STRANDED_MS,
    limit: 1000,
  });
  for (const { connectionId, lane } of lanes) {
    await enqueueDrain(ctx, connectionId, lane);
  }
  return lanes.length;
}

function drainJob(
  connectionId: string,
  lane: number,
  runAt?: Date,
  why: "retry" | "stuck" = "retry"
) {
  // Each reason its own job: one can't move another's time.
  const key = `${runAt ? why : "lane"}:${connectionId}:${lane}`;
  return {
    ...newJob(
      "ingest:lane",
      { connectionId, lane },
      { queue: laneQueue(connectionId, lane), key, runAt }
    ),
    key,
  };
}
