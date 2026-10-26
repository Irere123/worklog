import { and, desc, eq, isNull, or, sql } from "drizzle-orm";

import type { AppContext } from "#context";
import { account } from "#db/auth-schema";
import { activities, identities, members } from "#db/schema";
import { returned } from "#lib/assert";
import { conflict, notFound } from "#lib/errors";
import { newId } from "#lib/ids";

import type { ExternalActor } from "./types";

export type IdentityRow = typeof identities.$inferSelect;

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

  await ctx.db
    .update(identities)
    .set({
      memberId,
      externalHandle: actor.handle ?? identity.externalHandle,
      displayName: actor.name ?? identity.displayName,
      isBot: actor.bot ?? identity.isBot,
      eventCount: sql`${identities.eventCount} + 1`,
      lastSeenAt: at,
      firstSeenAt: identity.firstSeenAt ?? at,
    })
    .where(eq(identities.id, identity.id));
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
): Promise<IdentityRow | undefined> {
  const handle = actor.handle?.toLowerCase() ?? null;
  const candidates = await ctx.db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.workspaceId, workspaceId),
        eq(identities.provider, namespace),
        or(
          eq(identities.externalId, actor.id),
          handle ? eq(identities.externalId, handleKey(handle)) : undefined
        )
      )
    );
  const exact = candidates.find((i) => i.externalId === actor.id);
  // A manual link by login is a placeholder (`handle:<login>`) until the account is seen with its stable id.
  const placeholder = candidates.find((i) =>
    i.externalId.startsWith("handle:")
  );

  if (!exact && placeholder) {
    // First sighting with a stable id: upgrade the placeholder in place. Only placeholders — an identity
    // that already has a different stable id is a different account (logins get reused after renames).
    const [upgraded] = await ctx.db
      .update(identities)
      .set({ externalId: actor.id })
      .where(eq(identities.id, placeholder.id))
      .returning();
    return upgraded;
  }
  if (exact && placeholder && !exact.memberId && placeholder.memberId) {
    // Seen before linking, then linked by login: fold the link into the real identity and re-attribute.
    await ctx.db.delete(identities).where(eq(identities.id, placeholder.id));
    await linkIdentityToMember(
      ctx,
      workspaceId,
      exact.id,
      placeholder.memberId
    );
    return { ...exact, memberId: placeholder.memberId };
  }
  return exact;
}

async function recordIdentity(
  ctx: AppContext,
  workspaceId: string,
  namespace: string,
  actor: ExternalActor,
  at: Date
): Promise<IdentityRow> {
  const [created] = await ctx.db
    .insert(identities)
    .values({
      id: newId("idn"),
      workspaceId,
      provider: namespace,
      externalId: actor.id,
      externalHandle: actor.handle ?? null,
      displayName: actor.name ?? null,
      isBot: actor.bot ?? false,
      firstSeenAt: at,
      createdAt: ctx.now(),
    })
    .onConflictDoNothing()
    .returning();
  if (created) {
    return created;
  }
  // Lost a race with a concurrent insert: use the row that won.
  const winner = await ctx.db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.workspaceId, workspaceId),
        eq(identities.provider, namespace),
        eq(identities.externalId, actor.id)
      )
    );
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
  const [signedIn] = await ctx.db
    .select({ id: members.id })
    .from(account)
    .innerJoin(
      members,
      and(
        eq(members.userId, account.userId),
        eq(members.workspaceId, workspaceId)
      )
    )
    .where(
      and(eq(account.providerId, namespace), eq(account.accountId, accountId))
    );
  return signedIn?.id ?? null;
}

export async function linkIdentityToMember(
  ctx: AppContext,
  workspaceId: string,
  identityId: string,
  memberId: string | null
) {
  const [row] = await ctx.db
    .update(identities)
    .set({ memberId })
    .where(
      and(
        eq(identities.id, identityId),
        eq(identities.workspaceId, workspaceId)
      )
    )
    .returning();
  if (!row) {
    throw notFound("Identity");
  }
  const updated = await ctx.db
    .update(activities)
    .set({ actorId: memberId })
    .where(eq(activities.actorIdentityId, identityId))
    .returning({ id: activities.id });
  return { identity: row, reattributed: updated.length };
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
  const [existing] = await ctx.db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.workspaceId, workspaceId),
        eq(identities.provider, link.provider),
        or(
          eq(identities.externalId, externalId),
          handle
            ? sql`lower(${identities.externalHandle}) = ${handle}`
            : undefined
        )
      )
    );
  if (existing) {
    if (existing.memberId && existing.memberId !== memberId) {
      throw conflict(
        `That ${link.provider} account is already linked to someone else`
      );
    }
    return await linkIdentityToMember(ctx, workspaceId, existing.id, memberId);
  }
  const created = await ctx.db
    .insert(identities)
    .values({
      id: newId("idn"),
      workspaceId,
      memberId,
      provider: link.provider,
      externalId,
      externalHandle: link.handle ?? null,
      createdAt: ctx.now(),
    })
    .returning();
  return { identity: returned(created, "identity"), reattributed: 0 };
}

export async function listIdentities(
  ctx: AppContext,
  workspaceId: string,
  opts: { unlinked?: boolean; memberId?: string }
) {
  return await ctx.db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.workspaceId, workspaceId),
        opts.unlinked === true ? isNull(identities.memberId) : undefined,
        opts.memberId ? eq(identities.memberId, opts.memberId) : undefined
      )
    )
    .orderBy(desc(identities.eventCount))
    .limit(500);
}
