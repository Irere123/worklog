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
export type DbOrTx = Db | Tx;

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url)
);

export async function openDb(url: string, poolSize = 10) {
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

function logError(error: Error) {
  outsideTrace(() => {
    log.error("db: connection error", { error });
  });
}
