import { getConnector } from "#connectors";
import { isBuiltInNamespace } from "#connectors/namespaces";
import type { ExternalActor } from "#connectors/types";
import type { AppContext } from "#context";
import { updateActivitiesActor } from "#db/queries/activities";
import {
  deleteIdentityById,
  findIdentityByExternalIdOrHandle,
  listIdentitiesByHandles,
  insertIdentitiesIfNew,
  insertIdentity,
  insertIdentityIfNew,
  listIdentitiesByExternalIds,
  updateIdentityById,
  updateIdentityDetails,
} from "#db/queries/identities";
import type { Identity } from "#db/queries/identities";
import {
  fillMemberAvatars,
  findMemberBySignIn,
  listMembersBySignIn,
} from "#db/queries/members";
import { transact } from "#db/transact";
import { enqueue } from "#jobs/queue";
import { returned } from "#lib/assert";
import { conflict, notFound } from "#lib/errors";
import { generateId } from "#lib/ids";

const handleKey = (handle: string) => `handle:${handle.toLowerCase()}`;

const SIGN_IN_NAMESPACES = new Set(["github", "slack", "discord"]);

export async function resolveActor(
  ctx: AppContext,
  workspaceId: string,
  namespace: string,
  actor: ExternalActor,
  at: Date,
  opts: { sightings?: number; acted?: boolean; since?: Date } = {}
) {
  const { actor: said } = told(
    { actor, at, n: 1, acted: opts.acted },
    namespace
  );
  const identity =
    (await matchIdentity(ctx, workspaceId, namespace, said)) ??
    (await recordIdentity(
      ctx,
      workspaceId,
      namespace,
      said,
      opts.acted === false ? null : at
    ));
  const memberId =
    identity.memberId ??
    (await signedInMember(ctx, workspaceId, namespace, actor.id));
  return await sighted(
    ctx,
    {
      sighting: {
        actor,
        at,
        n: opts.sightings ?? 1,
        acted: opts.acted,
        since: opts.since,
      },
      identity,
    },
    memberId
  );
}

type Details = Pick<
  Identity,
  "memberId" | "externalHandle" | "displayName" | "isBot" | "avatarUrl"
>;

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
  if (next.avatarUrl !== current.avatarUrl) {
    set.avatarUrl = next.avatarUrl;
  }
  return Object.keys(set).length > 0 ? set : null;
}

/**
 * `acted`: seen doing something, not only named; only that counts as a sighting. `at` is when
 * last, `since` when first, when the sighting stands for several actions.
 */
export type Sighting = {
  actor: ExternalActor;
  at: Date;
  n: number;
  acted?: boolean;
  since?: Date;
};
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
    known.filter((k) => !k.identity.memberId).map((k) => k.identity.externalId)
  );
  for (const k of known) {
    const memberId =
      k.identity.memberId ?? signedIn.get(k.identity.externalId) ?? null;
    out.set(k.sighting.actor.id, await sighted(ctx, k, memberId));
  }
  for (const { actor, at, n, acted, since } of intricate) {
    out.set(
      actor.id,
      await resolveActor(ctx, workspaceId, namespace, actor, at, {
        sightings: n,
        acted,
        since,
      })
    );
  }
  return out;
}

function trustsLogin(sighting: Pick<Sighting, "acted">, namespace: string) {
  return sighting.acted !== false || isBuiltInNamespace(namespace);
}

