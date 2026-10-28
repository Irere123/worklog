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

// Several new accounts in one statement; the ones another delivery created first are left out.
export async function insertIdentitiesIfNew(
  db: DbOrTx,
  rows: (typeof identities.$inferInsert)[]
) {
  if (rows.length === 0) {
    return [];
  }
  return await db
    .insert(identities)
    .values(rows)
    .onConflictDoNothing()
    .returning();
}

export async function findIdentityById(db: DbOrTx, params: { id: string }) {
  const [row] = await db
    .select()
    .from(identities)
    .where(eq(identities.id, params.id));
  return row;
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

/**
 * Accounts by their last-seen login (pass logins lowercase), not placeholders: a mention carries
 * only the login. The most recently seen first, for a login that passed from one account to another.
 */
export async function listIdentitiesByHandles(
  db: DbOrTx,
  params: { workspaceId: string; provider: string; handles: string[] }
) {
  if (params.handles.length === 0) {
    return [];
  }
  return await db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.workspaceId, params.workspaceId),
        eq(identities.provider, params.provider),
        inArray(sql`lower(${identities.externalHandle})`, params.handles),
        sql`${identities.externalId} not like 'handle:%'`
      )
    )
    .orderBy(sql`${identities.lastSeenAt} desc nulls last`);
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

// Only when something about the account changed; the sighting count goes through the tally.
export async function updateIdentityDetails(
  db: DbOrTx,
  params: {
    id: string;
    set: Partial<
      Pick<
        Identity,
        | "memberId"
        | "externalHandle"
        | "displayName"
        | "isBot"
        | "email"
        | "enrichedAt"
      >
    >;
  }
) {
  await db
    .update(identities)
    .set(params.set)
    .where(eq(identities.id, params.id));
}

// One statement for a batch of sightings (ingest/tally.ts).
export async function updateIdentitySightings(
  db: DbOrTx,
  rows: { id: string; n: number; first: Date; last: Date }[]
) {
  if (rows.length === 0) {
    return;
  }
  const values = sql.join(
    rows.map(
      (r) =>
        sql`(${r.id}::text, ${r.n}::int, ${r.first}::timestamptz, ${r.last}::timestamptz)`
    ),
    sql`, `
  );
  await db.execute(sql`
    update identities as i set
      event_count = i.event_count + v.n,
      first_seen_at = least(i.first_seen_at, v.first),
      last_seen_at = greatest(i.last_seen_at, v.last)
    from (values ${values}) as v(id, n, first, last)
    where i.id = v.id
  `);
}

export async function deleteIdentityById(db: DbOrTx, params: { id: string }) {
  await db.delete(identities).where(eq(identities.id, params.id));
}
