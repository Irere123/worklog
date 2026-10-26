import { sql } from "drizzle-orm";
import { Logger, runMigrations } from "graphile-worker";

import type { AppContext } from "../context";
import type { Db } from "../db";

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

/** Jobs in the same `queue` run one at a time, oldest first, but a failed job retries after the ones behind it. */
export async function enqueue(
  ctx: AppContext,
  task: string,
  payload: Record<string, unknown>,
  opts: { queue?: string; maxAttempts?: number } = {}
) {
  await ctx.db.execute(
    sql`select graphile_worker.add_job(
      ${task}::text,
      ${JSON.stringify(payload)}::json,
      queue_name => ${opts.queue ?? null}::text,
      max_attempts => ${opts.maxAttempts ?? 5}::int
    )`
  );
}
