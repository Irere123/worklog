import { generateText, isStepCount } from "ai";

import type { AppContext } from "#context";
import { getReplyRating, listMessagesAfter } from "#db/queries/conversations";
import { findMemberById } from "#db/queries/members";
import type { Member } from "#db/queries/members";
import { findVoice } from "#db/queries/voices";
import { getWorkspaceById } from "#db/queries/workspaces";
import { badRequest, notFound } from "#lib/errors";

import { getConversation, isModelMessage } from "./conversations";
import { assistantInstructions } from "./instructions";
import { memoryPage } from "./memory";
import { TIMEOUTS } from "./models";
import { readTools } from "./tools";

/** The messages before the rated question that a replay carries; enough to know what was meant. */
const REPLAY_HISTORY = 40;

/**
 * The inner loop of improving the assistant: a reply someone rated is asked again, from the same
 * point in its conversation, with today's constitution, prompts, memory and model, so a change can
 * be judged against the cases people flagged. Lookups only: a replay can't change anything, and
 * nothing it writes is stored or sent.
 */
export async function replayRating(
  ctx: AppContext,
  member: Member,
  ratingId: string
) {
  if (!ctx.models) {
    throw badRequest("Replaying needs AI (OPENROUTER_API_KEY)");
  }
  const rating = await getReplyRating(ctx.db, {
    id: ratingId,
    memberId: member.id,
  });
  const conversation = await getConversation(
    ctx,
    member,
    rating.conversationId
  );
  const rows = await listMessagesAfter(ctx.db, {
    conversationId: conversation.id,
    afterSeq: 0,
  });
  const reply = rows.find((r) => r.id === rating.messageId);
  const question = rows.findLast(
    (r) => r.role === "user" && reply !== undefined && r.seq < reply.seq
  );
  if (!reply || !question) {
    throw notFound("The rated reply");
  }
  const agent = await findMemberById(ctx.db, {
    id: conversation.agentId,
    workspaceId: conversation.workspaceId,
  });
  const owner = agent?.ownerId
    ? await findMemberById(ctx.db, {
        id: agent.ownerId,
        workspaceId: conversation.workspaceId,
      })
    : undefined;
  if (!agent || !owner) {
    throw notFound("Agent");
  }
  const ws = await getWorkspaceById(ctx.db, { id: owner.workspaceId });
  const voice = await findVoice(ctx.db, { memberId: owner.id });
  const messages = rows
    .filter((r) => r.seq <= question.seq)
    .slice(-REPLAY_HISTORY)
    .map((r) => r.content)
    .filter(isModelMessage);
  const result = await generateText({
    model: ctx.models.main,
    instructions: assistantInstructions({
      owner,
      asker: member,
      mode: conversation.mode,
      workspaceName: ws.name,
      voice: voice?.content ?? null,
      memory: await memoryPage(ctx, owner.id, conversation.mode === "owner"),
      recap: null,
    }),
    messages,
    tools: readTools({
      ctx,
      agent,
      owner,
      asker: member,
      mode: conversation.mode,
      conversationId: conversation.id,
      said: question.text ?? "",
    }),
    stopWhen: isStepCount(10),
    timeout: TIMEOUTS.chat,
  });
  return {
    ratingId: rating.id,
    rating: rating.rating,
    note: rating.note,
    question: question.text,
    before: reply.text,
    after: result.text.trim(),
  };
}
