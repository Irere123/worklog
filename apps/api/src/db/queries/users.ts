import { eq } from "drizzle-orm";

import type { DbOrTx } from "#db";
import { user } from "#db/auth-schema";

export async function findUserById(db: DbOrTx, params: { id: string }) {
  const [row] = await db.select().from(user).where(eq(user.id, params.id));
  return row;
}
