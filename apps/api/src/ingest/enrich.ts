import { getConnector } from "#connectors";
import { ProviderError } from "#connectors/http";
import type { AccountDetails, Connector } from "#connectors/types";
import type { AppContext } from "#context";
import { listActiveConnections } from "#db/queries/connections";
import {
  findIdentityById,
  updateIdentityDetails,
} from "#db/queries/identities";
import { listHumansByEmail } from "#db/queries/members";

import { loadApp } from "./apps";
import { linkIdentityToMember } from "./identity";
import { handleProviderError } from "./lifecycle";
import { viewOf } from "./view";

/**
 * Fills in what the provider's directory knows about an account first seen in events. An email
 * that belongs to exactly one person in the workspace links the account to them, and their history
 * with it: the high-confidence match, since the provider verified the address.
 */
export async function enrichIdentity(ctx: AppContext, identityId: string) {
  const identity = await findIdentityById(ctx.db, { id: identityId });
  const connector = identity ? getConnector(identity.provider) : undefined;
  if (!identity || !connector?.enrich) {
    return;
  }
  const details = await lookUp(ctx, connector, identity);
  if (!details) {
    return;
  }
  const email = details.email?.trim().toLowerCase() ?? null;
  await updateIdentityDetails(ctx.db, {
    id: identity.id,
    set: { ...filled(identity, details), email, enrichedAt: ctx.now() },
  });
  if (!identity.memberId && email && details.bot !== true) {
    await linkByEmail(ctx, identity, email);
  }
}

async function linkByEmail(
  ctx: AppContext,
  identity: { id: string; workspaceId: string },
  email: string
) {
  const people = await listHumansByEmail(ctx.db, {
    workspaceId: identity.workspaceId,
    email,
  });
  const [person] = people;
  if (people.length === 1 && person) {
    await linkIdentityToMember(
      ctx,
      identity.workspaceId,
      identity.id,
      person.id
    );
  }
}

// What events already said wins: the directory only fills gaps.
function filled(
  identity: {
    displayName: string | null;
    externalHandle: string | null;
    isBot: boolean;
  },
  details: AccountDetails
) {
  return {
    displayName: identity.displayName ?? details.name ?? null,
    externalHandle: identity.externalHandle ?? details.handle ?? null,
    isBot: details.bot ?? identity.isBot,
  };
}

/**
 * The account belongs to one of the workspace's connections for the provider (two Slack teams are
 * two connections), and identities don't say which: ask each until one knows it.
 */
async function lookUp(
  ctx: AppContext,
  connector: Connector,
  identity: { workspaceId: string; provider: string; externalId: string }
) {
  const { enrich } = connector;
  if (!enrich) {
    return null;
  }
  const app = connector.app ? await loadApp(ctx, identity.provider) : null;
  const conns = await listActiveConnections(ctx.db, {
    workspaceId: identity.workspaceId,
    provider: identity.provider,
  });
  for (const conn of conns) {
    try {
      const details = await enrich(
        ctx,
        viewOf(ctx, conn),
        app,
        identity.externalId
      );
      if (details) {
        return details;
      }
    } catch (error) {
      if (await handleProviderError(ctx, conn.id, error)) {
        continue;
      }
      if (conns.length === 1 || !(error instanceof ProviderError)) {
        throw error;
      }
    }
  }
  return null;
}
