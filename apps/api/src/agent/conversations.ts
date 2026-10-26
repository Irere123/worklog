import type { ModelMessage } from "ai";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import type { AppContext } from "../context";
import { conversations, messages } from "../db/schema";
import { forbidden, notFound } from "../lib/errors";
import { newId } from "../lib/ids";
import { personalAgentOf } from "../members/service";
import type { Member } from "../members/service";

export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;

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
    createdAt: ctx.now(),
    updatedAt: ctx.now(),
  };
  await ctx.db.insert(conversations).values(row);
  return row;
}

// Only the asker can read or continue a conversation.
export async function getConversation(
  ctx: AppContext,
  viewer: Member,
  id: string
) {
  const [row] = await ctx.db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, id),
        eq(conversations.workspaceId, viewer.workspaceId)
      )
    );
  if (!row) {
    throw notFound("Conversation");
  }
  if (row.askerId !== viewer.id) {
    throw forbidden();
  }
  return row;
}

export async function listConversations(ctx: AppContext, viewer: Member) {
  return await ctx.db
    .select()
    .from(conversations)
    .where(eq(conversations.askerId, viewer.id))
    .orderBy(desc(conversations.updatedAt))
    .limit(50);
}

export async function loadMessages(ctx: AppContext, conversationId: string) {
  return await ctx.db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.seq));
}

export async function loadHistory(
  ctx: AppContext,
  conversationId: string
): Promise<ModelMessage[]> {
  const rows = await loadMessages(ctx, conversationId);
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

// Append-only: history is replayed verbatim every turn. The conversation row is locked while
// sequence numbers are assigned, so a brief landing mid-turn (or two concurrent turns) can't
// collide after the model call was already paid for.
export async function appendMessages(
  ctx: AppContext,
  conversation: ConversationRow,
  items: ModelMessage[]
) {
  if (!items.length) {
    return [];
  }
  const rows = await ctx.db.transaction(async (tx) => {
    await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, conversation.id))
      .for("update");
    const [last] = await tx
      .select({
        next: sql<number>`coalesce(max(${messages.seq}), 0) + 1`.mapWith(
          Number
        ),
      })
      .from(messages)
      .where(eq(messages.conversationId, conversation.id));
    const next = last?.next ?? 1;
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
        createdAt: ctx.now(),
      };
    });
    await tx.insert(messages).values(inserted);
    await tx
      .update(conversations)
      .set({ updatedAt: ctx.now() })
      .where(eq(conversations.id, conversation.id));
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
  const agent = await personalAgentOf(ctx, owner.id);
  let [inbox] = await ctx.db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.agentId, agent.id),
        eq(conversations.askerId, owner.id),
        eq(conversations.inbox, true)
      )
    );
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
