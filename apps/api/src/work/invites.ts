import type { AppContext } from "#context";
import {
  claimInvite,
  fillMemberAvatars,
  findMemberById,
  listMemberships,
  setInviteNonce,
} from "#db/queries/members";
import type { Member } from "#db/queries/members";
import { getWorkspaceById } from "#db/queries/workspaces";
import { authSecret, webAppUrl } from "#lib/auth";
import { hmacHex, safeEqual } from "#lib/crypto";
import { badRequest, conflict, forbidden, notFound } from "#lib/errors";
import { generateId } from "#lib/ids";

import { resolveMember } from "./members";
import type { SignedInUser } from "./members";

const SIGNATURE_LENGTH = 32;

/**
 * A link that lets whoever opens it join as this invited person, with any account. It works
 * once: joining, removing the person or asking for a new link voids it.
 */
export async function inviteLink(
  ctx: AppContext,
  viewer: Member,
  ref: string,
  opts: { reset?: boolean } = {}
) {
  const member = await resolveMember(ctx, viewer, ref);
  if (member.kind !== "human") {
    throw badRequest("Only people join with an invite link");
  }
  if (member.userId !== null) {
    throw conflict(`${member.name} already joined`);
  }
  let nonce = member.inviteNonce;
  if (nonce === null || opts.reset === true) {
    nonce = generateId();
    await setInviteNonce(ctx.db, { id: member.id, nonce });
  }
  const code = `${member.id}.${sign(ctx, member.id, nonce)}`;
  return { url: new URL(`/join/${code}`, webAppUrl(ctx.config)).toString() };
}

export async function findInvite(ctx: AppContext, code: string) {
  const [id = "", signature = ""] = code.split(".");
  const member = id ? await findMemberById(ctx.db, { id }) : undefined;
  const valid =
    member !== undefined &&
    member.userId === null &&
    member.deactivatedAt === null &&
    member.inviteNonce !== null &&
    safeEqual(signature, sign(ctx, member.id, member.inviteNonce));
  if (!valid) {
    throw notFound("This invite link");
  }
  const workspace = await getWorkspaceById(ctx.db, { id: member.workspaceId });
  return { member, workspace };
}

export async function acceptInvite(
  ctx: AppContext,
  user: SignedInUser | null,
  code: string
) {
  if (!user) {
    throw forbidden("Sign in as yourself to accept an invite");
  }
  const { member, workspace } = await findInvite(ctx, code);
  const memberships = await listMemberships(ctx.db, { userId: user.id });
  if (memberships.some((m) => m.workspace.id === workspace.id)) {
    throw conflict(`You're already in ${workspace.name}`);
  }
  const joined = await claimInvite(ctx.db, {
    id: member.id,
    userId: user.id,
    email: user.emailVerified ? user.email : null,
  });
  if (!joined) {
    throw notFound("This invite link");
  }
  if (user.image) {
    await fillMemberAvatars(ctx.db, {
      ids: [joined.id],
      avatarUrl: user.image,
    });
  }
  return { member: joined, workspace };
}

function sign(ctx: AppContext, memberId: string, nonce: string) {
  return hmacHex(authSecret(ctx.config), `invite:${memberId}:${nonce}`).slice(
    0,
    SIGNATURE_LENGTH
  );
}
