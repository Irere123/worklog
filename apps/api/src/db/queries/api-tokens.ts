import { and, desc, eq, gt, isNull, or } from "drizzle-orm";

import type { DbOrTx } from "#db";
import { apiTokens, members } from "#db/schema";

export type ApiToken = typeof apiTokens.$inferSelect;

export async function insertToken(
  db: DbOrTx,
  row: typeof apiTokens.$inferInsert
) {
  await db.insert(apiTokens).values(row);
}

export async function listActiveTokens(
  db: DbOrTx,
  params: { memberId: string }
) {
  return await db
    .select()
    .from(apiTokens)
    .where(
      and(eq(apiTokens.memberId, params.memberId), isNull(apiTokens.revokedAt))
    )
    .orderBy(desc(apiTokens.createdAt));
}

export async function findTokenByHash(
  db: DbOrTx,
  params: { tokenHash: string; now: Date }
) {
  const [row] = await db
    .select({
      member: members,
      tokenId: apiTokens.id,
      scopes: apiTokens.scopes,
    })
    .from(apiTokens)
    .innerJoin(members, eq(members.id, apiTokens.memberId))
    .where(
      and(
        eq(apiTokens.tokenHash, params.tokenHash),
        isNull(apiTokens.revokedAt),
        isNull(members.deactivatedAt),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, params.now))
      )
    );
  return row;
}

export async function findTokenById(
  db: DbOrTx,
  params: { id: string; workspaceId: string }
) {
  const [row] = await db
    .select({ token: apiTokens, member: members })
    .from(apiTokens)
    .innerJoin(members, eq(members.id, apiTokens.memberId))
    .where(
      and(
        eq(apiTokens.id, params.id),
        eq(apiTokens.workspaceId, params.workspaceId)
      )
    );
  return row;
}

export async function updateTokenById(
  db: DbOrTx,
  params: {
    id: string;
    set: Partial<Pick<ApiToken, "lastUsedAt" | "revokedAt">>;
  }
) {
  await db.update(apiTokens).set(params.set).where(eq(apiTokens.id, params.id));
}
