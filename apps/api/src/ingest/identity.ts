import { getConnector } from "#connectors";
import type { ExternalActor } from "#connectors/types";
import type { AppContext } from "#context";
import { updateActivitiesActor } from "#db/queries/activities";
import {
  deleteIdentityById,
  findIdentityByExternalIdOrHandle,
  insertIdentitiesIfNew,
  insertIdentity,
  insertIdentityIfNew,
  listIdentitiesByExternalIds,
  updateIdentityById,
  updateIdentityDetails,
} from "#db/queries/identities";
import type { Identity } from "#db/queries/identities";
import { findMemberBySignIn, listMembersBySignIn } from "#db/queries/members";
import { transact } from "#db/transact";
import { enqueue } from "#jobs/queue";
import { returned } from "#lib/assert";
import { conflict, notFound } from "#lib/errors";
import { newId } from "#lib/ids";

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
  at: Date,
  sightings = 1
) {
  const identity =
    (await matchIdentity(ctx, workspaceId, namespace, actor)) ??
    (await recordIdentity(ctx, workspaceId, namespace, actor, at));
  const memberId =
    identity.memberId ??
    (await signedInMember(ctx, workspaceId, namespace, actor.id));
  return await sighted(
    ctx,
    { sighting: { actor, at, n: sightings }, identity },
    memberId
  );
}

type Details = Pick<
  Identity,
  "memberId" | "externalHandle" | "displayName" | "isBot"
>;

// Most sightings change nothing, and a write per sighting would make a busy bot's row the one every
// event waits on.
function changes(current: Identity, next: Details): Partial<Details> | null {
  const set: Partial<Details> = {};
  if (next.memberId !== current.memberId) {
    set.memberId = next.memberId;
  }
  if (next.externalHandle !== current.externalHandle) {
    set.externalHandle = next.externalHandle;
  }
  if (next.displayName !== current.displayName) {
    set.displayName = next.displayName;
  }
  if (next.isBot !== current.isBot) {
    set.isBot = next.isBot;
  }
  return Object.keys(set).length > 0 ? set : null;
}

export type Sighting = { actor: ExternalActor; at: Date; n: number };
export type Resolved = {
  identityId: string;
  memberId: string | null;
  isBot: boolean;
};

const placeholderOf = (a: ExternalActor) =>
  a.handle ? handleKey(a.handle) : null;

type Known = { sighting: Sighting; identity: Identity };

/**
 * `resolveActor` for everyone a delivery names, in a few queries for all of them instead of a few
 * each: one to find their identities, one for new accounts, one for sign-ins. A login placeholder
 * that needs upgrading or folding is rare, and goes through `resolveActor` itself.
 */
export async function resolveActors(
  ctx: AppContext,
  workspaceId: string,
  namespace: string,
  sightings: Sighting[]
): Promise<Map<string, Resolved>> {
  const out = new Map<string, Resolved>();
  if (sightings.length === 0) {
    return out;
  }
  const { known, unseen, intricate } = await sortSightings(
    ctx,
    workspaceId,
    namespace,
    sightings
  );
  known.push(...(await recordIdentities(ctx, workspaceId, namespace, unseen)));
  const signedIn = await signedInMembers(
    ctx,
    workspaceId,
    namespace,
    known.filter((k) => !k.identity.memberId).map((k) => k.sighting.actor.id)
  );
  for (const k of known) {
    const memberId =
      k.identity.memberId ?? signedIn.get(k.sighting.actor.id) ?? null;
    out.set(k.sighting.actor.id, await sighted(ctx, k, memberId));
  }
  for (const { actor, at, n } of intricate) {
    out.set(
      actor.id,
      await resolveActor(ctx, workspaceId, namespace, actor, at, n)
    );
  }
  return out;
}

