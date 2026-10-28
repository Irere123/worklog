import { and, eq, gt, lt } from "drizzle-orm";

import type { DbOrTx } from "#db";
import { installStates } from "#db/schema";

export type InstallState = typeof installStates.$inferSelect;

export async function insertInstallState(
  db: DbOrTx,
  row: typeof installStates.$inferInsert
) {
  await db.insert(installStates).values(row);
}

export async function findInstallState(
  db: DbOrTx,
  params: {
    id: string;
    provider: string;
    purpose: InstallState["purpose"];
    now: Date;
  }
) {
  const [row] = await db
    .select()
    .from(installStates)
    .where(
      and(
        eq(installStates.id, params.id),
        eq(installStates.provider, params.provider),
        eq(installStates.purpose, params.purpose),
        gt(installStates.expiresAt, params.now)
      )
    );
  return row;
}

// Deleting is the read, so a state works once even when two callbacks race.
export async function deleteInstallState(
  db: DbOrTx,
  params: {
    id: string;
    provider: string;
    purpose: InstallState["purpose"];
    now: Date;
  }
) {
  const [row] = await db
    .delete(installStates)
    .where(
      and(
        eq(installStates.id, params.id),
        eq(installStates.provider, params.provider),
        eq(installStates.purpose, params.purpose),
        gt(installStates.expiresAt, params.now)
      )
    )
    .returning();
  return row;
}

export async function deleteExpiredInstallStates(
  db: DbOrTx,
  params: { now: Date }
) {
  await db.delete(installStates).where(lt(installStates.expiresAt, params.now));
}
