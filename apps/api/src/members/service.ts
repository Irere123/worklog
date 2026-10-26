import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";

import { createDefaultAutomations } from "#automations/service";
import type { AppContext } from "#context";
import { account } from "#db/auth-schema";
import {
  API_SCOPES,
  apiTokens,
  deliveryTargets,
  identities,
  members,
  workspaces,
} from "#db/schema";
import type { ApiScope, MemberSettings } from "#db/schema";
import { returned } from "#lib/assert";
import { generateToken, hashToken } from "#lib/crypto";
import { badRequest, conflict, forbidden, notFound } from "#lib/errors";
import { newId } from "#lib/ids";
import { isValidTimeZone } from "#lib/time";

export type Member = typeof members.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;

export const WORKLOG_AGENT = "worklog";

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replaceAll(/[^a-z0-9]+/gu, "-")
      .replaceAll(/^-+|-+$/gu, "")
      .slice(0, 32) || "member"
  );
}

function localPart(email: string) {
  const [local = email] = email.split("@");
  return local;
}

async function uniqueHandle(
  ctx: AppContext,
  workspaceId: string,
  base: string
) {
  const root = slugify(base);
  for (let i = 0; i < 50; i += 1) {
    const handle = i === 0 ? root : `${root}-${i + 1}`;
    const [taken] = await ctx.db
      .select({ id: members.id })
      .from(members)
      .where(
        and(eq(members.workspaceId, workspaceId), eq(members.handle, handle))
      );
    if (!taken) {
      return handle;
    }
  }
  throw conflict("Could not find a free handle");
}

async function createWorkspace(
  ctx: AppContext,
  input: { name: string; timezone?: string }
) {
  const timezone = input.timezone ?? "UTC";
  if (!isValidTimeZone(timezone)) {
    throw badRequest(`Unknown time zone ${timezone}`);
  }
  const workspace: Workspace = {
    id: newId("ws"),
    name: input.name,
    slug: `${slugify(input.name)}-${newId("ws").slice(-6)}`,
    timezone,
    entropyDays: 30,
    cardSeq: 0,
    createdAt: ctx.now(),
  };
  await ctx.db.insert(workspaces).values(workspace);
  return workspace;
}

export async function setupWorkspace(
  ctx: AppContext,
  input: {
    workspaceName: string;
    name: string;
    email?: string | null;
    handle?: string;
    timezone?: string;
  }
) {
  const workspace = await createWorkspace(ctx, {
    name: input.workspaceName,
    timezone: input.timezone,
  });
  const owner = await createMember(ctx, workspace.id, {
    kind: "human",
    role: "owner",
    name: input.name,
    handle: input.handle,
    email: input.email ?? null,
    timezone: workspace.timezone,
  });
  const token = await createToken(ctx, owner, "setup");
  return {
    workspace,
    member: owner,
    assistant: await personalAgentOf(ctx, owner.id),
    token,
  };
}

export type SignedInUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
};

export async function createWorkspaceForUser(
  ctx: AppContext,
  user: SignedInUser,
  input: { name: string; timezone?: string; handle?: string }
) {
  const workspace = await createWorkspace(ctx, input);
  const owner = await createMember(ctx, workspace.id, {
    kind: "human",
    role: "owner",
    name: user.name || localPart(user.email),
    handle: input.handle ?? localPart(user.email),
    email: user.email,
    timezone: workspace.timezone,
    userId: user.id,
  });
  return { workspace, member: owner };
}

// Claimed on sign-in with the same verified email (magic link, or a provider reporting a verified address).
export async function claimMemberships(ctx: AppContext, user: SignedInUser) {
  if (!user.emailVerified) {
    return 0;
  }
  const pending = await ctx.db
    .select()
    .from(members)
    .where(
      and(
        isNull(members.userId),
        eq(members.kind, "human"),
        isNull(members.deactivatedAt),
        sql`lower(${members.email}) = ${user.email.toLowerCase()}`
      )
    );
  const memberships = await membershipsOf(ctx, user.id);
  const already = new Set(memberships.map((m) => m.member.workspaceId));
  let claimed = 0;
  for (const m of pending) {
    if (already.has(m.workspaceId)) {
      continue;
    }
    await ctx.db
      .update(members)
      .set({ userId: user.id })
      .where(eq(members.id, m.id));
    already.add(m.workspaceId);
    claimed += 1;
  }
  return claimed;
}