async function sortSightings(
  ctx: AppContext,
  workspaceId: string,
  namespace: string,
  sightings: Sighting[]
) {
  const wanted = new Set<string>();
  for (const { actor } of sightings) {
    wanted.add(actor.id);
    const placeholder = placeholderOf(actor);
    if (placeholder) {
      wanted.add(placeholder);
    }
  }
  const rows = await listIdentitiesByExternalIds(ctx.db, {
    workspaceId,
    provider: namespace,
    externalIds: [...wanted],
  });
  const found = new Map(rows.map((i) => [i.externalId, i]));
  const known: Known[] = [];
  const unseen: Sighting[] = [];
  const intricate: Sighting[] = [];
  for (const sighting of sightings) {
    const exact = found.get(sighting.actor.id);
    const key = placeholderOf(sighting.actor);
    const placeholder =
      key && key !== sighting.actor.id ? found.get(key) : undefined;
    if (placeholder && (!exact || (!exact.memberId && placeholder.memberId))) {
      intricate.push(sighting);
    } else if (exact) {
      known.push({ sighting, identity: exact });
    } else {
      unseen.push(sighting);
    }
  }
  return { known, unseen, intricate };
}

async function sighted(
  ctx: AppContext,
  { sighting, identity }: Known,
  memberId: string | null
): Promise<Resolved> {
  const { actor, at, n } = sighting;
  const set = changes(identity, {
    memberId,
    externalHandle: actor.handle ?? identity.externalHandle,
    displayName: actor.name ?? identity.displayName,
    isBot: actor.bot ?? identity.isBot,
  });
  if (set) {
    await updateIdentityDetails(ctx.db, { id: identity.id, set });
  }
  ctx.tally.sighted(identity.id, at, n);
  return {
    identityId: identity.id,
    memberId,
    isBot: actor.bot ?? identity.isBot,
  };
}

// One insert for every new account; those another delivery created first are read back.
async function recordIdentities(
  ctx: AppContext,
  workspaceId: string,
  namespace: string,
  sightings: Sighting[]
): Promise<Known[]> {
  if (sightings.length === 0) {
    return [];
  }
  const enrich = Boolean(getConnector(namespace)?.enrich);
  const created = await transact(ctx, async (tx) => {
    // In one order everywhere: two lanes inserting the same new people mustn't deadlock.
    const ordered = sightings.toSorted((a, b) =>
      a.actor.id.localeCompare(b.actor.id)
    );
    const rows = await insertIdentitiesIfNew(
      tx.db,
      ordered.map(({ actor, at }) => ({
        id: newId("idn"),
        workspaceId,
        provider: namespace,
        externalId: actor.id,
        externalHandle: actor.handle ?? null,
        displayName: actor.name ?? null,
        isBot: actor.bot ?? false,
        firstSeenAt: at,
        createdAt: tx.now(),
      }))
    );
    for (const row of rows) {
      if (enrich && !row.externalId.startsWith("handle:")) {
        await enqueue(
          tx,
          "identity:enrich",
          { identityId: row.id },
          { maxAttempts: 3 }
        );
      }
    }
    return rows;
  });
  const byId = new Map(created.map((i) => [i.externalId, i]));
  const lost = sightings.filter((s) => !byId.has(s.actor.id));
  if (lost.length > 0) {
    const winners = await listIdentitiesByExternalIds(ctx.db, {
      workspaceId,
      provider: namespace,
      externalIds: lost.map((s) => s.actor.id),
    });
    for (const winner of winners) {
      byId.set(winner.externalId, winner);
    }
  }
  return sightings.flatMap((sighting) => {
    const identity = byId.get(sighting.actor.id);
    return identity ? [{ sighting, identity }] : [];
  });
}

async function signedInMembers(
  ctx: AppContext,
  workspaceId: string,
  namespace: string,
  accountIds: string[]
) {
  if (!SIGN_IN_NAMESPACES.has(namespace) || accountIds.length === 0) {
    return new Map<string, string>();
  }
  const rows = await listMembersBySignIn(ctx.db, {
    workspaceId,
    provider: namespace,
    accountIds,
  });
  return new Map(rows.map((r) => [r.accountId, r.member.id]));
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
  const created = await transact(ctx, async (tx) => {
    const row = await insertIdentityIfNew(tx.db, {
      id: newId("idn"),
      workspaceId,
      provider: namespace,
      externalId: actor.id,
      externalHandle: actor.handle ?? null,
      displayName: actor.name ?? null,
      isBot: actor.bot ?? false,
      firstSeenAt: at,
      createdAt: tx.now(),
    });
    // Where the provider has a directory, look the account up once: its email can link it.
    if (
      row &&
      getConnector(namespace)?.enrich &&
      !actor.id.startsWith("handle:")
    ) {
      await enqueue(
        tx,
        "identity:enrich",
        { identityId: row.id },
        { maxAttempts: 3 }
      );
    }
    return row;
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
