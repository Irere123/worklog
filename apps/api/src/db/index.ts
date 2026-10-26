import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as authSchema from "./auth-schema";
import * as appSchema from "./schema";

export const schema = { ...appSchema, ...authSchema };
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url)
);

// node-postgres, not Bun's native SQL driver: with Drizzle 0.45 it stores jsonb values as JSON
// *strings* (oven-sh/bun#28819) — reads look fine, but `data->>'repo'` is null in SQL.
// test/postgres.test.ts guards this.
export async function openDb(
  url: string
): Promise<{ db: Db; close: () => Promise<void> }> {
  if (/^postgres(?:ql)?:\/\//u.test(url)) {
    const pg = await import("pg");
    const { Pool } = pg.default;
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const client = new Pool({ connectionString: url, max: 10 });
    const db = drizzle({ client, schema });
    await migrate(db, { migrationsFolder });
    return {
      db,
      close: async () => {
        await client.end();
      },
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  if (url !== "memory://") {
    mkdirSync(url, { recursive: true });
  }
  const client = url === "memory://" ? new PGlite() : new PGlite(url);
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder });
  return {
    db,
    close: async () => {
      await client.close();
    },
  };
}
