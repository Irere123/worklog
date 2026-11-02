import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  isNull,
  lt,
  lte,
  not,
  or,
  sql,
} from "drizzle-orm";

import type { DbOrTx } from "#db";
import { violates } from "#db/errors";
import { conversations, messages, replyRatings } from "#db/schema";
import { returned } from "#lib/assert";
import { conflict, notFound } from "#lib/errors";

export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type ReplyRatingRow = typeof replyRatings.$inferSelect;

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
  params: {
    id: string;
    set: Partial<
      Pick<
        ConversationRow,
        "updatedAt" | "memoryPage" | "memorySeenAt" | "title"
      >
    >;
  }
) {
  await db
    .update(conversations)
    .set(params.set)
    .where(eq(conversations.id, params.id));
}

// Its messages and ratings go with it (foreign keys cascade).
export async function deleteConversationById(
  db: DbOrTx,
  params: { id: string; workspaceId: string }
) {
  await db
    .delete(conversations)
    .where(
      and(
        eq(conversations.id, params.id),
        eq(conversations.workspaceId, params.workspaceId)
      )
    );
}

// Joins the line for a turn in this conversation.
export async function enqueueConversationTurn(
  db: DbOrTx,
  params: { id: string; token: string }
) {
  await db
    .update(conversations)
    .set({
      turnQueue: sql`array_append(${conversations.turnQueue}, ${params.token})`,
    })
    .where(eq(conversations.id, params.id));
}

// Takes the turn for whoever is first in line, once the turn before has let go or its lease ran out.
export async function claimConversationTurn(
  db: DbOrTx,
  params: { id: string; token: string; now: Date; until: Date }
) {
  const rows = await db
    .update(conversations)
    .set({
      turnUntil: params.until,
      turnQueue: sql`array_remove(${conversations.turnQueue}, ${params.token})`,
    })
    .where(
      and(
        eq(conversations.id, params.id),
        sql`${conversations.turnQueue}[1] = ${params.token}`,
        or(
          isNull(conversations.turnUntil),
          lte(conversations.turnUntil, params.now)
        )
      )
    )
    .returning({ id: conversations.id });
  return rows.length > 0;
}

export async function leaveConversationTurnQueue(
  db: DbOrTx,
  params: { id: string; token: string }
) {
  await db
    .update(conversations)
    .set({
      turnQueue: sql`array_remove(${conversations.turnQueue}, ${params.token})`,
    })
    .where(eq(conversations.id, params.id));
}

// A place in line taken before `beforeMs` belongs to a request that would have given up by now, so
// its process is gone; dropping it lets the ones behind it through.
export async function dropStaleTurnTokens(
  db: DbOrTx,
  params: { id: string; beforeMs: number }
) {
  await db
    .update(conversations)
    .set({
      turnQueue: sql`array(
        select token from unnest(${conversations.turnQueue}) as token
        where split_part(token, ':', 1)::bigint >= ${params.beforeMs}
      )`,
    })
    .where(
      and(
        eq(conversations.id, params.id),
        sql`exists (
          select 1 from unnest(${conversations.turnQueue}) as token
          where split_part(token, ':', 1)::bigint < ${params.beforeMs}
        )`
      )
    );
}

// Asks the turn running now, if one is, to stop: it watches for its own lease here.
export async function requestTurnStop(
  db: DbOrTx,
  params: { id: string; now: Date }
) {
  const rows = await db
    .update(conversations)
    .set({ turnStopUntil: sql`${conversations.turnUntil}` })
    .where(
      and(
        eq(conversations.id, params.id),
        gt(conversations.turnUntil, params.now)
      )
    )
    .returning({ id: conversations.id });
  return rows.length > 0;
}

export async function findTurnStop(db: DbOrTx, params: { id: string }) {
  const [row] = await db
    .select({ until: conversations.turnStopUntil })
    .from(conversations)
    .where(eq(conversations.id, params.id));
  return row?.until ?? null;
}

// Only the turn that holds the lease lets it go, so a turn that outlived it can't free the next one's.
export async function releaseConversationTurn(
  db: DbOrTx,
  params: { id: string; until: Date }
) {
  await db
    .update(conversations)
    .set({ turnUntil: null, turnStopUntil: null })
    .where(
      and(
        eq(conversations.id, params.id),
        eq(conversations.turnUntil, params.until)
      )
    );
}

