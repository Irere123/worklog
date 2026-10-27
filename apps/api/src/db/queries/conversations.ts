import { and, asc, desc, eq, gt, gte, lt, not, sql } from "drizzle-orm";

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

// What the model replays: everything after the recap.
export async function listMessagesAfter(
  db: DbOrTx,
  params: { conversationId: string; afterSeq: number }
) {
  return await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, params.conversationId),
        gt(messages.seq, params.afterSeq)
      )
    )
    .orderBy(asc(messages.seq));
}

// Characters of stored message JSON the model would replay, a cheap stand-in for tokens.
export async function measureReplay(
  db: DbOrTx,
  params: { conversationId: string }
) {
  const [row] = await db
    .select({
      chars:
        sql<number>`coalesce(sum(length(${messages.content}::text)), 0)`.mapWith(
          Number
        ),
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        eq(messages.conversationId, params.conversationId),
        gt(messages.seq, conversations.recapThroughSeq)
      )
    );
  return row?.chars ?? 0;
}

// Only moves forward from the recap the caller read, so two compactions can't overwrite each other.
export async function setConversationRecap(
  db: DbOrTx,
  params: {
    id: string;
    recap: string | null;
    fromSeq: number;
    throughSeq: number;
  }
) {
  const rows = await db
    .update(conversations)
    .set({ recap: params.recap, recapThroughSeq: params.throughSeq })
    .where(
      and(
        eq(conversations.id, params.id),
        eq(conversations.recapThroughSeq, params.fromSeq)
      )
    )
    .returning({ id: conversations.id });
  return rows.length > 0;
}

// What a member said to their own assistant, without the automation posts in their inbox.
export async function listOwnerMessages(
  db: DbOrTx,
  params: { ownerId: string; since: Date; until: Date; limit: number }
) {
  return await db
    .select({ text: messages.text, createdAt: messages.createdAt })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        eq(conversations.askerId, params.ownerId),
        eq(conversations.mode, "owner"),
        eq(messages.role, "user"),
        gte(messages.createdAt, params.since),
        lt(messages.createdAt, params.until),
        not(sql`coalesce(${messages.text}, '') like '[Worklog automation:%'`)
      )
    )
    .orderBy(asc(messages.createdAt))
    .limit(params.limit);
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
