import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { instrumentPool } from "#telemetry/instrument";
import { log } from "#telemetry/log";
import { outsideTrace } from "#telemetry/trace";

import * as authSchema from "./auth-schema";
import { migrate } from "./migrate";
import * as appSchema from "./schema";

export const schema = { ...appSchema, ...authSchema };
export type Db = NodePgDatabase<typeof schema> & { $client: Pool };
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
// What query functions take, so the same query runs alone or inside `transact`.
export type DbOrTx = Db | Tx;

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url)
);

// node-postgres, not Bun's native SQL driver: with Drizzle 0.45 it stores jsonb values as JSON
// *strings* (oven-sh/bun#28819) — reads look fine, but `data->>'repo'` is null in SQL.
// test/postgres.test.ts guards this.
export async function openDb(
  url: string,
  poolSize = 10
): Promise<{ db: Db; close: () => Promise<void> }> {
  const pool = new Pool({ connectionString: url, max: poolSize });
  instrumentPool(pool);
  pool.on("error", logError);
  pool.on("connect", (connection) => {
    connection.on("error", logError);
  });
  const db = drizzle({ client: pool, schema });
  await migrate(pool, migrationsFolder);
  return {
    db,
    close: async () => {
      await pool.end();
    },
  };
}

// A connection can drop (a server restart); unhandled, that error crashes the process.
function logError(error: Error) {
  // A connection's socket keeps the trace of the request that opened it; its error isn't that
  // request's.
  outsideTrace(() => {
    log.error("db: connection error", { error });
  });
}
