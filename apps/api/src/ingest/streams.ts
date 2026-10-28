import { setTimeout as sleep } from "node:timers/promises";

import { listConnectors } from "#connectors";
import type {
  AppView,
  Connector,
  StreamSpec,
  Streamed,
} from "#connectors/types";
import type { AppContext } from "#context";
import { tryHoldLock } from "#db/locks";
import { findConnectionByExternalId } from "#db/queries/connections";

import { loadApp } from "./apps";
import { applyChange } from "./lifecycle";
import { store } from "./pipeline";

// Any fixed numbers work, as long as every Worklog process uses the same ones.
const LOCK_BASE = 4_243_961_000;
const WAIT_FOR_LOCK_MS = 30_000;
const WAIT_FOR_APP_MS = 60_000;
const REFUSED_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 60_000;
const WATCH_LOCK_MS = 15_000;

async function pause(ms: number, signal: AbortSignal) {
  try {
    await sleep(ms, undefined, { signal });
  } catch {
    // Aborted: stopping.
  }
}

/** What a stream hands over goes where a webhook would: the inbox, or the connection itself. */
export async function acceptStreamed(
  ctx: AppContext,
  provider: string,
  item: Streamed
) {
  const conn = await findConnectionByExternalId(ctx.db, {
    provider,
    externalId: item.externalId,
  });
  if (!conn) {
    ctx.tally.unrouted(provider, ctx.now());
    return;
  }
  if (item.type === "change") {
    await applyChange(ctx, conn, item.change);
    return;
  }
  if (conn.status !== "active") {
    return;
  }
  await store(ctx, conn, {
    deliveryId: item.deliveryId,
    eventType: item.eventType,
    payload: item.payload,
    receivedAt: ctx.now(),
    via: "app",
    partitionKey: item.partition,
  });
  ctx.tally.received(conn.id, ctx.now());
}

/**
 * One run of the socket. The lock dies with its connection, and then another process may open a
 * second socket: this one stops when it can't see its lock any more. True when that happened.
 */
async function runWatched(
  ctx: AppContext,
  provider: string,
  stream: StreamSpec,
  app: AppView,
  held: { alive: () => Promise<boolean> },
  opts: { signal: AbortSignal; state: Record<string, unknown> }
) {
  const run = new AbortController();
  let lost = false;
  const stop = () => {
    run.abort();
  };
  opts.signal.addEventListener("abort", stop, { once: true });
  const watch = setInterval(() => {
    void held.alive().then((ok) => {
      if (!ok) {
        lost = true;
        run.abort();
      }
      return ok;
    });
  }, WATCH_LOCK_MS);
  try {
    await stream.run(
      ctx,
      app,
      async (item) => {
        await acceptStreamed(ctx, provider, item);
      },
      { signal: run.signal, state: opts.state }
    );
  } catch (error) {
    console.error(`[stream] ${provider} dropped`, error);
  } finally {
    clearInterval(watch);
    opts.signal.removeEventListener("abort", stop);
  }
  return lost;
}

async function holdOpen(
  ctx: AppContext,
  connector: Connector,
  lock: number,
  signal: AbortSignal
) {
  const stream = connector.app?.stream;
  if (!stream) {
    return;
  }
  const state: Record<string, unknown> = {};
  while (!signal.aborted) {
    const held = await tryHoldLock(ctx.pool, lock).catch((error: unknown) => {
      console.error(`[stream] ${connector.id}: can't take the lock`, error);
      return null;
    });
    if (!held) {
      await pause(WAIT_FOR_LOCK_MS, signal);
      continue;
    }
    try {
      let backoff = 1000;
      while (!signal.aborted) {
        const app = await loadApp(ctx, connector.id);
        if (!app) {
          await pause(WAIT_FOR_APP_MS, signal);
          continue;
        }
        const started = Date.now();
        const lost = await runWatched(ctx, connector.id, stream, app, held, {
          signal,
          state,
        });
        if (lost) {
          console.error(
            `[stream] ${connector.id}: lost its lock; taking it again`
          );
          break;
        }
        if (typeof state.refused === "string") {
          console.error(`[stream] ${connector.id}: ${state.refused}`);
          state.refused = undefined;
          await pause(REFUSED_MS, signal);
          continue;
        }
        // A connection that lasted resets the backoff; one that keeps failing waits longer.
        backoff =
          Date.now() - started > MAX_BACKOFF_MS
            ? 1000
            : Math.min(backoff * 2, MAX_BACKOFF_MS);
        await pause(backoff, signal);
      }
    } finally {
      await held.release();
    }
  }
}

/**
 * Keeps each app's socket open (Discord's Gateway) in exactly one process: whichever takes its
 * lock. Another takes over within half a minute if that one goes. Returns the function that stops.
 */
export function startStreams(ctx: AppContext) {
  const controller = new AbortController();
  const running = listConnectors()
    .filter((c) => c.app?.stream)
    .map(async (c, i) => {
      await holdOpen(ctx, c, LOCK_BASE + i, controller.signal);
    });
  return async () => {
    controller.abort();
    await Promise.all(running);
  };
}
