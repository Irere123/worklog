import { and, asc, desc, eq, sql } from "drizzle-orm";

import type { DbOrTx } from "#db";
import { conversations, messages } from "#db/schema";

export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;

export async function insertConversation(db: DbOrTx, row: ConversationRow) {
  await db.insert(conversations).values(row);
}

export async function findConversationById(
  db: DbOrTx,
  params: { id: string; workspaceId: string }
) {
  const [row] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, params.id),
        eq(conversations.workspaceId, params.workspaceId)
      )
    );
  return row;
}

export async function findInboxConversation(
  db: DbOrTx,
  params: { agentId: string; askerId: string }
) {
  const [row] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.agentId, params.agentId),
        eq(conversations.askerId, params.askerId),
        eq(conversations.inbox, true)
      )
    );
  return row;
}

export async function listConversations(
  db: DbOrTx,
  params: { askerId: string }
) {
  return await db
    .select()
    .from(conversations)
    .where(eq(conversations.askerId, params.askerId))
    .orderBy(desc(conversations.updatedAt))
    .limit(50);
}

export async function updateConversationById(
  db: DbOrTx,
  params: { id: string; set: Partial<Pick<ConversationRow, "updatedAt">> }
) {
  await db
    .update(conversations)
    .set(params.set)
    .where(eq(conversations.id, params.id));
}

// Holds the row until the transaction ends, so concurrent appends take turns assigning `seq`.
export async function lockConversation(db: DbOrTx, params: { id: string }) {
  await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, params.id))
    .for("update");
}

export async function listMessages(
  db: DbOrTx,
  params: { conversationId: string }
) {
  return await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, params.conversationId))
    .orderBy(asc(messages.seq));
}

export async function nextMessageSeq(
  db: DbOrTx,
  params: { conversationId: string }
) {
  const [last] = await db
    .select({
      next: sql<number>`coalesce(max(${messages.seq}), 0) + 1`.mapWith(Number),
    })
    .from(messages)
    .where(eq(messages.conversationId, params.conversationId));
  return last?.next ?? 1;
}

export async function insertMessages(db: DbOrTx, rows: MessageRow[]) {
  await db.insert(messages).values(rows);
}
