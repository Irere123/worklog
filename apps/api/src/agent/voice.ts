import type { AppContext } from "#context";
import type { Member } from "#db/queries/members";
import { insertVoice } from "#db/queries/voices";
import type { VoiceRow } from "#db/queries/voices";
import { newId } from "#lib/ids";

// It rides along in every conversation, so it stays about a page.
export const MAX_VOICE_CHARS = 4000;

/**
 * The owner's own instructions for their assistant. Only this writes them, and only a member's own
 * request reaches it: no assistant tool does, so text planted in ingested data can't persist itself
 * into the assistant's instructions. An empty voice clears it and is kept as history like any other.
 */
export async function setVoice(
  ctx: AppContext,
  member: Member,
  content: string
) {
  const row: VoiceRow = {
    id: newId("vce"),
    workspaceId: member.workspaceId,
    memberId: member.id,
    content: content.trim(),
    createdAt: ctx.now(),
  };
  await insertVoice(ctx.db, row);
  return row;
}