export async function membershipsOf(ctx: AppContext, userId: string) {
  return await ctx.db
    .select({ member: members, workspace: workspaces })
    .from(members)
    .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
    .where(and(eq(members.userId, userId), isNull(members.deactivatedAt)))
    .orderBy(asc(members.createdAt));
}

export type NewMember = {
  kind: Member["kind"];
  role?: Member["role"];
  name: string;
  handle?: string;
  email?: string | null;
  title?: string | null;
  timezone?: string | null;
  ownerId?: string | null;
  agentProvider?: string | null;
  settings?: MemberSettings;
  userId?: string | null;
};

export async function createMember(
  ctx: AppContext,
  workspaceId: string,
  input: NewMember
): Promise<Member> {
  if (input.timezone && !isValidTimeZone(input.timezone)) {
    throw badRequest(`Unknown time zone ${input.timezone}`);
  }
  const member: Member = {
    id: newId("mem"),
    workspaceId,
    kind: input.kind,
    role: input.role ?? "member",
    name: input.name,
    handle: await uniqueHandle(ctx, workspaceId, input.handle ?? input.name),
    email: input.email ?? null,
    title: input.title ?? null,
    timezone: input.timezone ?? null,
    ownerId: input.ownerId ?? null,
    agentProvider:
      input.kind === "agent" ? (input.agentProvider ?? "custom") : null,
    userId: input.kind === "human" ? (input.userId ?? null) : null,
    settings: input.settings ?? {
      activeHours: { start: "08:00", end: "19:00" },
      workdays: [1, 2, 3, 4, 5],
    },
    createdAt: ctx.now(),
    deactivatedAt: null,
  };
  await ctx.db.insert(members).values(member);

  if (member.kind === "human") {
    await ctx.db.insert(members).values({
      id: newId("mem"),
      workspaceId,
      kind: "agent",
      role: "member",
      name: `${member.name}'s assistant`,
      handle: await uniqueHandle(ctx, workspaceId, `${member.handle}-agent`),
      ownerId: member.id,
      agentProvider: WORKLOG_AGENT,
      settings: {},
      createdAt: ctx.now(),
    });
    let emailTargetId: string | null = null;
    if (member.email) {
      emailTargetId = newId("tgt");
      await ctx.db.insert(deliveryTargets).values({
        id: emailTargetId,
        workspaceId,
        memberId: member.id,
        kind: "email",
        label: `Email (${member.email})`,
        address: member.email,
      });
    }
    await createDefaultAutomations(ctx, member, emailTargetId);
  }
  return member;
}

export async function personalAgentOf(
  ctx: AppContext,
  humanId: string
): Promise<Member> {
  const [agent] = await ctx.db
    .select()
    .from(members)
    .where(
      and(
        eq(members.ownerId, humanId),
        eq(members.agentProvider, WORKLOG_AGENT)
      )
    );
  if (!agent) {
    throw notFound("Assistant");
  }
  return agent;
}

export async function getWorkspace(ctx: AppContext, workspaceId: string) {
  const [ws] = await ctx.db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (!ws) {
    throw notFound("Workspace");
  }
  return ws;
}

export async function listMembers(
  ctx: AppContext,
  workspaceId: string,
  kind?: Member["kind"]
) {
  return await ctx.db
    .select()
    .from(members)
    .where(
      and(
        eq(members.workspaceId, workspaceId),
        isNull(members.deactivatedAt),
        kind ? eq(members.kind, kind) : undefined
      )
    )
    .orderBy(members.createdAt);
}

export async function resolveMember(
  ctx: AppContext,
  viewer: Member,
  ref: string
): Promise<Member> {
  if (ref === "me") {
    return viewer;
  }
  const handle = ref.replace(/^@/u, "").toLowerCase();
  const [m] = await ctx.db
    .select()
    .from(members)
    .where(
      and(
        eq(members.workspaceId, viewer.workspaceId),
        or(eq(members.id, ref), eq(members.handle, handle))
      )
    );
  if (!m) {
    throw notFound(`Member ${ref}`);
  }
  return m;
}

export async function updateMember(
  ctx: AppContext,
  member: Member,
  patch: Partial<
    Pick<Member, "name" | "email" | "title" | "timezone" | "settings">
  >
) {
  if (patch.timezone && !isValidTimeZone(patch.timezone)) {
    throw badRequest(`Unknown time zone ${patch.timezone}`);
  }
  const settings = patch.settings
    ? { ...member.settings, ...patch.settings }
    : undefined;
  const rows = await ctx.db
    .update(members)
    .set({ ...patch, ...(settings ? { settings } : {}) })
    .where(eq(members.id, member.id))
    .returning();
  return returned(rows, "member");
}

