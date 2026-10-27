import type { AppContext } from "#context";

/**
 * Ecto's `Repo.transact`: `fn` gets a context whose `db` is the transaction, so every domain
 * function it passes that context to joins it, and so do jobs from `enqueue`. Events wait for the
 * commit and are dropped on rollback. A nested call joins the outer transaction (no savepoint), so
 * an inner failure rolls back everything.
 */
export async function transact<T>(
  ctx: AppContext,
  fn: (tx: AppContext) => Promise<T>
): Promise<T> {
  if (ctx.bus.holding) {
    return await fn(ctx);
  }
  const bus = ctx.bus.hold();
  const result = await ctx.db.transaction(
    async (db) => await fn({ ...ctx, db, bus })
  );
  await bus.release();
  return result;
}
