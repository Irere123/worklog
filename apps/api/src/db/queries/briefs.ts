import { and, desc, eq } from "drizzle-orm";

import type { DbOrTx } from "#db";
import { briefs } from "#db/schema";
import { returned } from "#lib/assert";
import { notFound } from "#lib/errors";

export type BriefRow = typeof briefs.$inferSelect;

export async function upsertBrief(db: DbOrTx, row: BriefRow) {
  const rows = await db
    .insert(briefs)
    .values(row)
    .onConflictDoUpdate({
      target: [briefs.memberId, briefs.period, briefs.periodStart],
      set: {
        title: row.title,
        body: row.body,
        data: row.data,
        composedBy: row.composedBy,
        periodEnd: row.periodEnd,
        createdAt: row.createdAt,
      },
    })
    .returning();
  return returned(rows, "brief");
}

export async function listBriefs(
  db: DbOrTx,
  params: { memberId: string; period?: BriefRow["period"]; limit?: number }
) {
  return await db
    .select()
    .from(briefs)
    .where(
      and(
        eq(briefs.memberId, params.memberId),
        params.period ? eq(briefs.period, params.period) : undefined
      )
    )
    .orderBy(desc(briefs.periodStart))
    .limit(params.limit ?? 20);
}

export async function getBriefById(
  db: DbOrTx,
  params: { id: string; memberId: string }
) {
  const [row] = await db
    .select()
    .from(briefs)
    .where(and(eq(briefs.id, params.id), eq(briefs.memberId, params.memberId)));
  if (!row) {
    throw notFound("Brief");
  }
  return row;
}
