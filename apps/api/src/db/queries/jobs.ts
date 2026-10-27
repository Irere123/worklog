import { sql } from "drizzle-orm";

import type { DbOrTx } from "#db";

// Graphile Worker's own SQL API, so a job added inside a transaction commits with it.
export async function addJob(
  db: DbOrTx,
  params: {
    task: string;
    payload: Record<string, unknown>;
    queue: string | null;
    maxAttempts: number;
  }
) {
  await db.execute(
    sql`select graphile_worker.add_job(
      ${params.task}::text,
      ${JSON.stringify(params.payload)}::json,
      queue_name => ${params.queue}::text,
      max_attempts => ${params.maxAttempts}::int
    )`
  );
}
