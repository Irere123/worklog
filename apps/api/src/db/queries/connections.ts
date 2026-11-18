import { and, asc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";

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

export async function listActiveConnectionsByProvider(
  db: DbOrTx,
  params: { providers: string[] }
) {
  if (params.providers.length === 0) {
    return [];
  }
  return await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.status, "active"),
        inArray(connections.provider, params.providers)
      )
    );
}

export async function listQuietConnections(
  db: DbOrTx,
  params: { before: Date }
) {
  return await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.status, "active"),
        lt(connections.lastEventAt, params.before)
      )
    );
}

export async function listConnectionSecrets(db: DbOrTx) {
  return await db
    .select({ id: connections.id, secrets: connections.secrets })
    .from(connections);
}

export async function updateConnectionSecretsIfUnchanged(
  db: DbOrTx,
  params: { id: string; from: string; to: string }
) {
  const rows = await db
    .update(connections)
    .set({ secrets: params.to })
    .where(
      and(eq(connections.id, params.id), eq(connections.secrets, params.from))
    )
    .returning({ id: connections.id });
  return rows.length > 0;
}

export async function listInstalledConnections(
  db: DbOrTx,
  params: { provider: string }
) {
  return await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.provider, params.provider),
        inArray(connections.status, ["active", "paused", "suspended"]),
        isNotNull(connections.externalId)
      )
    );
}

export async function listAllConnectionIds(db: DbOrTx) {
  const rows = await db.select({ id: connections.id }).from(connections);
  return rows.map((r) => r.id);
}

/**
 * Taken first by a transaction that writes rows referring to the connection: deleting it then
 * waits for the transaction to finish instead of deadlocking with it.
 */
export async function lockConnectionForWrites(
  db: DbOrTx,
  params: { id: string }
) {
  await db
    .select({ id: connections.id })
    .from(connections)
    .where(eq(connections.id, params.id))
    .for("key share");
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
      Pick<
        ConnectionRow,
        | "name"
        | "status"
        | "statusReason"
        | "settings"
        | "secrets"
        | "installedById"
        | "externalId"
      >
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

export async function findConnectionByExternalId(
  db: DbOrTx,
  params: { provider: string; externalId: string }
) {
  const [row] = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.provider, params.provider),
        eq(connections.externalId, params.externalId)
      )
    );
  return row;
}

export async function listActiveConnections(
  db: DbOrTx,
  params: { workspaceId: string; provider: string }
) {
  return await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.workspaceId, params.workspaceId),
        eq(connections.provider, params.provider),
        eq(connections.status, "active")
      )
    )
    .orderBy(asc(connections.createdAt));
}

export async function findRevokedConnection(
  db: DbOrTx,
  params: { workspaceId: string; provider: string; account: string }
) {
  const [row] = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.workspaceId, params.workspaceId),
        eq(connections.provider, params.provider),
        sql`${connections.settings}->>'account' = ${params.account}`,
        eq(connections.status, "revoked")
      )
    )
    .orderBy(asc(connections.createdAt))
    .limit(1);
  return row;
}

export type ConnectionTally = {
  id: string;
  lastEventAt: Date | null;
  rejections: number;
  lastRejectedAt: Date | null;
  lastRejection: string | null;
};

export async function updateConnectionTallies(
  db: DbOrTx,
  rows: ConnectionTally[]
) {
  if (rows.length === 0) {
    return;
  }
  const values = sql.join(
    rows.map(
      (r) =>
        sql`(${r.id}::text, ${r.lastEventAt}::timestamptz, ${r.rejections}::int, ${r.lastRejectedAt}::timestamptz, ${r.lastRejection}::text)`
    ),
    sql`, `
  );
  await db.execute(sql`
    update connections as c set
      last_event_at = greatest(c.last_event_at, v.last_event_at),
      rejections = c.rejections + v.rejections,
      last_rejected_at = greatest(c.last_rejected_at, v.last_rejected_at),
      last_rejection = case
        when v.last_rejected_at is not null
          and (c.last_rejected_at is null or v.last_rejected_at >= c.last_rejected_at)
        then v.last_rejection
        else c.last_rejection
      end
    from (values ${values}) as v(id, last_event_at, rejections, last_rejected_at, last_rejection)
    where c.id = v.id
  `);
}

export async function deleteConnectionById(db: DbOrTx, params: { id: string }) {
  await db.delete(connections).where(eq(connections.id, params.id));
}
