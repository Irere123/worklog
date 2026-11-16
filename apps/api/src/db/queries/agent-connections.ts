import { and, desc, eq, isNull } from "drizzle-orm";

import type { DbOrTx } from "#db";
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
} from "#db/auth-schema";
import { agentConnections, members } from "#db/schema";

export type AgentConnection = typeof agentConnections.$inferSelect;

/** What an OAuth client says about itself, and whether its domain stands behind it. */
export type AgentClient = {
  clientId: string;
  name: string | null;
  uri: string | null;
  softwareId: string | null;
  /** Its metadata is a document served from the domain in its id, not a self-registration. */
  verified: boolean;
};

export async function findAgentClient(
  db: DbOrTx,
  params: { clientId: string }
): Promise<AgentClient | undefined> {
  const [row] = await db
    .select({
      clientId: oauthClient.clientId,
      name: oauthClient.name,
      uri: oauthClient.uri,
      softwareId: oauthClient.softwareId,
      discovery: oauthClient.clientDiscoveryId,
      disabled: oauthClient.disabled,
    })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, params.clientId));
  if (!row || row.disabled === true) {
    return undefined;
  }
  return {
    clientId: row.clientId,
    name: row.name,
    uri: row.uri,
    softwareId: row.softwareId,
    verified: row.discovery !== null,
  };
}

export async function findAgentConnection(
  db: DbOrTx,
  params: { workspaceId: string; ownerId: string; clientId: string }
) {
  const [row] = await db
    .select({ connection: agentConnections, agent: members })
    .from(agentConnections)
    .innerJoin(members, eq(members.id, agentConnections.agentId))
    .where(
      and(
        eq(agentConnections.workspaceId, params.workspaceId),
        eq(agentConnections.ownerId, params.ownerId),
        eq(agentConnections.clientId, params.clientId)
      )
    );
  return row;
}

export async function findAgentConnectionById(
  db: DbOrTx,
  params: { id: string; workspaceId: string }
) {
  const [row] = await db
    .select({ connection: agentConnections, agent: members })
    .from(agentConnections)
    .innerJoin(members, eq(members.id, agentConnections.agentId))
    .where(
      and(
        eq(agentConnections.id, params.id),
        eq(agentConnections.workspaceId, params.workspaceId)
      )
    );
  return row;
}

/**
 * False when another first call made the same connection a moment earlier. It doesn't raise, so a
 * transaction it runs in stays usable.
 */
export async function insertAgentConnection(
  db: DbOrTx,
  row: typeof agentConnections.$inferInsert
) {
  const rows = await db
    .insert(agentConnections)
    .values(row)
    .onConflictDoNothing()
    .returning({ id: agentConnections.id });
  return rows.length > 0;
}

export async function listAgentConnections(
  db: DbOrTx,
  params: { workspaceId: string; ownerId?: string }
) {
  return await db
    .select({
      connection: agentConnections,
      agent: members,
      client: {
        name: oauthClient.name,
        uri: oauthClient.uri,
        discovery: oauthClient.clientDiscoveryId,
      },
    })
    .from(agentConnections)
    .innerJoin(members, eq(members.id, agentConnections.agentId))
    .leftJoin(oauthClient, eq(oauthClient.clientId, agentConnections.clientId))
    .where(
      and(
        eq(agentConnections.workspaceId, params.workspaceId),
        isNull(members.deactivatedAt),
        params.ownerId === undefined
          ? undefined
          : eq(agentConnections.ownerId, params.ownerId)
      )
    )
    .orderBy(desc(agentConnections.createdAt));
}

export async function touchAgentConnection(
  db: DbOrTx,
  params: { id: string; now: Date }
) {
  await db
    .update(agentConnections)
    .set({ lastUsedAt: params.now })
    .where(eq(agentConnections.id, params.id));
}

export async function setAgentActive(
  db: DbOrTx,
  params: { agentId: string; deactivatedAt: Date | null }
) {
  await db
    .update(members)
    .set({ deactivatedAt: params.deactivatedAt })
    .where(eq(members.id, params.agentId));
}

/**
 * Ends what one approval granted: its refresh tokens, so no new access token can be minted, and the
 * consent, so connecting again asks the person again. Access tokens are signed JWTs that can't be
 * recalled; the agent's deactivation turns them away until they expire.
 */
export async function revokeAgentGrant(
  db: DbOrTx,
  params: { clientId: string; userId: string; workspaceId: string; now: Date }
) {
  const grant = (table: typeof oauthRefreshToken | typeof oauthAccessToken) =>
    and(
      eq(table.clientId, params.clientId),
      eq(table.userId, params.userId),
      eq(table.referenceId, params.workspaceId),
      isNull(table.revoked)
    );
  await db
    .update(oauthRefreshToken)
    .set({ revoked: params.now })
    .where(grant(oauthRefreshToken));
  await db
    .update(oauthAccessToken)
    .set({ revoked: params.now })
    .where(grant(oauthAccessToken));
  await db
    .delete(oauthConsent)
    .where(
      and(
        eq(oauthConsent.clientId, params.clientId),
        eq(oauthConsent.userId, params.userId),
        eq(oauthConsent.referenceId, params.workspaceId)
      )
    );
}
