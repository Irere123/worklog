import { createTarget } from "#automations/delivery";
import { createDefaultAutomations } from "#automations/service";
import type { AppContext } from "#context";
import {
  findTokenByHash,
  findTokenById,
  insertToken,
  updateTokenById,
} from "#db/queries/api-tokens";
import {
  findMemberByIdOrHandle,
  getPersonalAgent,
  insertMembers,
  listHandlesLike,
  listMemberships,
  listPendingInvites,
  fillMemberAvatars,
  setMembersUser,
  updateMemberById,
  WORKLOG_AGENT,
} from "#db/queries/members";
import type { Member } from "#db/queries/members";
import { insertWorkspace } from "#db/queries/workspaces";
import type { Workspace } from "#db/queries/workspaces";
import { API_SCOPES } from "#db/schema";
import type { ApiScope, MemberSettings } from "#db/schema";
import { transact } from "#db/transact";
import { generateToken, hashToken } from "#lib/crypto";
import { badRequest, conflict, forbidden, notFound } from "#lib/errors";
import { generateId } from "#lib/ids";
import { isValidTimeZone } from "#lib/time";
import { log } from "#telemetry/log";

import { removeUpload } from "./avatars";

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
  const taken = new Set(await listHandlesLike(ctx.db, { workspaceId, root }));
  for (let i = 0; i < 50; i += 1) {
    const handle = i === 0 ? root : `${root}-${i + 1}`;
    if (!taken.has(handle)) {
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
    id: generateId(),
    name: input.name,
    slug: `${slugify(input.name)}-${generateId().slice(-6).toLowerCase()}`,
    timezone,
    entropyDays: 30,
    cardSeq: 0,
    createdAt: ctx.now(),
  };
  await insertWorkspace(ctx.db, workspace);
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
  return await transact(ctx, async (tx) => {
    const workspace = await createWorkspace(tx, {
      name: input.workspaceName,
      timezone: input.timezone,
    });
    const owner = await createMember(tx, workspace.id, {
      kind: "human",
      role: "owner",
      name: input.name,
      handle: input.handle,
      email: input.email ?? null,
      timezone: workspace.timezone,
    });
    const token = await createToken(tx, owner, "setup");
    return {
      workspace,
      member: owner,
      assistant: await getPersonalAgent(tx.db, { ownerId: owner.id }),
      token,
    };
  });
}

export type SignedInUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
};

export async function createWorkspaceForUser(
  ctx: AppContext,
  user: SignedInUser,
  input: { name: string; timezone?: string; handle?: string }
) {
  return await transact(ctx, async (tx) => {
    const workspace = await createWorkspace(tx, input);
    const owner = await createMember(tx, workspace.id, {
      kind: "human",
      role: "owner",
      name: user.name || localPart(user.email),
      handle: input.handle ?? localPart(user.email),
      email: user.email,
      timezone: workspace.timezone,
      userId: user.id,
      avatarUrl: user.image ?? null,
    });
    return { workspace, member: owner };
  });
}

export async function claimMemberships(ctx: AppContext, user: SignedInUser) {
  if (!user.emailVerified) {
    return 0;
  }
  const pending = await listPendingInvites(ctx.db, { email: user.email });
  const memberships = await listMemberships(ctx.db, { userId: user.id });
  const joined = new Set(memberships.map((m) => m.member.workspaceId));
  const ids: string[] = [];
  for (const m of pending) {
    if (!joined.has(m.workspaceId)) {
      joined.add(m.workspaceId);
      ids.push(m.id);
    }
  }
  await setMembersUser(ctx.db, { ids, userId: user.id });
  if (user.image) {
    await fillMemberAvatars(ctx.db, {
      ids: [...memberships.map((m) => m.member.id), ...ids],
      avatarUrl: user.image,
    });
  }
  return ids.length;
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
  avatarUrl?: string | null;
};

