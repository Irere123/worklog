import { Logger, runMigrations } from "graphile-worker";

import type { AppContext } from "#context";
import type { Db } from "#db";
import { addJob, unlockStaleJobs } from "#db/queries/jobs";
import type { NewJob } from "#db/queries/jobs";
import { log } from "#telemetry/log";

export const logger = new Logger((scope) => (level, message, meta) => {
  if (meta?.failure === true) {
    return;
  }
  const fields = {
    error: meta?.error,
    detail: message,
    label: scope.label,
    task: scope.taskIdentifier,
  };
  if (level === "error") {
    log.error("jobs: worker error", fields);
  } else if (level === "warning") {
    log.warn("jobs: worker warning", fields);
  }
});

export async function installQueue(db: Db) {
  await runMigrations({ pgPool: db.$client, logger });
}

/**
 * Inside `transact`, the job commits with the transaction. Jobs in the same `queue` run one at a
 * time, but a failed job retries after the ones behind it. A job added with the `key` of one still
 * waiting replaces it instead of queuing a second; with a `runAt` or `delayMs` it also moves the
 * waiting one's time, so adding it again and again puts it off until things go quiet. Lower
 * `priority` runs first; within a queue it lets a live event overtake history waiting to be processed.
 */
export async function enqueue(
  ctx: AppContext,
  task: string,
  payload: Record<string, unknown>,
  opts: JobOptions = {}
) {
  await addJob(ctx.db, newJob(task, payload, opts));
}

type JobOptions = {
  queue?: string;
  maxAttempts?: number;
  key?: string;
  priority?: number;
  runAt?: Date;
  delayMs?: number;
};

/** A job as `enqueue` adds it, for a query that adds it in the same statement as its write. */
export function newJob(
  task: string,
  payload: Record<string, unknown>,
  opts: JobOptions = {}
) {
  return {
    task,
    payload,
    queue: opts.queue ?? null,
    maxAttempts: opts.maxAttempts ?? 5,
    key: opts.key ?? null,
    priority: opts.priority ?? 0,
    runAt: opts.runAt ?? null,
    delayMs: opts.delayMs ?? null,
  } satisfies NewJob;
}

const ABANDONED_MS = 60 * 60_000;

/**
 * Unlocks jobs whose worker died, after an hour instead of Graphile Worker's four: such a job holds
 * its queue (a person's automations, a connection's sync, the scheduler) until then.
 */
export async function releaseAbandonedJobs(ctx: AppContext) {
  return await unlockStaleJobs(ctx.db, { olderThanMs: ABANDONED_MS });
}
