import { sql } from "drizzle-orm";

import type { DbOrTx } from "#db";

export async function pingDatabase(db: DbOrTx) {
  await db.execute(sql`select 1`);
}
