import { and, eq } from "drizzle-orm";

import type { DbOrTx } from "#db";
import { connections } from "#db/schema";
import { returned } from "#lib/assert";
import { notFound } from "#lib/errors";

export type ConnectionRow = typeof connections.$inferSelect;

export async function insertConnection(db: DbOrTx, row: ConnectionRow) {
  await db.insert(connections).values(row);
}

export async function listConnections(
  db: DbOrTx,
  params: { workspaceId: string }
) {
  return await db
    .select()
    .from(connections)
    .where(eq(connections.workspaceId, params.workspaceId));
}

// `workspaceId` is optional for webhooks and jobs, which only know the connection id.
// Every workspace's connections, for jobs that sweep them all.
export async function listAllConnectionIds(db: DbOrTx) {
  const rows = await db.select({ id: connections.id }).from(connections);
  return rows.map((r) => r.id);
}

export async function findConnectionById(
  db: DbOrTx,
  params: { id: string; workspaceId?: string }
) {
  const [row] = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.id, params.id),
        params.workspaceId
          ? eq(connections.workspaceId, params.workspaceId)
          : undefined
      )
    );
  return row;
}

export async function getConnectionById(
  db: DbOrTx,
  params: { id: string; workspaceId: string }
) {
  const row = await findConnectionById(db, params);
  if (!row) {
    throw notFound("Connection");
  }
  return row;
}

export async function updateConnectionById(
  db: DbOrTx,
  params: {
    id: string;
    set: Partial<
      Pick<ConnectionRow, "name" | "status" | "settings" | "secrets">
    >;
  }
) {
  const rows = await db
    .update(connections)
    .set(params.set)
    .where(eq(connections.id, params.id))
    .returning();
  return returned(rows, "connection");
}

// No returned row: a connection deleted while its webhook is in flight matches nothing, and the
// delivery it already stored still gets its 200.
export async function setConnectionLastEventAt(
  db: DbOrTx,
  params: { id: string; at: Date }
) {
  await db
    .update(connections)
    .set({ lastEventAt: params.at })
    .where(eq(connections.id, params.id));
}

export async function deleteConnectionById(db: DbOrTx, params: { id: string }) {
  await db.delete(connections).where(eq(connections.id, params.id));
}
