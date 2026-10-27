import { Logger, runMigrations } from "graphile-worker";

import type { AppContext } from "#context";
import type { Db } from "#db";
import { addJob } from "#db/queries/jobs";

export type JobHandler = (
  ctx: AppContext,
  payload: Record<string, unknown>
) => Promise<void>;

export const logger = new Logger(() => (level, message) => {
  if (level === "error" || level === "warning") {
    console.error(`[jobs] ${message}`);
  }
});

export async function installQueue(db: Db) {
  await runMigrations({ pgPool: db.$client, logger });
}

/**
 * Inside `transact`, the job commits with the transaction. Jobs in the same `queue` run one at a
 * time, oldest first, but a failed job retries after the ones behind it. A job added with the `key`
 * of one still waiting replaces it instead of queuing a second.
 */
export async function enqueue(
  ctx: AppContext,
  task: string,
  payload: Record<string, unknown>,
  opts: { queue?: string; maxAttempts?: number; key?: string } = {}
) {
  await addJob(ctx.db, {
    task,
    payload,
    queue: opts.queue ?? null,
    maxAttempts: opts.maxAttempts ?? 5,
    key: opts.key ?? null,
  });
}