export function timezoneOf(member: Member, workspace: Workspace) {
  return member.timezone ?? workspace.timezone;
}

export async function createToken(
  ctx: AppContext,
  member: Member,
  name: string,
  opts: { scopes?: ApiScope[]; expiresAt?: Date | null } = {}
) {
  const token = generateToken();
  const row = {
    id: newId("tok"),
    workspaceId: member.workspaceId,
    memberId: member.id,
    name,
    prefix: token.slice(0, 10),
    tokenHash: hashToken(token),
    scopes: opts.scopes ?? ["read", "write"],
    expiresAt: opts.expiresAt ?? null,
    createdAt: ctx.now(),
  };
  await ctx.db.insert(apiTokens).values(row);
  return {
    id: row.id,
    name,
    token,
    prefix: row.prefix,
    scopes: row.scopes,
    expiresAt: row.expiresAt,
  };
}

export async function listTokens(ctx: AppContext, memberId: string) {
  return await ctx.db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.memberId, memberId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));
}

export async function authenticate(ctx: AppContext, token: string) {
  const [row] = await ctx.db
    .select({
      member: members,
      tokenId: apiTokens.id,
      scopes: apiTokens.scopes,
    })
    .from(apiTokens)
    .innerJoin(members, eq(members.id, apiTokens.memberId))
    .where(
      and(
        eq(apiTokens.tokenHash, hashToken(token)),
        isNull(apiTokens.revokedAt),
        isNull(members.deactivatedAt),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, ctx.now()))
      )
    );
  if (!row) {
    return null;
  }
  // Fire-and-forget bookkeeping; never block a request on it.
  void ctx.db
    .update(apiTokens)
    .set({ lastUsedAt: ctx.now() })
    .where(eq(apiTokens.id, row.tokenId))
    .catch(() => {
      // Best effort: a missed lastUsedAt update is harmless.
    });
  return { member: row.member, scopes: row.scopes.filter(isApiScope) };
}

function isApiScope(scope: string): scope is ApiScope {
  return API_SCOPES.some((known) => known === scope);
}

export function canActFor(viewer: Member, target: Member) {
  return (
    viewer.id === target.id ||
    target.ownerId === viewer.id ||
    viewer.role === "owner" ||
    viewer.role === "admin"
  );
}

export async function revokeToken(
  ctx: AppContext,
  viewer: Member,
  tokenId: string
) {
  const [row] = await ctx.db
    .select({ token: apiTokens, member: members })
    .from(apiTokens)
    .innerJoin(members, eq(members.id, apiTokens.memberId))
    .where(
      and(
        eq(apiTokens.id, tokenId),
        eq(apiTokens.workspaceId, viewer.workspaceId)
      )
    );
  if (!row) {
    throw notFound("Token");
  }
  if (!canActFor(viewer, row.member)) {
    throw forbidden("You can't revoke that token");
  }
  await ctx.db
    .update(apiTokens)
    .set({ revokedAt: ctx.now() })
    .where(eq(apiTokens.id, tokenId));
}

// Explicit links first, then sign-in accounts, so signing in with GitHub is enough to be attributed.
// Pass every id the event carries (e.g. GitHub's numeric id and login).
export async function memberByIdentity(
  ctx: AppContext,
  workspaceId: string,
  provider: string,
  externalIds: string | string[]
) {
  const ids = [
    ...new Set(
      (Array.isArray(externalIds) ? externalIds : [externalIds]).filter(Boolean)
    ),
  ];
  if (!ids.length) {
    return null;
  }
  const normalized =
    provider === "github" ? ids.map((i) => i.toLowerCase()) : ids;
  const [linked] = await ctx.db
    .select({ member: members })
    .from(identities)
    .innerJoin(members, eq(members.id, identities.memberId))
    .where(
      and(
        eq(identities.workspaceId, workspaceId),
        eq(identities.provider, provider),
        inArray(identities.externalId, normalized)
      )
    );
  if (linked) {
    return linked.member;
  }
  const [signedIn] = await ctx.db
    .select({ member: members })
    .from(account)
    .innerJoin(
      members,
      and(
        eq(members.userId, account.userId),
        eq(members.workspaceId, workspaceId)
      )
    )
    .where(
      and(eq(account.providerId, provider), inArray(account.accountId, ids))
    );
  return signedIn?.member ?? null;
}
