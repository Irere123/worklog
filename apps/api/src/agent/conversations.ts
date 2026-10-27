import type { ModelMessage } from "ai";

import type { AppContext } from "#context";
import {
  findConversationById,
  findInboxConversation,
  insertConversation,
  insertMessages,
  listMessagesAfter,
  lockConversation,
  measureReplay,
  nextMessageSeq,
  updateConversationById,
} from "#db/queries/conversations";
import type { ConversationRow, MessageRow } from "#db/queries/conversations";
import { getPersonalAgent } from "#db/queries/members";
import type { Member } from "#db/queries/members";
import { transact } from "#db/transact";
import { enqueue } from "#jobs/queue";
import { forbidden, notFound } from "#lib/errors";
import { newId } from "#lib/ids";

import { needsCompaction } from "./compaction";

export async function createConversation(
  ctx: AppContext,
  agent: Member,
  asker: Member,
  opts: { inbox?: boolean; title?: string } = {}
) {
  const row: ConversationRow = {
    id: newId("cnv"),
    workspaceId: agent.workspaceId,
    agentId: agent.id,
    askerId: asker.id,
    mode: agent.ownerId === asker.id ? "owner" : "teammate",
    inbox: opts.inbox ?? false,
    title: opts.title ?? null,
    recap: null,
    recapThroughSeq: 0,
    createdAt: ctx.now(),
    updatedAt: ctx.now(),
  };
  await insertConversation(ctx.db, row);
  return row;
}

// Only the asker can read or continue a conversation.
export async function getConversation(
  ctx: AppContext,
  viewer: Member,
  id: string
) {
  const row = await findConversationById(ctx.db, {
    id,
    workspaceId: viewer.workspaceId,
  });
  if (!row) {
    throw notFound("Conversation");
  }
  if (row.askerId !== viewer.id) {
    throw forbidden();
  }
  return row;
}

// What the model replays: the messages after the recap, which travels in the instructions.
export async function loadHistory(
  ctx: AppContext,
  conversation: ConversationRow
): Promise<ModelMessage[]> {
  const rows = await listMessagesAfter(ctx.db, {
    conversationId: conversation.id,
    afterSeq: conversation.recapThroughSeq,
  });
  return rows.map((row) => row.content).filter(isModelMessage);
}

function isModelMessage(value: unknown): value is ModelMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "role" in value &&
    "content" in value
  );
}

// Append-only: history is replayed verbatim every turn until it outgrows its budget, then a job
// folds the older part into a recap. The conversation row is locked while sequence numbers are
// assigned, so a brief landing mid-turn (or two concurrent turns) can't collide after the model
// call was already paid for.
export async function appendMessages(
  ctx: AppContext,
  conversation: ConversationRow,
  items: ModelMessage[]
) {
  if (!items.length) {
    return [];
  }
  const rows = await transact(ctx, async (tx) => {
    await lockConversation(tx.db, { id: conversation.id });
    const next = await nextMessageSeq(tx.db, {
      conversationId: conversation.id,
    });
    const inserted: MessageRow[] = items.map((m, i) => {
      if (m.role === "system") {
        throw new Error(
          "System messages are not persisted; instructions are rebuilt per turn"
        );
      }
      return {
        id: newId("msg"),
        conversationId: conversation.id,
        seq: next + i,
        role: m.role,
        content: m,
        text: displayText(m),
        createdAt: tx.now(),
      };
    });
    await insertMessages(tx.db, inserted);
    await updateConversationById(tx.db, {
      id: conversation.id,
      set: { updatedAt: tx.now() },
    });
    if (
      needsCompaction(
        await measureReplay(tx.db, { conversationId: conversation.id })
      )
    ) {
      await enqueue(
        tx,
        "conversation:compact",
        {
          workspaceId: conversation.workspaceId,
          conversationId: conversation.id,
        },
        { key: `compact:${conversation.id}`, maxAttempts: 3 }
      );
    }
    return inserted;
  });
  for (const row of rows.filter((r) => r.text)) {
    await ctx.bus.publish({
      workspaceId: conversation.workspaceId,
      audienceId: conversation.askerId,
      type: "message.created",
      data: {
        conversationId: conversation.id,
        id: row.id,
        role: row.role,
        text: row.text,
      },
    });
  }
  return rows;
}

function displayText(m: ModelMessage): string | null {
  if (m.role === "tool") {
    return null;
  }
  if (typeof m.content === "string") {
    return m.content;
  }
  const text = m.content
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
  return text || null;
}

// Deliveries are written into the transcript so follow-ups like "tell me more about #12" have context.
export async function postToInbox(
  ctx: AppContext,
  owner: Member,
  label: string,
  markdown: string
) {
  const agent = await getPersonalAgent(ctx.db, { ownerId: owner.id });
  let inbox = await findInboxConversation(ctx.db, {
    agentId: agent.id,
    askerId: owner.id,
  });
  inbox ??= await createConversation(ctx, agent, owner, {
    inbox: true,
    title: "Inbox",
  });
  await appendMessages(ctx, inbox, [
    { role: "user", content: `[Worklog automation: ${label}]` },
    { role: "assistant", content: markdown },
  ]);
  return inbox;
}