// Only moves forward from the watermark the caller read, so two passes can't both learn the same messages.
export async function setConversationLearned(
  db: DbOrTx,
  params: { id: string; fromSeq: number; throughSeq: number }
) {
  const rows = await db
    .update(conversations)
    .set({ learnedThroughSeq: params.throughSeq })
    .where(
      and(
        eq(conversations.id, params.id),
        eq(conversations.learnedThroughSeq, params.fromSeq)
      )
    )
    .returning({ id: conversations.id });
  return rows.length > 0;
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
// The memory page is let go too: the prompt's start changes with the recap anyway, so the next turn
// takes a fresh one.
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
    .set({
      recap: params.recap,
      recapThroughSeq: params.throughSeq,
      memoryPage: null,
      memorySeenAt: null,
    })
    .where(
      and(
        eq(conversations.id, params.id),
        eq(conversations.recapThroughSeq, params.fromSeq)
      )
    )
    .returning({ id: conversations.id });
  return rows.length > 0;
}

// What a member said to their own assistant that its conversation hasn't learned from yet, without
// the automation posts in their inbox.
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
        gt(messages.seq, conversations.learnedThroughSeq),
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
  try {
    await db.insert(messages).values(rows);
  } catch (error) {
    if (violates(error, "messages_client_uq")) {
      throw conflict("That message was already sent");
    }
    throw error;
  }
}

// The newest things the person in a conversation typed, oldest first, without automation posts.
export async function listRecentSaid(
  db: DbOrTx,
  params: { conversationId: string; limit: number }
) {
  const rows = await db
    .select({ text: messages.text })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, params.conversationId),
        eq(messages.role, "user"),
        not(sql`coalesce(${messages.text}, '') like '[Worklog automation:%'`)
      )
    )
    .orderBy(desc(messages.seq))
    .limit(params.limit);
  return rows.flatMap((r) => (r.text ? [r.text] : [])).toReversed();
}

// When the oldest message the conversation hasn't learned from was written, if there is one.
export async function findFirstUnlearnedAt(
  db: DbOrTx,
  params: { conversationId: string }
) {
  const [row] = await db
    .select({ at: messages.createdAt })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        eq(messages.conversationId, params.conversationId),
        gt(messages.seq, conversations.learnedThroughSeq)
      )
    )
    .orderBy(asc(messages.seq))
    .limit(1);
  return row?.at;
}

export async function findMessageByClientId(
  db: DbOrTx,
  params: { conversationId: string; clientId: string }
) {
  const [row] = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, params.conversationId),
        eq(messages.clientId, params.clientId)
      )
    );
  return row;
}

export async function findMessageById(
  db: DbOrTx,
  params: { id: string; conversationId: string }
) {
  const [row] = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.id, params.id),
        eq(messages.conversationId, params.conversationId)
      )
    );
  return row;
}

// A new rating, or a changed one, waits to be learned from again.
export async function upsertReplyRating(db: DbOrTx, row: ReplyRatingRow) {
  const rows = await db
    .insert(replyRatings)
    .values(row)
    .onConflictDoUpdate({
      target: [replyRatings.messageId, replyRatings.memberId],
      set: {
        rating: row.rating,
        note: row.note,
        learnedAt: null,
        updatedAt: row.updatedAt,
      },
    })
    .returning();
  return returned(rows, "reply rating");
}

export async function listConversationRatings(
  db: DbOrTx,
  params: { conversationId: string; memberId: string }
) {
  return await db
    .select({ messageId: replyRatings.messageId, rating: replyRatings.rating })
    .from(replyRatings)
    .where(
      and(
        eq(replyRatings.conversationId, params.conversationId),
        eq(replyRatings.memberId, params.memberId)
      )
    );
}

// Ratings in a conversation the memory pass hasn't read yet, with the reply they rate.
export async function listUnlearnedRatings(
  db: DbOrTx,
  params: { conversationId: string }
) {
  return await db
    .select({
      id: replyRatings.id,
      rating: replyRatings.rating,
      note: replyRatings.note,
      reply: messages.text,
      updatedAt: replyRatings.updatedAt,
    })
    .from(replyRatings)
    .innerJoin(messages, eq(messages.id, replyRatings.messageId))
    .where(
      and(
        eq(replyRatings.conversationId, params.conversationId),
        isNull(replyRatings.learnedAt)
      )
    )
    .orderBy(asc(replyRatings.updatedAt))
    .limit(20);
}

