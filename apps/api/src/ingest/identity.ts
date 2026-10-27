import type { AppContext } from "#context";
import { updateActivitiesActor } from "#db/queries/activities";
import {
  deleteIdentityById,
  findIdentityByExternalIdOrHandle,
  insertIdentity,
  insertIdentityIfNew,
  listIdentitiesByExternalIds,
  updateIdentityById,
  updateIdentitySighting,
} from "#db/queries/identities";
import type { Identity } from "#db/queries/identities";
import { findMemberBySignIn } from "#db/queries/members";
import { transact } from "#db/transact";
import { returned } from "#lib/assert";
import { conflict, notFound } from "#lib/errors";
import { newId } from "#lib/ids";

import type { ExternalActor } from "./types";

/** Logins compare case-insensitively; ids are stored as given. */
const handleKey = (handle: string) => `handle:${handle.toLowerCase()}`;

/** Sign-in providers whose account ids are the same ids their webhooks carry. */
const SIGN_IN_NAMESPACES = new Set(["github", "slack", "discord"]);

// Unknown actors are still recorded (memberId null) so admins can link them later and get their history attributed.
export async function resolveActor(
  ctx: AppContext,
  workspaceId: string,
  namespace: string,
  actor: ExternalActor,
  at: Date
) {
  const identity =
    (await matchIdentity(ctx, workspaceId, namespace, actor)) ??
    (await recordIdentity(ctx, workspaceId, namespace, actor, at));
  const memberId =
    identity.memberId ??
    (await signedInMember(ctx, workspaceId, namespace, actor.id));

  await updateIdentitySighting(ctx.db, {
    id: identity.id,
    set: {
      memberId,
      externalHandle: actor.handle ?? identity.externalHandle,
      displayName: actor.name ?? identity.displayName,
      isBot: actor.bot ?? identity.isBot,
      lastSeenAt: at,
      firstSeenAt: identity.firstSeenAt ?? at,
    },
  });
  return {
    identityId: identity.id,
    memberId,
    isBot: actor.bot ?? identity.isBot,
  };
}

async function matchIdentity(
  ctx: AppContext,
  workspaceId: string,
  namespace: string,
  actor: ExternalActor
): Promise<Identity | undefined> {
  const handle = actor.handle?.toLowerCase() ?? null;
  const candidates = await listIdentitiesByExternalIds(ctx.db, {
    workspaceId,
    provider: namespace,
    externalIds: handle ? [actor.id, handleKey(handle)] : [actor.id],
  });
  const exact = candidates.find((i) => i.externalId === actor.id);
  // A manual link by login is a placeholder (`handle:<login>`) until the account is seen with its stable id.
  const placeholder = candidates.find((i) =>
    i.externalId.startsWith("handle:")
  );

  if (!exact && placeholder) {
    // First sighting with a stable id: upgrade the placeholder in place. Only placeholders — an identity
    // that already has a different stable id is a different account (logins get reused after renames).
    return await updateIdentityById(ctx.db, {
      id: placeholder.id,
      set: { externalId: actor.id },
    });
  }
  if (exact && placeholder && !exact.memberId && placeholder.memberId) {
    // Seen before linking, then linked by login: fold the link into the real identity and re-attribute.
    const { memberId } = placeholder;
    await transact(ctx, async (tx) => {
      await deleteIdentityById(tx.db, { id: placeholder.id });
      await linkIdentityToMember(tx, workspaceId, exact.id, memberId);
    });
    return { ...exact, memberId };
  }
  return exact;
}

async function recordIdentity(
  ctx: AppContext,
  workspaceId: string,
  namespace: string,
  actor: ExternalActor,
  at: Date
): Promise<Identity> {
  const created = await insertIdentityIfNew(ctx.db, {
    id: newId("idn"),
    workspaceId,
    provider: namespace,
    externalId: actor.id,
    externalHandle: actor.handle ?? null,
    displayName: actor.name ?? null,
    isBot: actor.bot ?? false,
    firstSeenAt: at,
    createdAt: ctx.now(),
  });
  if (created) {
    return created;
  }
  // Lost a race with a concurrent insert: use the row that won.
  const winner = await listIdentitiesByExternalIds(ctx.db, {
    workspaceId,
    provider: namespace,
    externalIds: [actor.id],
  });
  return returned(winner, "identity");
}

async function signedInMember(
  ctx: AppContext,
  workspaceId: string,
  namespace: string,
  accountId: string
) {
  if (!SIGN_IN_NAMESPACES.has(namespace)) {
    return null;
  }
  // Only reached for an identity with no member, so the explicit-link lookup can't match.
  const signedIn = await findMemberBySignIn(ctx.db, {
    workspaceId,
    provider: namespace,
    accountIds: [accountId],
  });
  return signedIn?.id ?? null;
}

export async function linkIdentityToMember(
  ctx: AppContext,
  workspaceId: string,
  identityId: string,
  memberId: string | null
) {
  return await transact(ctx, async (tx) => {
    const row = await updateIdentityById(tx.db, {
      id: identityId,
      workspaceId,
      set: { memberId },
    });
    if (!row) {
      throw notFound("Identity");
    }
    const reattributed = await updateActivitiesActor(tx.db, {
      actorIdentityId: identityId,
      actorId: memberId,
    });
    return { identity: row, reattributed };
  });
}

export async function linkByHandle(
  ctx: AppContext,
  workspaceId: string,
  memberId: string,
  input: {
    provider: string;
    externalId?: string | null;
    handle?: string | null;
  }
) {
  // A GitHub-style login passed as the id (non-numeric) is really a handle.
  const link =
    input.externalId &&
    !input.handle &&
    /^(?:github|gitea)/u.test(input.provider) &&
    !/^\d+$/u.test(input.externalId)
      ? { ...input, handle: input.externalId, externalId: null }
      : input;
  const externalId =
    link.externalId ?? (link.handle ? handleKey(link.handle) : null);
  if (!externalId) {
    throw conflict("Give an externalId or a handle");
  }
  const handle = link.handle?.toLowerCase() ?? null;
  const existing = await findIdentityByExternalIdOrHandle(ctx.db, {
    workspaceId,
    provider: link.provider,
    externalId,
    handle,
  });
  if (existing) {
    if (existing.memberId && existing.memberId !== memberId) {
      throw conflict(
        `That ${link.provider} account is already linked to someone else`
      );
    }
    return await linkIdentityToMember(ctx, workspaceId, existing.id, memberId);
  }
  const identity = await insertIdentity(ctx.db, {
    id: newId("idn"),
    workspaceId,
    memberId,
    provider: link.provider,
    externalId,
    externalHandle: link.handle ?? null,
    createdAt: ctx.now(),
  });
  return { identity, reattributed: 0 };
}
