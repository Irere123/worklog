import { and, asc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";

import type { DbOrTx } from "#db";
import { account } from "#db/auth-schema";
import { violates } from "#db/errors";
import { identities, members, workspaces } from "#db/schema";
import { returned } from "#lib/assert";
import { conflict, notFound } from "#lib/errors";

export type Member = typeof members.$inferSelect;

export const WORKLOG_AGENT = "worklog";

const active = isNull(members.deactivatedAt);

export async function insertMembers(
  db: DbOrTx,
  rows: (typeof members.$inferInsert)[]
) {
  try {
    await db.insert(members).values(rows);
  } catch (error) {
    if (violates(error, "members_handle_uq")) {
      throw conflict("That handle is taken");
    }
    throw error;
  }
}

export async function updateMemberById(
  db: DbOrTx,
  params: {
    id: string;
    set: Partial<
      Pick<
        Member,
        "name" | "email" | "title" | "timezone" | "settings" | "avatarUrl"
      >
    >;
  }
) {
  const rows = await db
    .update(members)
    .set(params.set)
    .where(eq(members.id, params.id))
    .returning();
  return returned(rows, "member");
}

export async function fillMemberAvatars(
  db: DbOrTx,
  params: { ids: string[]; avatarUrl: string }
) {
  if (!params.ids.length) {
    return;
  }
  await db
    .update(members)
    .set({ avatarUrl: params.avatarUrl })
    .where(and(inArray(members.id, params.ids), isNull(members.avatarUrl)));
}

export async function listMembers(
  db: DbOrTx,
  params: {
    workspaceId: string;
    kind?: Member["kind"];
    includeDeactivated?: boolean;
  }
) {
  return await db
    .select()
    .from(members)
    .where(
      and(
        eq(members.workspaceId, params.workspaceId),
        params.includeDeactivated === true ? undefined : active,
        params.kind ? eq(members.kind, params.kind) : undefined
      )
    )
    .orderBy(members.createdAt);
}

export async function findMemberById(
  db: DbOrTx,
  params: { id: string; workspaceId?: string }
) {
  const [row] = await db
    .select()
    .from(members)
    .where(
      and(
        eq(members.id, params.id),
        params.workspaceId
          ? eq(members.workspaceId, params.workspaceId)
          : undefined
      )
    );
  return row;
}

export async function listMembersByHandles(
  db: DbOrTx,
  params: { workspaceId: string; handles: string[] }
) {
  if (!params.handles.length) {
    return [];
  }
  return await db
    .select()
    .from(members)
    .where(
      and(
        eq(members.workspaceId, params.workspaceId),
        inArray(members.handle, params.handles)
      )
    );
}

export async function findMemberByIdOrHandle(
  db: DbOrTx,
  params: { workspaceId: string; id: string; handle: string }
) {
  const [row] = await db
    .select()
    .from(members)
    .where(
      and(
        eq(members.workspaceId, params.workspaceId),
        or(eq(members.id, params.id), eq(members.handle, params.handle))
      )
    );
  return row;
}

export async function listHandlesLike(
  db: DbOrTx,
  params: { workspaceId: string; root: string }
) {
  const rows = await db
    .select({ handle: members.handle })
    .from(members)
    .where(
      and(
        eq(members.workspaceId, params.workspaceId),
        or(
          eq(members.handle, params.root),
          like(members.handle, `${params.root}-%`)
        )
      )
    );
  return rows.map((r) => r.handle);
}

export async function getPersonalAgent(
  db: DbOrTx,
  params: { ownerId: string }
) {
  const [agent] = await db
    .select()
    .from(members)
    .where(
      and(
        eq(members.ownerId, params.ownerId),
        eq(members.agentProvider, WORKLOG_AGENT)
      )
    );
  if (!agent) {
    throw notFound("Assistant");
  }
  return agent;
}

export async function listMemberships(db: DbOrTx, params: { userId: string }) {
  return await db
    .select({ member: members, workspace: workspaces })
    .from(members)
    .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
    .where(and(eq(members.userId, params.userId), active))
    .orderBy(asc(members.createdAt));
}

export async function listPendingInvites(
  db: DbOrTx,
  params: { email: string }
) {
  return await db
    .select()
    .from(members)
    .where(
      and(
        isNull(members.userId),
        eq(members.kind, "human"),
        active,
        sql`lower(${members.email}) = ${params.email.toLowerCase()}`
      )
    );
}

export async function setInviteNonce(
  db: DbOrTx,
  params: { id: string; nonce: string }
) {
  await db
    .update(members)
    .set({ inviteNonce: params.nonce })
    .where(eq(members.id, params.id));
}

/** Undefined when someone else claimed it first or it was removed. */
export async function claimInvite(
  db: DbOrTx,
  params: { id: string; userId: string; email: string | null }
) {
  const [row] = await db
    .update(members)
    .set({
      userId: params.userId,
      inviteNonce: null,
      ...(params.email === null ? {} : { email: params.email }),
    })
    .where(and(eq(members.id, params.id), isNull(members.userId), active))
    .returning();
  return row;
}

export async function setMembersUser(
  db: DbOrTx,
  params: { ids: string[]; userId: string }
) {
  if (!params.ids.length) {
    return;
  }
  await db
    .update(members)
    .set({ userId: params.userId })
    .where(inArray(members.id, params.ids));
}

export async function findMemberByIdentity(
  db: DbOrTx,
  params: {
    workspaceId: string;
    provider: string;
    externalIds: string | string[];
  }
) {
  const { workspaceId, provider, externalIds } = params;
  const ids = [
    ...new Set(
      (Array.isArray(externalIds) ? externalIds : [externalIds]).filter(Boolean)
    ),
  ];
  const normalized =
    provider === "github" ? ids.map((i) => i.toLowerCase()) : ids;
  const [linked] = ids.length
    ? await db
        .select({ member: members })
        .from(identities)
        .innerJoin(members, eq(members.id, identities.memberId))
        .where(
          and(
            eq(identities.workspaceId, workspaceId),
            eq(identities.provider, provider),
            inArray(identities.externalId, normalized)
          )
        )
    : [];
  return (
    linked?.member ??
    (await findMemberBySignIn(db, { workspaceId, provider, accountIds: ids }))
  );
}

export async function findMemberBySignIn(
  db: DbOrTx,
  params: { workspaceId: string; provider: string; accountIds: string[] }
) {
  const [row] = params.accountIds.length
    ? await db
        .select({ member: members })
        .from(account)
        .innerJoin(
          members,
          and(
            eq(members.userId, account.userId),
            eq(members.workspaceId, params.workspaceId)
          )
        )
        .where(
          and(
            eq(account.providerId, params.provider),
            inArray(account.accountId, params.accountIds)
          )
        )
    : [];
  return row?.member;
}

export async function findWorkspaceOwner(
  db: DbOrTx,
  params: { workspaceId: string }
) {
  const [row] = await db
    .select()
    .from(members)
    .where(
      and(
        eq(members.workspaceId, params.workspaceId),
        eq(members.kind, "human"),
        eq(members.role, "owner"),
        active
      )
    )
    .orderBy(asc(members.createdAt))
    .limit(1);
  return row;
}

export async function listHumansByEmail(
  db: DbOrTx,
  params: { workspaceId: string; email: string }
) {
  return await db
    .select()
    .from(members)
    .where(
      and(
        eq(members.workspaceId, params.workspaceId),
        eq(members.kind, "human"),
        sql`lower(${members.email}) = ${params.email.toLowerCase()}`,
        active
      )
    )
    .limit(2);
}

export async function listMembersBySignIn(
  db: DbOrTx,
  params: { workspaceId: string; provider: string; accountIds: string[] }
) {
  if (params.accountIds.length === 0) {
    return [];
  }
  return await db
    .select({ accountId: account.accountId, member: members })
    .from(account)
    .innerJoin(
      members,
      and(
        eq(members.userId, account.userId),
        eq(members.workspaceId, params.workspaceId)
      )
    )
    .where(
      and(
        eq(account.providerId, params.provider),
        inArray(account.accountId, params.accountIds)
      )
    );
}

export async function listMembersByIds(db: DbOrTx, params: { ids: string[] }) {
  if (params.ids.length === 0) {
    return [];
  }
  return await db.select().from(members).where(inArray(members.id, params.ids));
}