// Only ratings still as they were read: one changed while the pass ran is read again next time.
export async function setRatingsLearned(
  db: DbOrTx,
  params: { read: { id: string; updatedAt: Date }[]; at: Date }
) {
  if (!params.read.length) {
    return;
  }
  await db
    .update(replyRatings)
    .set({ learnedAt: params.at })
    .where(
      or(
        ...params.read.map((r) =>
          and(
            eq(replyRatings.id, r.id),
            eq(replyRatings.updatedAt, r.updatedAt)
          )
        )
      )
    );
}

// A member's ratings, newest first, each with the reply and the message it answered: the cases a
// prompt or model change is checked against.
export async function listReplyRatings(
  db: DbOrTx,
  params: {
    memberId: string;
    rating?: ReplyRatingRow["rating"];
    limit: number;
  }
) {
  return await db
    .select({
      id: replyRatings.id,
      conversationId: replyRatings.conversationId,
      messageId: replyRatings.messageId,
      rating: replyRatings.rating,
      note: replyRatings.note,
      reply: messages.text,
      question: sql<string | null>`(
        select asked.text from ${messages} as asked
        where asked.conversation_id = ${messages.conversationId}
          and asked.role = 'user' and asked.seq < ${messages.seq}
        order by asked.seq desc limit 1
      )`,
      createdAt: replyRatings.createdAt,
      updatedAt: replyRatings.updatedAt,
    })
    .from(replyRatings)
    .innerJoin(messages, eq(messages.id, replyRatings.messageId))
    .where(
      and(
        eq(replyRatings.memberId, params.memberId),
        params.rating ? eq(replyRatings.rating, params.rating) : undefined
      )
    )
    .orderBy(desc(replyRatings.updatedAt))
    .limit(params.limit);
}

// What a member's own turns cost since then, and how much of their input the prompt cache served.
export async function sumTurnUsage(
  db: DbOrTx,
  params: { askerId: string; since: Date }
) {
  const [row] = await db
    .select({
      turns: sql<number>`count(*)`.mapWith(Number),
      inputTokens:
        sql<number>`coalesce(sum((${messages.usage}->>'inputTokens')::bigint), 0)`.mapWith(
          Number
        ),
      cachedInputTokens:
        sql<number>`coalesce(sum((${messages.usage}->>'cachedInputTokens')::bigint), 0)`.mapWith(
          Number
        ),
      outputTokens:
        sql<number>`coalesce(sum((${messages.usage}->>'outputTokens')::bigint), 0)`.mapWith(
          Number
        ),
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        eq(conversations.askerId, params.askerId),
        sql`${messages.usage} is not null`,
        gte(messages.createdAt, params.since)
      )
    );
  return (
    row ?? { turns: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }
  );
}

// Takes the right to warm a conversation's cache, at most once in `gapMs`.
export async function claimConversationWarmth(
  db: DbOrTx,
  params: { id: string; now: Date; gapMs: number }
) {
  const rows = await db
    .update(conversations)
    .set({ warmedAt: params.now })
    .where(
      and(
        eq(conversations.id, params.id),
        or(
          isNull(conversations.warmedAt),
          lte(
            conversations.warmedAt,
            new Date(params.now.getTime() - params.gapMs)
          )
        )
      )
    )
    .returning({ id: conversations.id });
  return rows.length > 0;
}

export async function getReplyRating(
  db: DbOrTx,
  params: { id: string; memberId: string }
) {
  const rows = await db
    .select()
    .from(replyRatings)
    .where(
      and(
        eq(replyRatings.id, params.id),
        eq(replyRatings.memberId, params.memberId)
      )
    );
  if (!rows[0]) {
    throw notFound("Rating");
  }
  return rows[0];
}

// The workspace's unhelpful ratings, newest first: the cases a changed prompt or model is run on.
export async function listUnhelpfulRatings(
  db: DbOrTx,
  params: { workspaceId: string; limit: number }
) {
  return await db
    .select({ id: replyRatings.id, memberId: replyRatings.memberId })
    .from(replyRatings)
    .where(
      and(
        eq(replyRatings.workspaceId, params.workspaceId),
        eq(replyRatings.rating, "unhelpful")
      )
    )
    .orderBy(desc(replyRatings.updatedAt))
    .limit(params.limit);
}
