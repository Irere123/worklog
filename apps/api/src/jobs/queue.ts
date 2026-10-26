import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import { jobs } from "../db/schema";

export type Job = typeof jobs.$inferSelect;
export type JobHandler = (ctx: AppContext, payload: Record<string, unknown>) => Promise<void>;

const handlers = new Map<string, JobHandler>();
const LOCK_MS = 5 * 60_000;

/**
 * A minimal durable queue on Postgres: `FOR UPDATE SKIP LOCKED` lets any number of workers claim jobs
 * without stepping on each other; stuck jobs are reclaimed after their lock expires; failures retry
 * with exponential backoff and end up "dead" (inspectable, replayable) after maxAttempts.
 * Works the same on PGlite, so tests exercise the real thing.
 */
export function registerJob(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

export async function enqueue(
  ctx: AppContext,
  type: string,
  payload: Record<string, unknown>,
  opts: { runAt?: Date; maxAttempts?: number; orderingKey?: string } = {},
) {
  const [row] = await ctx.db
    .insert(jobs)
    .values({ type, payload, orderingKey: opts.orderingKey ?? null, runAt: opts.runAt ?? ctx.now(), maxAttempts: opts.maxAttempts ?? 5 })
    .returning({ id: jobs.id });
  return row!.id;
}

async function claim(ctx: AppContext, limit: number): Promise<Job[]> {
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const nowSql = sql`${now.toISOString()}::timestamptz`;
    const due = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          or(and(eq(jobs.status, "queued"), sql`${jobs.runAt} <= ${nowSql}`), and(eq(jobs.status, "running"), lt(jobs.lockedUntil, now))),
          // Ordered jobs: only the oldest unfinished job per key is eligible, and only if none is running.
          sql`(${jobs.orderingKey} is null or ${jobs.id} = (
            select min(j2.id) from jobs j2
            where j2.ordering_key = ${jobs.orderingKey} and j2.status in ('queued', 'running')
          ) and not exists (
            select 1 from jobs j3
            where j3.ordering_key = ${jobs.orderingKey} and j3.status = 'running' and j3.locked_until > ${nowSql} and j3.id <> ${jobs.id}
          ))`,
        ),
      )
      .orderBy(jobs.id)
      .limit(limit)
      .for("update", { skipLocked: true });
    if (!due.length) return [];
    return tx
      .update(jobs)
      .set({ status: "running", attempts: sql`${jobs.attempts} + 1`, lockedUntil: new Date(now.getTime() + LOCK_MS) })
      .where(inArray(jobs.id, due.map((d) => d.id)))
      .returning();
  });
}

/** Only the worker holding this attempt may settle it (a reclaimed job belongs to its new holder). */
async function settle(ctx: AppContext, job: Job, error?: unknown) {
  const mine = and(eq(jobs.id, job.id), eq(jobs.attempts, job.attempts), eq(jobs.status, "running"));
  if (!error) {
    await ctx.db.delete(jobs).where(mine);
    return;
  }
  const dead = job.attempts >= job.maxAttempts;
  // Exponential backoff with ±20% jitter, so a provider outage doesn't retry in lockstep.
  const backoffMs = Math.min(10_000 * 2 ** (job.attempts - 1), 60 * 60_000) * (0.8 + Math.random() * 0.4);
  await ctx.db
    .update(jobs)
    .set({
      status: dead ? "dead" : "queued",
      runAt: new Date(ctx.now().getTime() + backoffMs),
      lockedUntil: null,
      lastError: error instanceof Error ? `${error.message}\n${error.stack ?? ""}`.slice(0, 4000) : String(error),
    })
    .where(mine);
}

/** Runs due jobs until none are left (or the budget runs out). Returns how many ran. */
export async function drainQueue(ctx: AppContext, opts: { batch?: number; budgetMs?: number } = {}) {
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);
  let ran = 0;
  while (Date.now() < deadline) {
    const batch = await claim(ctx, opts.batch ?? 20);
    if (!batch.length) break;
    for (const job of batch) {
      const handler = handlers.get(job.type);
      try {
        if (!handler) throw new Error(`No handler for job type ${job.type}`);
        await handler(ctx, job.payload);
        await settle(ctx, job);
      } catch (err) {
        console.error(`[queue] ${job.type} #${job.id} failed (attempt ${job.attempts}/${job.maxAttempts})`, err);
        await settle(ctx, job, err);
      }
      ran++;
    }
  }
  return ran;
}

export async function queueStats(ctx: AppContext) {
  const rows = await ctx.db
    .select({ status: jobs.status, n: sql<number>`count(*)::int`, oldest: sql<string | null>`min(${jobs.runAt})` })
    .from(jobs)
    .groupBy(jobs.status);
  return Object.fromEntries(rows.map((r) => [r.status, { count: Number(r.n), oldest: r.oldest }]));
}
