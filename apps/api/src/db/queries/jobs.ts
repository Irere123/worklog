import { sql } from "drizzle-orm";

import type { DbOrTx } from "#db";

export type NewJob = {
  task: string;
  payload: Record<string, unknown>;
  queue: string | null;
  maxAttempts: number;
  key: string | null;
  priority: number;
  runAt: Date | null;
};

// Graphile Worker's own SQL API, so a job added inside a transaction commits with it.
export async function addJob(db: DbOrTx, job: NewJob) {
  await db.execute(sql`select ${addJobCall(job)}`);
}

/** The call that adds `job`, to put in a statement that writes something it must follow. */
export function addJobCall(job: NewJob) {
  return sql`graphile_worker.add_job(
    ${job.task}::text,
    ${JSON.stringify(job.payload)}::json,
    queue_name => ${job.queue}::text,
    max_attempts => ${job.maxAttempts}::int,
    run_at => ${job.runAt}::timestamptz,
    job_key => ${job.key}::text,
    priority => ${job.priority}::int,
    job_key_mode => ${job.runAt ? "replace" : "preserve_run_at"}::text
  )`;
}

// Jobs that could run now: not running, due, with attempts left.
export async function countRunnableJobs(db: DbOrTx) {
  const result = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from graphile_worker._private_jobs
      where locked_at is null and run_at <= now() and attempts < max_attempts`
  );
  return result.rows[0]?.n ?? 0;
}

/**
 * Unlocks jobs (of `task`, or of any) locked longer than any run of them takes, with their queues:
 * their worker died, and Graphile Worker only frees such locks after four hours, holding the
 * queue until then. Each runs again if it has attempts left. Returns how many.
 */
export async function unlockStaleJobs(
  db: DbOrTx,
  params: { task?: string; olderThanMs: number }
) {
  const result = await db.execute<{ n: number }>(sql`
    with stale as (
      select jobs.id, jobs.job_queue_id
      from graphile_worker._private_jobs as jobs
      join graphile_worker._private_tasks as tasks on tasks.id = jobs.task_id
      where jobs.locked_at < now() - make_interval(secs => ${params.olderThanMs / 1000})
        and (${params.task ?? null}::text is null or tasks.identifier = ${params.task ?? null})
    ),
    unlocked as (
      update graphile_worker._private_jobs
      set locked_at = null, locked_by = null
      where id in (select id from stale)
      returning job_queue_id
    ),
    freed as (
      update graphile_worker._private_job_queues
      set locked_at = null, locked_by = null
      where id in (select job_queue_id from unlocked)
      returning id
    )
    select (select count(*) from unlocked)::int as n`);
  return result.rows[0]?.n ?? 0;
}
