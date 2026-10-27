import { and, eq, inArray } from "drizzle-orm";

import type { DbOrTx } from "#db";
import { deliveryTargets } from "#db/schema";

export type TargetRow = typeof deliveryTargets.$inferSelect;

export async function insertDeliveryTarget(
  db: DbOrTx,
  row: typeof deliveryTargets.$inferInsert
) {
  await db.insert(deliveryTargets).values(row);
}

export async function listDeliveryTargets(
  db: DbOrTx,
  params: { memberId: string }
) {
  return await db
    .select()
    .from(deliveryTargets)
    .where(eq(deliveryTargets.memberId, params.memberId));
}

// Of `ids`, only the member's own enabled targets.
export async function listEnabledTargets(
  db: DbOrTx,
  params: { memberId: string; ids: string[] }
) {
  return await db
    .select()
    .from(deliveryTargets)
    .where(
      and(
        eq(deliveryTargets.memberId, params.memberId),
        inArray(deliveryTargets.id, params.ids),
        eq(deliveryTargets.enabled, true)
      )
    );
}

export async function deleteDeliveryTarget(
  db: DbOrTx,
  params: { id: string; memberId: string }
) {
  return await db
    .delete(deliveryTargets)
    .where(
      and(
        eq(deliveryTargets.id, params.id),
        eq(deliveryTargets.memberId, params.memberId)
      )
    )
    .returning();
}

export async function updateDeliveryTargetById(
  db: DbOrTx,
  params: {
    id: string;
    memberId: string;
    set: Partial<Pick<TargetRow, "label" | "visibility">>;
  }
) {
  const [row] = await db
    .update(deliveryTargets)
    .set(params.set)
    .where(
      and(
        eq(deliveryTargets.id, params.id),
        eq(deliveryTargets.memberId, params.memberId)
      )
    )
    .returning();
  return row;
}
