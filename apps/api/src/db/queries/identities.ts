import { and, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import type { DbOrTx } from "#db";
import { violates } from "#db/errors";
import { identities } from "#db/schema";
import { returned } from "#lib/assert";
import { conflict } from "#lib/errors";

export type Identity = typeof identities.$inferSelect;

export async function insertIdentity(
  db: DbOrTx,
  row: typeof identities.$inferInsert
) {
  try {
    const rows = await db.insert(identities).values(row).returning();
    return returned(rows, "identity");
  } catch (error) {
    if (violates(error, "identities_ext_uq")) {
      throw conflict(`That ${row.provider} account is already linked`);
    }
    throw error;
  }
}

// For ingestion, where two deliveries can see a new account at once: the loser gets undefined.
export async function insertIdentityIfNew(
  db: DbOrTx,
  row: typeof identities.$inferInsert
) {
  const [created] = await db
    .insert(identities)
    .values(row)
    .onConflictDoNothing()
    .returning();
  return created;
}

export async function listIdentitiesByExternalIds(
  db: DbOrTx,
  params: { workspaceId: string; provider: string; externalIds: string[] }
) {
  return await db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.workspaceId, params.workspaceId),
        eq(identities.provider, params.provider),
        inArray(identities.externalId, params.externalIds)
      )
    );
}

// `handle` matches the last-seen login case-insensitively; pass it lowercase.
export async function findIdentityByExternalIdOrHandle(
  db: DbOrTx,
  params: {
    workspaceId: string;
    provider: string;
    externalId: string;
    handle: string | null;
  }
) {
  const [row] = await db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.workspaceId, params.workspaceId),
        eq(identities.provider, params.provider),
        or(
          eq(identities.externalId, params.externalId),
          params.handle
            ? sql`lower(${identities.externalHandle}) = ${params.handle}`
            : undefined
        )
      )
    );
  return row;
}

export async function listIdentities(
  db: DbOrTx,
  params: { workspaceId: string; unlinked?: boolean; memberId?: string }
) {
  return await db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.workspaceId, params.workspaceId),
        params.unlinked === true ? isNull(identities.memberId) : undefined,
        params.memberId ? eq(identities.memberId, params.memberId) : undefined
      )
    )
    .orderBy(desc(identities.eventCount))
    .limit(500);
}

export async function countUnlinkedIdentities(
  db: DbOrTx,
  params: { workspaceId: string; provider: string }
) {
  const [row] = await db
    .select({ n: count() })
    .from(identities)
    .where(
      and(
        eq(identities.workspaceId, params.workspaceId),
        eq(identities.provider, params.provider),
        isNull(identities.memberId)
      )
    );
  return row?.n ?? 0;
}

export async function updateIdentityById(
  db: DbOrTx,
  params: {
    id: string;
    workspaceId?: string;
    set: Partial<Pick<Identity, "externalId" | "memberId">>;
  }
) {
  const [row] = await db
    .update(identities)
    .set(params.set)
    .where(
      and(
        eq(identities.id, params.id),
        params.workspaceId
          ? eq(identities.workspaceId, params.workspaceId)
          : undefined
      )
    )
    .returning();
  return row;
}

// Counts the sighting along with the fresh details.
export async function updateIdentitySighting(
  db: DbOrTx,
  params: {
    id: string;
    set: Pick<
      Identity,
      | "memberId"
      | "externalHandle"
      | "displayName"
      | "isBot"
      | "lastSeenAt"
      | "firstSeenAt"
    >;
  }
) {
  await db
    .update(identities)
    .set({ ...params.set, eventCount: sql`${identities.eventCount} + 1` })
    .where(eq(identities.id, params.id));
}

export async function deleteIdentityById(db: DbOrTx, params: { id: string }) {
  await db.delete(identities).where(eq(identities.id, params.id));
}