function told(sighting: Sighting, namespace: string): Sighting {
  return trustsLogin(sighting, namespace)
    ? sighting
    : {
        ...sighting,
        actor: { id: sighting.actor.id, handle: null, name: null },
      };
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
  const byLogin = await accountsByLogin(ctx, workspaceId, namespace, sightings);
  const known: Known[] = [];
  const unseen: Sighting[] = [];
  const intricate: Sighting[] = [];
  for (const sighting of sightings) {
    const named = found.get(sighting.actor.id);
    const account = byLogin.get(sighting.actor.id);
    const exact =
      account && !(named?.memberId && !account.memberId) ? account : named;
    const key = trustsLogin(sighting, namespace)
      ? placeholderOf(sighting.actor)
      : null;
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

async function accountsByLogin(
  ctx: AppContext,
  workspaceId: string,
  namespace: string,
  sightings: Sighting[]
) {
  const logins = sightings
    .map((s) => s.actor.id)
    .filter((id) => id.startsWith("handle:"))
    .map((id) => id.slice("handle:".length));
  const out = new Map<string, Identity>();
  if (logins.length === 0) {
    return out;
  }
  const rows = await listIdentitiesByHandles(ctx.db, {
    workspaceId,
    provider: namespace,
    handles: logins,
  });
  for (const row of rows) {
    const key = handleKey(row.externalHandle ?? "");
    if (!out.has(key)) {
      out.set(key, row);
    }
  }
  return out;
}

async function sighted(
  ctx: AppContext,
  { sighting, identity }: Known,
  memberId: string | null
): Promise<Resolved> {
  const { actor, at, n } = sighting;
  const seen = sighting.acted !== false && actor.id === identity.externalId;
  const set = changes(identity, {
    memberId,
    externalHandle: seen
      ? (actor.handle ?? identity.externalHandle)
      : identity.externalHandle,
    displayName: seen
      ? (actor.name ?? identity.displayName)
      : identity.displayName,
    isBot: seen ? (actor.bot ?? identity.isBot) : identity.isBot,
    avatarUrl: seen
      ? (actor.avatarUrl ?? identity.avatarUrl)
      : identity.avatarUrl,
  });
  const avatarUrl = set?.avatarUrl ?? identity.avatarUrl;
  if (set?.memberId) {
    const linked = memberId;
    await transact(ctx, async (tx) => {
      await updateIdentityDetails(tx.db, { id: identity.id, set });
      await updateActivitiesActor(tx.db, {
        actorIdentityId: identity.id,
        actorId: linked,
      });
      await adoptAvatar(tx, linked, avatarUrl);
    });
  } else if (set) {
    await updateIdentityDetails(ctx.db, { id: identity.id, set });
    if (set.avatarUrl) {
      await adoptAvatar(ctx, memberId, avatarUrl);
    }
  }
  if (seen) {
    ctx.tally.sighted(identity.id, sighting.since ?? at, n);
    ctx.tally.sighted(identity.id, at, 0);
  }
  return {
    identityId: identity.id,
    memberId,
    isBot: seen ? (actor.bot ?? identity.isBot) : identity.isBot,
  };
}

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
    const ordered = sightings.toSorted((a, b) =>
      a.actor.id.localeCompare(b.actor.id)
    );
    const rows = await insertIdentitiesIfNew(
      tx.db,
      ordered.map((sighting) => {
        const { actor, at, since, acted } = told(sighting, namespace);
        return {
          id: generateId(),
          workspaceId,
          provider: namespace,
          externalId: actor.id,
          externalHandle: actor.handle ?? null,
          displayName: actor.name ?? null,
          isBot: actor.bot ?? false,
          avatarUrl: actor.avatarUrl ?? null,
          firstSeenAt: acted === false ? null : (since ?? at),
          createdAt: tx.now(),
        };
      })
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
  const placeholder = candidates.find((i) =>
    i.externalId.startsWith("handle:")
  );

  if (!exact && placeholder) {
    return await updateIdentityById(ctx.db, {
      id: placeholder.id,
      set: { externalId: actor.id },
    });
  }
  if (exact && placeholder && !exact.memberId && placeholder.memberId) {
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
  seenAt: Date | null
): Promise<Identity> {
  const created = await transact(ctx, async (tx) => {
    const row = await insertIdentityIfNew(tx.db, {
      id: generateId(),
      workspaceId,
      provider: namespace,
      externalId: actor.id,
      externalHandle: actor.handle ?? null,
      displayName: actor.name ?? null,
      isBot: actor.bot ?? false,
      avatarUrl: actor.avatarUrl ?? null,
      firstSeenAt: seenAt,
      createdAt: tx.now(),
    });
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
    await adoptAvatar(tx, memberId, row.avatarUrl);
    return { identity: row, reattributed };
  });
}

/** A linked account's picture becomes the person's, unless they already have one. */
export async function adoptAvatar(
  ctx: AppContext,
  memberId: string | null,
  avatarUrl: string | null
) {
  if (memberId && avatarUrl) {
    await fillMemberAvatars(ctx.db, { ids: [memberId], avatarUrl });
  }
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
  const link =
    input.externalId &&
    !input.handle &&
    /^(?:github|gitea|gitlab)/u.test(input.provider) &&
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
    id: generateId(),
    workspaceId,
    memberId,
    provider: link.provider,
    externalId,
    externalHandle: link.handle ?? null,
    createdAt: ctx.now(),
  });
  return { identity, reattributed: 0 };
}