export async function createMember(
  ctx: AppContext,
  workspaceId: string,
  input: NewMember
) {
  if (input.timezone && !isValidTimeZone(input.timezone)) {
    throw badRequest(`Unknown time zone ${input.timezone}`);
  }
  return await transact(ctx, async (tx) => {
    const member: Member = {
      id: generateId(),
      workspaceId,
      kind: input.kind,
      role: input.role ?? "member",
      name: input.name,
      handle: await uniqueHandle(tx, workspaceId, input.handle ?? input.name),
      email: input.email ?? null,
      title: input.title ?? null,
      timezone: input.timezone ?? null,
      avatarUrl: input.avatarUrl ?? null,
      ownerId: input.ownerId ?? null,
      agentProvider:
        input.kind === "agent" ? (input.agentProvider ?? "custom") : null,
      userId: input.kind === "human" ? (input.userId ?? null) : null,
      settings: input.settings ?? {
        activeHours: { start: "08:00", end: "19:00" },
        workdays: [1, 2, 3, 4, 5],
      },
      inviteNonce: null,
      createdAt: tx.now(),
      deactivatedAt: null,
    };
    await insertMembers(tx.db, [member]);

    if (member.kind === "human") {
      await insertMembers(tx.db, [
        {
          id: generateId(),
          workspaceId,
          kind: "agent",
          role: "member",
          name: `${member.name}'s assistant`,
          handle: await uniqueHandle(tx, workspaceId, `${member.handle}-agent`),
          ownerId: member.id,
          agentProvider: WORKLOG_AGENT,
          settings: {},
          createdAt: tx.now(),
        },
      ]);
      const emailTarget = member.email
        ? await createTarget(tx, member, {
            kind: "email",
            label: `Email (${member.email})`,
            address: member.email,
            visibility: "private",
          })
        : null;
      await createDefaultAutomations(tx, member, emailTarget?.id ?? null);
    }
    return member;
  });
}

export async function resolveMember(
  ctx: AppContext,
  viewer: Member,
  ref: string
) {
  if (ref === "me") {
    return viewer;
  }
  const m = await findMemberByIdOrHandle(ctx.db, {
    workspaceId: viewer.workspaceId,
    id: ref,
    handle: ref.replace(/^@/u, "").toLowerCase(),
  });
  if (!m) {
    throw notFound(`Member ${ref}`);
  }
  return m;
}

export async function updateMember(
  ctx: AppContext,
  member: Member,
  patch: Partial<
    Pick<
      Member,
      "name" | "email" | "title" | "timezone" | "settings" | "avatarUrl"
    >
  >
) {
  if (patch.timezone && !isValidTimeZone(patch.timezone)) {
    throw badRequest(`Unknown time zone ${patch.timezone}`);
  }
  const settings = patch.settings
    ? { ...member.settings, ...patch.settings }
    : undefined;
  const updated = await updateMemberById(ctx.db, {
    id: member.id,
    set: { ...patch, ...(settings ? { settings } : {}) },
  });
  if (patch.avatarUrl !== undefined && patch.avatarUrl !== member.avatarUrl) {
    await removeUpload(ctx, member, member.avatarUrl);
  }
  return updated;
}

export async function createToken(
  ctx: AppContext,
  member: Member,
  name: string,
  opts: { scopes?: ApiScope[]; expiresAt?: Date | null } = {}
) {
  const token = generateToken();
  const row = {
    id: generateId(),
    workspaceId: member.workspaceId,
    memberId: member.id,
    name,
    prefix: token.slice(0, 10),
    tokenHash: hashToken(token),
    scopes: opts.scopes ?? ["read", "write"],
    expiresAt: opts.expiresAt ?? null,
    createdAt: ctx.now(),
  };
  await insertToken(ctx.db, row);
  return {
    id: row.id,
    name,
    token,
    prefix: row.prefix,
    scopes: row.scopes,
    expiresAt: row.expiresAt,
  };
}

export async function authenticate(ctx: AppContext, token: string) {
  const row = await findTokenByHash(ctx.db, {
    tokenHash: hashToken(token),
    now: ctx.now(),
  });
  if (!row) {
    return null;
  }
  void recordTokenUse(ctx, row.tokenId);
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
  const row = await findTokenById(ctx.db, {
    id: tokenId,
    workspaceId: viewer.workspaceId,
  });
  if (!row) {
    throw notFound("Token");
  }
  if (!canActFor(viewer, row.member)) {
    throw forbidden("You can't revoke that token");
  }
  await updateTokenById(ctx.db, {
    id: tokenId,
    set: { revokedAt: ctx.now() },
  });
}

async function recordTokenUse(ctx: AppContext, id: string) {
  try {
    await updateTokenById(ctx.db, { id, set: { lastUsedAt: ctx.now() } });
  } catch (error) {
    log.warn("members: couldn't record token use", { error });
  }
}
