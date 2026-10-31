import type { AppContext } from "#context";
import { findConversationById, measureReplay } from "#db/queries/conversations";

import { compactConversation, needsCompaction } from "./compaction";
import { learnFromConversation } from "./memory/learn";

/**
 * What happens once a conversation has been quiet for a while: it's compacted if it outgrew its
 * budget, and the assistant learns from what was said. Compaction goes first, since the next turn
 * depends on it; learning reads the stored messages, which compaction keeps.
 */
export async function settleConversation(
  ctx: AppContext,
  workspaceId: string,
  conversationId: string
) {
  // Measured in SQL first: most settle well inside the budget, and reading them would be wasted.
  if (needsCompaction(await measureReplay(ctx.db, { conversationId }))) {
    await compactConversation(ctx, workspaceId, conversationId);
  }
  const conversation = await findConversationById(ctx.db, {
    id: conversationId,
    workspaceId,
  });
  if (conversation) {
    await learnFromConversation(ctx, conversation);
  }
}
