import type { ModelMessage } from "ai";

import type { AppContext } from "#context";
import {
  deleteConversationById,
  findConversationById,
  findFirstUnlearnedAt,
  findInboxConversation,
  findMessageByClientId,
  findMessageById,
  insertConversation,
  insertMessages,
  listConversationRatings,
  listMessages,
  listMessagesAfter,
  lockConversation,
  measureReplay,
  nextMessageSeq,
  setConversationSeen,
  updateConversationById,
  upsertReplyRating,
} from "#db/queries/conversations";
import type {
  ConversationRow,
  MessageRow,
  ReplyRatingRow,
} from "#db/queries/conversations";
import { getPersonalAgent } from "#db/queries/members";
import type { Member } from "#db/queries/members";
import type { TurnUsage } from "#db/schema";
import { transact } from "#db/transact";
import { enqueue } from "#jobs/queue";
import { badRequest, forbidden, notFound } from "#lib/errors";
import { generateId } from "#lib/ids";

import { mustCompactNow } from "./compaction";
import { presenceChanged } from "./presence";

const SETTLE_AFTER_MS = 10 * 60_000;
const SETTLE_AT_MOST_MS = 60 * 60_000;

export async function createConversation(
  ctx: AppContext,
  agent: Member,
  asker: Member,
  opts: { inbox?: boolean; title?: string } = {}
) {
  const row: ConversationRow = {
    id: generateId(),
    workspaceId: agent.workspaceId,
    agentId: agent.id,
    askerId: asker.id,
    mode: agent.ownerId === asker.id ? "owner" : "teammate",
    inbox: opts.inbox ?? false,
    title: opts.title ?? null,
    recap: null,
    recapThroughSeq: 0,
    learnedThroughSeq: 0,
    turnUntil: null,
    turnStopUntil: null,
    turnStep: null,
    repliedAt: null,
    seenAt: null,
    warmedAt: null,
    turnQueue: [],
    memoryPage: null,
    memorySeenAt: null,
    createdAt: ctx.now(),
    updatedAt: ctx.now(),
  };
  await insertConversation(ctx.db, row);
  return row;
}

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

/** The asker has the conversation open, so what the assistant wrote there is no longer news. */
export async function markConversationSeen(
  ctx: AppContext,
  viewer: Member,
  id: string
) {
  const conversation = await getConversation(ctx, viewer, id);
  await setConversationSeen(ctx.db, {
    id: conversation.id,
    askerId: viewer.id,
    now: ctx.now(),
  });
  await presenceChanged(ctx, {
    workspaceId: viewer.workspaceId,
    ownerId: viewer.id,
  });
}

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

export function isModelMessage(value: unknown): value is ModelMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "role" in value &&
    "content" in value
  );
}

const TITLE_MAX = 60;

