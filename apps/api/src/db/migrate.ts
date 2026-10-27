import { setTimeout as sleep } from "node:timers/promises";

import { readMigrationFiles } from "drizzle-orm/migrator";
import type { MigrationMeta } from "drizzle-orm/migrator";
import type { Pool, PoolClient } from "pg";

// Any fixed number works, as long as every Worklog process uses the same one.
const MIGRATION_LOCK = 4_243_960_211;

const CONCURRENT_INDEX =
  /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(?<name>\w+)"?/iu;

/**
 * Drizzle's migrator with two differences. Every process takes the same advisory lock first, so an
 * API and a worker starting together don't both migrate. And an index built `CONCURRENTLY` runs
 * outside a transaction, as Postgres requires, so building it on a large table doesn't block writes.
 * It keeps Drizzle's own bookkeeping table, so existing databases carry on where they left off.
 */
export async function migrate(pool: Pool, migrationsFolder: string) {
  const migrations = readMigrationFiles({ migrationsFolder });
  const client = await pool.connect();
  try {
    await lock(client);
    await client.query("create schema if not exists drizzle");
    await client.query(
      "create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)"
    );
    const { rows } = await client.query<{ created_at: string }>(
      "select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1"
    );
    const last = rows[0] ? Number(rows[0].created_at) : 0;
    for (const migration of migrations) {
      if (migration.folderMillis > last) {
        await apply(client, migration);
      }
    }
  } finally {
    // Closing the connection releases the session lock, even after a failed migration.
    client.release(true);
  }
}

// Polls rather than waiting inside pg_advisory_lock: a session blocked in that call holds a
// snapshot, and CREATE INDEX CONCURRENTLY in the session that has the lock waits for every older
// snapshot to end, so the two would deadlock.
async function lock(client: PoolClient) {
  for (;;) {
    const { rows } = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [MIGRATION_LOCK]
    );
    if (rows[0]?.locked === true) {
      return;
    }
    await sleep(250);
  }
}

async function apply(client: PoolClient, migration: MigrationMeta) {
  const statements = migration.sql.filter((s) => s.trim());
  const concurrent = statements.filter((s) => CONCURRENT_INDEX.test(s));
  if (concurrent.length > 0 && concurrent.length < statements.length) {
    throw new Error(
      `A migration mixes CREATE INDEX CONCURRENTLY with other statements; generate the index on its own: ${concurrent[0]?.trim()}`
    );
  }
  if (concurrent.length > 0) {
    for (const statement of statements) {
      await buildIndex(client, statement);
    }
    await record(client, migration);
    return;
  }
  await client.query("begin");
  try {
    for (const statement of statements) {
      await client.query(statement);
    }
    await record(client, migration);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

// A failed build leaves an invalid index behind; a build that finished before the migration was
// recorded leaves a valid one. Rebuild the first, keep the second.
async function buildIndex(client: PoolClient, statement: string) {
  const name = CONCURRENT_INDEX.exec(statement)?.groups?.name ?? "";
  const { rows } = await client.query<{ valid: boolean }>(
    "select i.indisvalid as valid from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname = $1",
    [name]
  );
  if (rows[0]?.valid === true) {
    return;
  }
  if (rows[0]) {
    await client.query(`drop index concurrently if exists "${name}"`);
  }
  await client.query(statement);
}

async function record(client: PoolClient, migration: MigrationMeta) {
  await client.query(
    "insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)",
    [migration.hash, migration.folderMillis]
  );
}
