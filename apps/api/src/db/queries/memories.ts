import { and, desc, eq, gte, ilike, inArray } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { DbOrTx } from "#db";
import { memories } from "#db/schema";
import type { MemoryKind, Visibility } from "#db/schema";

export type MemoryRow = typeof memories.$inferSelect;

// Visibility is enforced here, in the query, never by prompt: teammates only ever get `team` rows.
export async function listMemories(
  db: DbOrTx,
  params: {
    memberId: string;
    includePrivate: boolean;
    kinds?: MemoryKind[];
    since?: string;
    q?: string;
    limit?: number;
  }
) {
  const where: SQL[] = [
    eq(memories.memberId, params.memberId),
    eq(memories.status, "active"),
  ];
  if (!params.includePrivate) {
    where.push(eq(memories.visibility, "team"));
  }
  if (params.kinds && params.kinds.length > 0) {
    where.push(inArray(memories.kind, params.kinds));
  }
  if (params.since) {
    where.push(gte(memories.day, params.since));
  }
  if (params.q) {
    where.push(ilike(memories.content, `%${params.q}%`));
  }
  return await db
    .select()
    .from(memories)
    .where(and(...where))
    .orderBy(desc(memories.updatedAt))
    .limit(params.limit ?? 100);
}

// The active journal entries for one day and visibility, which a new entry replaces.
export async function listJournalIds(
  db: DbOrTx,
  params: { memberId: string; day: string; visibility: Visibility }
) {
  const rows = await db
    .select({ id: memories.id })
    .from(memories)
    .where(
      and(
        eq(memories.memberId, params.memberId),
        eq(memories.kind, "journal"),
        eq(memories.day, params.day),
        eq(memories.visibility, params.visibility),
        eq(memories.status, "active")
      )
    );
  return rows.map((r) => r.id);
}

export async function insertMemory(db: DbOrTx, row: MemoryRow) {
  await db.insert(memories).values(row);
}

// Scoped to the member, so ids from another member's memory match nothing.
export async function setMemoriesSuperseded(
  db: DbOrTx,
  params: { memberId: string; ids: string[]; now: Date }
) {
  if (!params.ids.length) {
    return [];
  }
  return await db
    .update(memories)
    .set({ status: "superseded", updatedAt: params.now })
    .where(
      and(
        eq(memories.memberId, params.memberId),
        inArray(memories.id, params.ids)
      )
    )
    .returning();
}
