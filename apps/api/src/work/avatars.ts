import type { AppContext } from "#context";
import { updateMemberById } from "#db/queries/members";
import type { Member } from "#db/queries/members";
import { badRequest, unavailable } from "#lib/errors";
import { generateId } from "#lib/ids";
import { log } from "#telemetry/log";

export const MAX_AVATAR_BYTES = 2_000_000;

export const AVATAR_TYPES = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
} as const;

export async function setAvatar(
  ctx: AppContext,
  member: Member,
  bytes: Uint8Array
) {
  if (!ctx.storage) {
    throw unavailable("This server has no file storage set up");
  }
  const type = sniff(bytes);
  if (!type) {
    throw badRequest("Upload a WebP, PNG or JPEG image");
  }
  const key = `avatars/${member.id}/${generateId()}.${AVATAR_TYPES[type]}`;
  const avatarUrl = await ctx.storage.put(key, bytes, type);
  const updated = await updateMemberById(ctx.db, {
    id: member.id,
    set: { avatarUrl },
  });
  await removeUpload(ctx, member, member.avatarUrl);
  return updated;
}

/**
 * Deletes a picture the member uploaded once nothing points at it. Only their own: the address is
 * an editable field, so one copied from a teammate must not take the teammate's file with it.
 */
export async function removeUpload(
  ctx: AppContext,
  member: Member,
  avatarUrl: string | null
) {
  const key = avatarUrl ? ctx.storage?.keyOf(avatarUrl) : undefined;
  if (key === undefined || !key.startsWith(`avatars/${member.id}/`)) {
    return;
  }
  try {
    await ctx.storage?.delete(key);
  } catch (error) {
    log.warn("avatars: old picture not deleted", {
      error,
      memberId: member.id,
    });
  }
}

function sniff(bytes: Uint8Array) {
  const ascii = (from: number, to: number) =>
    String.fromCodePoint(...bytes.subarray(from, to));
  if (bytes.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return "image/webp" as const;
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length > png.length && png.every((b, i) => bytes[i] === b)) {
    return "image/png" as const;
  }
  if (
    bytes.length > 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg" as const;
  }
  return null;
}
