import type { AppContext } from "#context";
import { getAttentionById } from "#db/queries/attention";
import { findMemberById } from "#db/queries/members";
import type { Member } from "#db/queries/members";
import { badRequest, forbidden } from "#lib/errors";
import { assertAction, updateAttention } from "#work/attention";
import { performAttentionAction } from "#work/drift";

import { APPROVAL_KIND, isAction, runAction } from "./actions";

/**
 * Answers an attention item's one-click question. A request from the member's assistant to make a
 * write the review held back runs, on Allow, exactly as proposed: the member's own tap is the
 * approval, so no model is asked again. Deny dismisses it.
 */
export async function answerAttention(
  ctx: AppContext,
  member: Member,
  id: string,
  actionId: string
) {
  const item = await getAttentionById(ctx.db, { id, memberId: member.id });
  if (item.kind !== APPROVAL_KIND) {
    return await performAttentionAction(ctx, member, id, actionId);
  }
  assertAction(item, actionId);
  if (actionId === "deny") {
    return await updateAttention(ctx, member.id, id, { state: "dismissed" });
  }
  const tool = String(item.meta?.tool);
  const agent = await findMemberById(ctx.db, {
    id: String(item.meta?.agentId),
    workspaceId: member.workspaceId,
  });
  if (!isAction(tool)) {
    throw badRequest(
      `"${tool}" isn't something an assistant can be allowed to do`
    );
  }
  // Only the member's own assistant acts on their approval.
  if (agent?.ownerId !== member.id) {
    throw forbidden();
  }
  await runAction(ctx, agent, member, tool, item.meta?.input);
  return await updateAttention(ctx, member.id, id, { state: "done" });
}
