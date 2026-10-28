import { and, asc, eq } from "drizzle-orm";

import type { DbOrTx } from "#db";
import { connectionCursors } from "#db/schema";

export type ConnectionCursor = typeof connectionCursors.$inferSelect;

export async function listConnectionCursors(
  db: DbOrTx,
  params: { connectionId: string }
) {
  return await db
    .select()
    .from(connectionCursors)
    .where(eq(connectionCursors.connectionId, params.connectionId))
    .orderBy(asc(connectionCursors.stream));
}

export async function findConnectionCursor(
  db: DbOrTx,
  params: { connectionId: string; stream: string }
) {
  const [row] = await db
    .select()
    .from(connectionCursors)
    .where(
      and(
        eq(connectionCursors.connectionId, params.connectionId),
        eq(connectionCursors.stream, params.stream)
      )
    );
  return row;
}

// `cursor` is only written when given, so recording a failure keeps the last good position.
export async function upsertConnectionCursor(
  db: DbOrTx,
  params: {
    connectionId: string;
    stream: string;
    cursor?: Record<string, unknown>;
    state: ConnectionCursor["state"];
    error: string | null;
    syncedAt?: Date;
    now: Date;
  }
) {
  const set = {
    state: params.state,
    error: params.error,
    updatedAt: params.now,
    ...(params.cursor ? { cursor: params.cursor } : {}),
    ...(params.syncedAt ? { syncedAt: params.syncedAt } : {}),
  };
  await db
    .insert(connectionCursors)
    .values({
      connectionId: params.connectionId,
      stream: params.stream,
      cursor: params.cursor ?? {},
      ...set,
    })
    .onConflictDoUpdate({
      target: [connectionCursors.connectionId, connectionCursors.stream],
      set,
    });
}
