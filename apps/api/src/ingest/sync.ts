import { getConnector, listConnectors } from "#connectors";
import { ProviderError } from "#connectors/http";
import type { Connector } from "#connectors/types";
import type { AppContext } from "#context";
import {
  findConnectionCursor,
  upsertConnectionCursor,
} from "#db/queries/connection-cursors";
import {
  findConnectionById,
  listActiveConnectionsByProvider,
} from "#db/queries/connections";
import { transact } from "#db/transact";
import { enqueue } from "#jobs/queue";
import { shortHash } from "#lib/crypto";
import { DAY_MS } from "#lib/time";

import { loadApp } from "./apps";
import { queueHooks } from "./hooks";
import { handleProviderError } from "./lifecycle";
import { store } from "./pipeline";
import { queueSync, syncQueue } from "./sync-queue";
import { viewOf } from "./view";

/** Where listing what to sync (an installation's repos) records how it went. */
const LISTING = "*";

// The same page read twice is one delivery: the inbox drops the second.
const digest = (payload: unknown) => shortHash(JSON.stringify(payload));

/** Pages one job reads before handing over, so a long backfill doesn't hold a worker. */
const PAGES_PER_RUN = 10;

async function syncable(ctx: AppContext, connectionId: string) {
  const conn = await findConnectionById(ctx.db, { id: connectionId });
  const connector = conn ? getConnector(conn.provider) : undefined;
  if (!conn || conn.status !== "active" || !connector?.sync) {
    return null;
  }
  const view = viewOf(ctx, conn);
  const app = connector.app ? await loadApp(ctx, conn.provider) : null;
  if (!connector.sync.available(view, app)) {
    return null;
  }
  return { conn, view, app, sync: connector.sync };
}

export async function syncConnection(
  ctx: AppContext,
  connectionId: string,
  streams: string[] | null
) {
  const target = await syncable(ctx, connectionId);
  if (!target) {
    return;
  }
  let names: string[];
  try {
    names =
      streams ?? (await target.sync.streams(ctx, target.view, target.app));
  } catch (error) {
    await failed(ctx, connectionId, LISTING, error);
    return;
  }
  if (!streams) {
    await upsertConnectionCursor(ctx.db, {
      connectionId,
      stream: LISTING,
      state: "idle",
      error: null,
      syncedAt: ctx.now(),
      now: ctx.now(),
    });
  }
  const { wants } = target.sync;
  for (const stream of names) {
    if (!wants || wants(target.view, stream)) {
      await enqueueStream(ctx, connectionId, stream);
    }
  }
}

async function enqueueStream(
  ctx: AppContext,
  connectionId: string,
  stream: string,
  runAt?: Date
) {
  await enqueue(
    ctx,
    "sync:stream",
    { connectionId, stream },
    {
      queue: syncQueue(connectionId),
      key: `sync:${connectionId}:${stream}`,
      maxAttempts: 5,
      // Workers drain what's already stored before reading more history.
      priority: 10,
      runAt,
    }
  );
}

/**
 * Reads up to PAGES_PER_RUN pages of one stream. Each page goes into the inbox with the cursor
 * that follows it, in one transaction: a crash resumes after the last stored page, and the ledger
 * makes the overlap with webhooks harmless.
 */
export async function syncStream(
  ctx: AppContext,
  connectionId: string,
  stream: string
) {
  const target = await syncable(ctx, connectionId);
  if (!target) {
    return;
  }
  const { conn, view, app, sync } = target;
  const window = {
    since: new Date(ctx.now().getTime() - ctx.config.BACKFILL_DAYS * DAY_MS),
  };
  const saved = await findConnectionCursor(ctx.db, { connectionId, stream });
  let cursor = saved?.cursor ?? {};
  try {
    for (let page = 0; page < PAGES_PER_RUN; page += 1) {
      const read = await sync.read(ctx, view, app, stream, cursor, window);
      await transact(ctx, async (tx) => {
        if (read.page) {
          await store(tx, conn, {
            deliveryId: `sync:${stream}:${digest(read.page.payload)}`,
            eventType: read.page.eventType,
            payload: read.page.payload,
            receivedAt: tx.now(),
            via: "sync",
            partitionKey: read.page.partition,
          });
        }
        await upsertConnectionCursor(tx.db, {
          connectionId,
          stream,
          cursor: read.cursor,
          state: read.done ? "idle" : "running",
          error: null,
          syncedAt: read.done ? tx.now() : undefined,
          now: tx.now(),
        });
      });
      ({ cursor } = read);
      if (read.done) {
        return;
      }
    }
    await enqueueStream(ctx, connectionId, stream);
  } catch (error) {
    await failed(ctx, connectionId, stream, error);
  }
}

async function failed(
  ctx: AppContext,
  connectionId: string,
  stream: string,
  error: unknown
) {
  const message = error instanceof Error ? error.message : String(error);
  const limited =
    error instanceof ProviderError && error.kind === "rate_limited";
  await upsertConnectionCursor(ctx.db, {
    connectionId,
    stream,
    state: limited ? "running" : "failed",
    error: message,
    now: ctx.now(),
  });
  const retryAt = limited ? error.retryAt : null;
  if (retryAt && stream !== LISTING) {
    await enqueueStream(ctx, connectionId, stream, retryAt);
    return;
  }
  if (await handleProviderError(ctx, connectionId, error)) {
    return;
  }
  throw error;
}

/**
 * Daily, every connection that can read its history catches up from its cursors: whatever
 * webhooks missed while the server was down, or the provider gave up retrying, comes in here.
 */
export async function reconcileAll(ctx: AppContext) {
  const connectors = listConnectors().filter(
    (c: Connector) => c.sync ?? c.hooks
  );
  const conns = await listActiveConnectionsByProvider(ctx.db, {
    providers: connectors.map((c) => c.id),
  });
  for (const conn of conns) {
    const connector = connectors.find((c) => c.id === conn.provider);
    if (connector?.sync) {
      await queueSync(ctx, conn);
    }
    // A forge disables a hook that keeps failing; this turns it back on.
    if (connector?.hooks) {
      await queueHooks(ctx, conn);
    }
  }
  return conns.length;
}
