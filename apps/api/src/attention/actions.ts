import * as board from "#board/service";
import type { AppContext } from "#context";
import { badRequest } from "#lib/errors";
import type { Member } from "#members/service";

import { assertAction, getAttention, updateAttention } from "./service";

export async function performAttentionAction(
  ctx: AppContext,
  member: Member,
  id: string,
  actionId: string
) {
  const item = await getAttention(ctx, member.id, id);
  assertAction(item, actionId);
  switch (item.kind) {
    case "card.drifting": {
      const number = Number(item.meta?.cardNumber);
      if (actionId === "keep") {
        await board.keepAlive(ctx, member, number);
      } else if (actionId === "not_now") {
        await board.postpone(ctx, member, member.workspaceId, number);
      } else if (actionId === "done") {
        await board.close(ctx, member, member.workspaceId, number);
      }
      break;
    }
    default: {
      throw badRequest(`No actions are wired up for ${item.kind} items`);
    }
  }
  return await updateAttention(ctx, member.id, id, { state: "done" });
}