/** What the person first asked, flattened and cut at a word, as the conversation's name. */
export function titleFrom(text: string) {
  const flat = text.replaceAll(/\s+/gu, " ").trim();
  if (flat.length <= TITLE_MAX) {
    return flat;
  }
  const cut = flat.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > TITLE_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export async function appendMessages(
  ctx: AppContext,
  conversation: ConversationRow,
  items: ModelMessage[],
  opts: {
    clientId?: string;
    said?: string;
    /** What the turn told the model about memory, so the next turn starts from there. */
    memory?: { page?: string; seenAt: Date };
    usage?: TurnUsage;
  } = {}
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
        id: generateId(),
        conversationId: conversation.id,
        seq: next + i,
        role: m.role,
        content: m,
        text:
          leads(i, m) && opts.said !== undefined ? opts.said : displayText(m),
        clientId: leads(i, m) ? (opts.clientId ?? null) : null,
        usage: i === items.length - 1 ? (opts.usage ?? null) : null,
        createdAt: tx.now(),
      };
    });
    await insertMessages(tx.db, inserted);
    const opening = inserted.find((m) => m.role === "user")?.text;
    const replied = inserted.some(
      (m) => m.role === "assistant" && (m.text ?? "") !== ""
    );
    await updateConversationById(tx.db, {
      id: conversation.id,
      set: {
        updatedAt: tx.now(),
        ...(replied ? { repliedAt: tx.now() } : {}),
        ...(next === 1 && conversation.title === null && opening
          ? { title: titleFrom(opening) }
          : {}),
        ...(opts.memory
          ? {
              memorySeenAt: opts.memory.seenAt,
              ...(opts.memory.page === undefined
                ? {}
                : { memoryPage: opts.memory.page }),
            }
          : {}),
      },
    });
    const job = {
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
    };
    const waiting = await findFirstUnlearnedAt(tx.db, {
      conversationId: conversation.id,
    });
    const overdue =
      waiting !== undefined &&
      tx.now().getTime() - waiting.getTime() > SETTLE_AT_MOST_MS;
    await settleLater(tx, conversation, overdue ? 0 : SETTLE_AFTER_MS);
    if (
      mustCompactNow(
        await measureReplay(tx.db, { conversationId: conversation.id })
      )
    ) {
      await enqueue(tx, "conversation:compact", job, {
        key: `compact:${conversation.id}`,
        maxAttempts: 3,
      });
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

async function settleLater(
  ctx: AppContext,
  conversation: ConversationRow,
  delayMs = SETTLE_AFTER_MS
) {
  await enqueue(
    ctx,
    "conversation:settle",
    { workspaceId: conversation.workspaceId, conversationId: conversation.id },
    { key: `settle:${conversation.id}`, delayMs, maxAttempts: 3 }
  );
}

/**
 * Names a conversation the way its asker wants it found again. The thread briefs arrive in keeps
 * its own name, which every client shows the same way.
 */
export async function renameConversation(
  ctx: AppContext,
  viewer: Member,
  id: string,
  title: string
) {
  const conversation = await getConversation(ctx, viewer, id);
  if (conversation.inbox) {
    throw badRequest("The thread briefs arrive in can't be renamed");
  }
  await updateConversationById(ctx.db, { id, set: { title } });
  await presenceChanged(ctx, {
    workspaceId: viewer.workspaceId,
    ownerId: viewer.id,
  });
  return { ...conversation, title };
}

/**
 * Deletes one of the asker's conversations with their own assistant. A conversation with a
 * teammate's assistant stays, because that teammate can read it; so does the thread briefs
 * arrive in. What memory already learned from it is kept, in Memory, where it can be forgotten.
 */
export async function deleteConversation(
  ctx: AppContext,
  viewer: Member,
  id: string
) {
  const conversation = await getConversation(ctx, viewer, id);
  if (conversation.mode !== "owner") {
    throw forbidden("Its owner can read it, so it stays");
  }
  if (conversation.inbox) {
    throw badRequest("The thread briefs arrive in can't be deleted");
  }
  await deleteConversationById(ctx.db, {
    id,
    workspaceId: viewer.workspaceId,
  });
  await presenceChanged(ctx, {
    workspaceId: viewer.workspaceId,
    ownerId: viewer.id,
  });
}

/** A conversation as its asker reads it: the readable turns, each with how they rated it. */
export async function conversationDetail(
  ctx: AppContext,
  viewer: Member,
  id: string
) {
  const conversation = await getConversation(ctx, viewer, id);
  const [rows, ratings] = await Promise.all([
    listMessages(ctx.db, { conversationId: conversation.id }),
    listConversationRatings(ctx.db, {
      conversationId: conversation.id,
      memberId: viewer.id,
    }),
  ]);
  const rated = new Map(ratings.map((r) => [r.messageId, r.rating]));
  return {
    ...conversation,
    messages: rows.map((m) => ({ ...m, rating: rated.get(m.id) ?? null })),
  };
}

/**
 * Whoever is in the conversation rates one of the assistant's replies, and can say why. Rating it
 * again replaces the rating. In an owner's own conversation it's learned from when the
 * conversation settles; every rating is also kept as a case to check changes against.
 */
export async function rateReply(
  ctx: AppContext,
  viewer: Member,
  conversationId: string,
  messageId: string,
  input: { rating: ReplyRatingRow["rating"]; note?: string | null }
) {
  const conversation = await getConversation(ctx, viewer, conversationId);
  const message = await findMessageById(ctx.db, {
    id: messageId,
    conversationId: conversation.id,
  });
  if (message?.role !== "assistant" || !message.text) {
    throw notFound("Reply");
  }
  const note = input.note?.trim();
  return await transact(ctx, async (tx) => {
    const row = await upsertReplyRating(tx.db, {
      id: generateId(),
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      messageId: message.id,
      memberId: viewer.id,
      rating: input.rating,
      note: note === undefined || note === "" ? null : note,
      learnedAt: null,
      createdAt: tx.now(),
      updatedAt: tx.now(),
    });
    if (conversation.mode === "owner") {
      await settleLater(tx, conversation);
    }
    return row;
  });
}

/**
 * The answer a message got the first time it was sent, for a client sending it again (its
 * connection dropped before the reply arrived): null if it never was, "" if its turn ended without
 * a readable reply.
 */
export async function answeredBefore(
  ctx: AppContext,
  conversation: ConversationRow,
  clientId: string
) {
  const sent = await findMessageByClientId(ctx.db, {
    conversationId: conversation.id,
    clientId,
  });
  if (!sent) {
    return null;
  }
  const after = await listMessagesAfter(ctx.db, {
    conversationId: conversation.id,
    afterSeq: sent.seq,
  });
  const next = after.findIndex((m) => m.role === "user");
  const turn = next === -1 ? after : after.slice(0, next);
  return turn
    .flatMap((m) => (m.role === "assistant" && m.text ? [m.text] : []))
    .join("\n\n");
}

function leads(index: number, m: ModelMessage) {
  return index === 0 && m.role === "user";
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
