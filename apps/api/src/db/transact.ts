import { sql } from "drizzle-orm";

import type { AppContext } from "#context";
import { log } from "#telemetry/log";
import { traced } from "#telemetry/trace";

/**
 * `durable: false` commits without waiting for the disk: a crash can lose the transaction whole,
 * never part of it. Only for work that something durable will redo, like processing a delivery
 * whose stored row stays pending until the same transaction marks it done.
 *
 * Ecto's `Repo.transact`: `fn` gets a context whose `db` is the transaction, so every domain
 * function it passes that context to joins it, and so do jobs from `enqueue`. Events wait for the
 * commit, are dropped on rollback, and failing to publish them doesn't fail the commit. A nested call joins the outer transaction (no savepoint), so
 * an inner failure rolls back everything.
 */
export async function transact<T>(
  ctx: AppContext,
  fn: (tx: AppContext) => Promise<T>,
  opts: { durable?: boolean } = {}
): Promise<T> {
  if (ctx.bus.holding) {
    return await fn(ctx);
  }
  const bus = ctx.bus.hold();
  const result = await traced(
    "db.transaction",
    {},
    async () =>
      await ctx.db.transaction(async (db) => {
        if (opts.durable === false) {
          await db.execute(sql`set local synchronous_commit = off`);
        }
        return await fn({ ...ctx, db, bus });
      })
  );
  // Committed, whatever happens to its events: throwing now would tell the caller the write failed,
  // and a retry would find it done. A client that misses the event catches up on its next read.
  try {
    await bus.release();
  } catch (error) {
    log.error("bus: a committed transaction's events weren't published", {
      error,
    });
  }
  return result;
}
