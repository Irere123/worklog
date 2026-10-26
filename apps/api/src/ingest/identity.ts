import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import { account } from "../db/auth-schema";
import { activities, identities, members } from "../db/schema";
import { conflict, notFound } from "../lib/errors";
import { newId } from "../lib/ids";
import type { ExternalActor } from "./types";

export type IdentityRow = typeof identities.$inferSelect;

/** Logins compare case-insensitively; ids are stored as given. */
const handleKey = (handle: string) => `handle:${handle.toLowerCase()}`;

/** Sign-in providers whose account ids are the same ids their webhooks carry. */
const SIGN_IN_NAMESPACES = new Set(["github", "slack", "discord"]);

/**
 * Find or record the identity behind an actor, and the member it belongs to (if any).
 * Matching order: stable id → login → the account the person signed in with. Unknown actors are
 * still recorded (memberId null) so admins can link them later and get their history attributed.
 */
export async function resolveActor(ctx: AppContext, workspaceId: string, namespace: string, actor: ExternalActor, at: Date) {
  const handle = actor.handle?.toLowerCase() ?? null;
  const candidates = await ctx.db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.workspaceId, workspaceId),
        eq(identities.provider, namespace),
        or(eq(identities.externalId, actor.id), handle ? eq(identities.externalId, handleKey(handle)) : undefined),
      ),
    );
  const exact = candidates.find((i) => i.externalId === actor.id);
  // A manual link by login is a placeholder (`handle:<login>`) until the account is seen with its stable id.
  const placeholder = candidates.find((i) => i.externalId.startsWith("handle:"));
  let identity: IdentityRow | undefined = exact;

  if (!exact && placeholder) {
    // First sighting with a stable id: upgrade the placeholder in place. Only placeholders — an identity
    // that already has a different stable id is a different account (logins get reused after renames).
    [identity] = await ctx.db.update(identities).set({ externalId: actor.id }).where(eq(identities.id, placeholder.id)).returning();
  } else if (exact && placeholder && !exact.memberId && placeholder.memberId) {
    // Seen before linking, then linked by login: fold the link into the real identity and re-attribute.
    await ctx.db.delete(identities).where(eq(identities.id, placeholder.id));
    await linkIdentityToMember(ctx, workspaceId, exact.id, placeholder.memberId);
    identity = { ...exact, memberId: placeholder.memberId };
  }
  if (!identity) {
    [identity] = await ctx.db
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
    // Lost a race with a concurrent insert: use the row that won.
    identity ??= (
      await ctx.db
        .select()
        .from(identities)
        .where(and(eq(identities.workspaceId, workspaceId), eq(identities.provider, namespace), eq(identities.externalId, actor.id)))
    )[0]!;
  }
  let memberId = identity!.memberId;
  if (!memberId && SIGN_IN_NAMESPACES.has(namespace)) {
    const [signedIn] = await ctx.db
      .select({ id: members.id })
      .from(account)
      .innerJoin(members, and(eq(members.userId, account.userId), eq(members.workspaceId, workspaceId)))
      .where(and(eq(account.providerId, namespace), eq(account.accountId, actor.id)));
    memberId = signedIn?.id ?? null;
  }

  await ctx.db
    .update(identities)
    .set({
      memberId,
      externalHandle: actor.handle ?? identity!.externalHandle,
      displayName: actor.name ?? identity!.displayName,
      isBot: actor.bot ?? identity!.isBot,
      eventCount: sql`${identities.eventCount} + 1`,
      lastSeenAt: at,
      firstSeenAt: identity!.firstSeenAt ?? at,
    })
    .where(eq(identities.id, identity!.id));
  return { identityId: identity!.id, memberId, isBot: actor.bot ?? identity!.isBot };
}

/** Attach an identity to a member — and retroactively attribute everything it already did. */
export async function linkIdentityToMember(ctx: AppContext, workspaceId: string, identityId: string, memberId: string | null) {
  const [row] = await ctx.db
    .update(identities)
    .set({ memberId })
    .where(and(eq(identities.id, identityId), eq(identities.workspaceId, workspaceId)))
    .returning();
  if (!row) throw notFound("Identity");
  const updated = await ctx.db
    .update(activities)
    .set({ actorId: memberId })
    .where(eq(activities.actorIdentityId, identityId))
    .returning({ id: activities.id });
  return { identity: row, reattributed: updated.length };
}

/** Manual link from the API: by stable id and/or login. Re-attributes history if the identity was already seen. */
export async function linkByHandle(
  ctx: AppContext,
  workspaceId: string,
  memberId: string,
  input: { provider: string; externalId?: string | null; handle?: string | null },
) {
  // A GitHub-style login passed as the id (non-numeric) is really a handle.
  if (input.externalId && !input.handle && /^(github|gitea)/.test(input.provider) && !/^\d+$/.test(input.externalId)) {
    input = { ...input, handle: input.externalId, externalId: null };
  }
  const externalId = input.externalId ?? (input.handle ? handleKey(input.handle) : null);
  if (!externalId) throw conflict("Give an externalId or a handle");
  const handle = input.handle?.toLowerCase() ?? null;
  const [existing] = await ctx.db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.workspaceId, workspaceId),
        eq(identities.provider, input.provider),
        or(eq(identities.externalId, externalId), handle ? sql`lower(${identities.externalHandle}) = ${handle}` : undefined),
      ),
    );
  if (existing) {
    if (existing.memberId && existing.memberId !== memberId) throw conflict(`That ${input.provider} account is already linked to someone else`);
    return linkIdentityToMember(ctx, workspaceId, existing.id, memberId);
  }
  const [row] = await ctx.db
    .insert(identities)
    .values({
      id: newId("idn"),
      workspaceId,
      memberId,
      provider: input.provider,
      externalId,
      externalHandle: input.handle ?? null,
      createdAt: ctx.now(),
    })
    .returning();
  return { identity: row!, reattributed: 0 };
}

export async function listIdentities(ctx: AppContext, workspaceId: string, opts: { unlinked?: boolean; memberId?: string }) {
  return ctx.db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.workspaceId, workspaceId),
        opts.unlinked ? isNull(identities.memberId) : undefined,
        opts.memberId ? eq(identities.memberId, opts.memberId) : undefined,
      ),
    )
    .orderBy(desc(identities.eventCount))
    .limit(500);
}
