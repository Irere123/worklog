import { desc, eq } from "drizzle-orm";

import type { DbOrTx } from "#db";
import { voices } from "#db/schema";

export type VoiceRow = typeof voices.$inferSelect;

export async function findVoice(db: DbOrTx, params: { memberId: string }) {
  const [row] = await listVoices(db, { memberId: params.memberId, limit: 1 });
  return row;
}

export async function listVoices(
  db: DbOrTx,
  params: { memberId: string; limit: number }
) {
  return await db
    .select()
    .from(voices)
    .where(eq(voices.memberId, params.memberId))
    .orderBy(desc(voices.createdAt), desc(voices.id))
    .limit(params.limit);
}

export async function insertVoice(db: DbOrTx, row: VoiceRow) {
  await db.insert(voices).values(row);
}
