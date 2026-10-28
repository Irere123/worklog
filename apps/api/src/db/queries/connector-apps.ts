import { and, eq, sql } from "drizzle-orm";

import type { DbOrTx } from "#db";
import { connectorApps } from "#db/schema";

export type ConnectorAppRow = typeof connectorApps.$inferSelect;

export async function findConnectorApp(
  db: DbOrTx,
  params: { provider: string }
) {
  const [row] = await db
    .select()
    .from(connectorApps)
    .where(eq(connectorApps.provider, params.provider));
  return row;
}

export async function listConnectorApps(db: DbOrTx) {
  return await db.select().from(connectorApps);
}

// Undefined when the provider already has an app: credentials are replaced only on purpose.
export async function insertConnectorApp(
  db: DbOrTx,
  row: typeof connectorApps.$inferInsert
) {
  const [created] = await db
    .insert(connectorApps)
    .values(row)
    .onConflictDoNothing()
    .returning();
  return created;
}

export async function updateConnectorApp(
  db: DbOrTx,
  params: {
    provider: string;
    set: Partial<
      Pick<
        ConnectorAppRow,
        "appId" | "slug" | "name" | "credentials" | "createdVia" | "updatedAt"
      >
    >;
  }
) {
  const [row] = await db
    .update(connectorApps)
    .set(params.set)
    .where(eq(connectorApps.provider, params.provider))
    .returning();
  return row;
}

// Only if nobody changed them since they were read; false otherwise.
export async function updateConnectorAppCredentialsIfUnchanged(
  db: DbOrTx,
  params: { provider: string; from: string; to: string }
) {
  const rows = await db
    .update(connectorApps)
    .set({ credentials: params.to })
    .where(
      and(
        eq(connectorApps.provider, params.provider),
        eq(connectorApps.credentials, params.from)
      )
    )
    .returning({ provider: connectorApps.provider });
  return rows.length > 0;
}

export async function deleteConnectorApp(
  db: DbOrTx,
  params: { provider: string }
) {
  await db
    .delete(connectorApps)
    .where(eq(connectorApps.provider, params.provider));
}

export type AppTally = {
  provider: string;
  unrouted: number;
  lastUnroutedAt: Date | null;
  rejections: number;
  lastRejectedAt: Date | null;
  lastRejection: string | null;
};

export async function updateConnectorAppTally(db: DbOrTx, params: AppTally) {
  await db
    .update(connectorApps)
    .set({
      unrouted: sql`${connectorApps.unrouted} + ${params.unrouted}`,
      lastUnroutedAt: sql`greatest(${connectorApps.lastUnroutedAt}, ${params.lastUnroutedAt}::timestamptz)`,
      rejections: sql`${connectorApps.rejections} + ${params.rejections}`,
      lastRejectedAt: sql`greatest(${connectorApps.lastRejectedAt}, ${params.lastRejectedAt}::timestamptz)`,
      // The reason that goes with the latest time, whichever process flushes first.
      lastRejection: sql`case
        when ${params.lastRejectedAt}::timestamptz is not null
          and (${connectorApps.lastRejectedAt} is null or ${params.lastRejectedAt}::timestamptz >= ${connectorApps.lastRejectedAt})
        then ${params.lastRejection}::text
        else ${connectorApps.lastRejection}
      end`,
    })
    .where(eq(connectorApps.provider, params.provider));
}
