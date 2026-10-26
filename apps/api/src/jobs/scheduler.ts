import { and, eq, lt, or } from "drizzle-orm";
import { runDueAutomations } from "../automations/service";
import { nudgeDrifting, sweepEntropy } from "../board/service";
import type { AppContext } from "../context";
import { leases } from "../db/schema";
import { DAY_MS } from "../lib/time";
import { drainQueue } from "./queue";
import "../ingest/pipeline"; // registers the ingestion jobs

const LEASE = "scheduler";
const LEASE_MS = 3 * 60_000;
const HOUR_MS = 60 * 60_000;

/** Take or renew the scheduler lease. Only the holder runs jobs. */
async function acquireLease(ctx: AppContext, holder: string): Promise<boolean> {
  const now = ctx.now();
  const expiresAt = new Date(now.getTime() + LEASE_MS);
  await ctx.db.insert(leases).values({ name: LEASE, holder, expiresAt }).onConflictDoNothing();
  const rows = await ctx.db
    .update(leases)
    .set({ holder, expiresAt })
    .where(and(eq(leases.name, LEASE), or(eq(leases.holder, holder), lt(leases.expiresAt, now))))
    .returning();
  return rows.length > 0;
}

export type SchedulerTick = { automations: number; postponed: number; nudged: number };

/** One pass: due automations, plus hourly entropy and daily event-log pruning. */
export async function tick(ctx: AppContext, state = { lastEntropy: 0, lastPrune: 0 }): Promise<SchedulerTick> {
  const now = ctx.now().getTime();
  const ran = await runDueAutomations(ctx);
  let postponed = 0;
  let nudged = 0;
  if (now - state.lastEntropy >= HOUR_MS) {
    postponed = await sweepEntropy(ctx);
    nudged = await nudgeDrifting(ctx);
    state.lastEntropy = now;
  }
  if (now - state.lastPrune >= DAY_MS) {
    await ctx.bus.prune(new Date(now - 7 * DAY_MS));
    state.lastPrune = now;
  }
  return { automations: ran.length, postponed, nudged };
}

export function startScheduler(ctx: AppContext, intervalMs = 60_000) {
  const holder = `${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const state = { lastEntropy: 0, lastPrune: 0 };
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      if (await acquireLease(ctx, holder)) {
        const result = await tick(ctx, state);
        if (result.automations || result.postponed) console.log(`[scheduler] ran ${result.automations} automation(s), postponed ${result.postponed} card(s)`);
      }
    } catch (err) {
      console.error("[scheduler] tick failed", err);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(run, intervalMs);
  void run();

  // The job queue (ingestion) runs on its own fast loop, and wakes immediately when work arrives.
  let draining = false;
  const drain = async () => {
    if (draining) return;
    draining = true;
    try {
      await drainQueue(ctx);
    } catch (err) {
      console.error("[queue] drain failed", err);
    } finally {
      draining = false;
    }
  };
  ctx.kickQueue = () => void drain();
  const queueTimer = setInterval(drain, 2_000);

  return async () => {
    clearInterval(timer);
    clearInterval(queueTimer);
    ctx.kickQueue = undefined;
    await ctx.db.delete(leases).where(and(eq(leases.name, LEASE), eq(leases.holder, holder)));
  };
}

