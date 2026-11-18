import type { Pool, PoolClient } from "pg";

/**
 * A session-level advisory lock on a connection of its own, held until `release` or until that
 * connection drops, which `alive` notices. Null when another session holds it.
 */
export async function tryHoldLock(pool: Pool, key: number) {
  const client: PoolClient = await pool.connect();
  try {
    const { rows } = await client.query<{ held: boolean }>(
      "select pg_try_advisory_lock($1) as held",
      [key]
    );
    if (rows[0]?.held !== true) {
      client.release();
      return null;
    }
  } catch (error) {
    client.release(true);
    throw error;
  }
  return {
    alive: async () => {
      try {
        await client.query("select 1");
        return true;
      } catch {
        return false;
      }
    },
    release: async () => {
      try {
        await client.query("select pg_advisory_unlock($1)", [key]);
        client.release();
      } catch {
        client.release(true);
      }
    },
  };
}
