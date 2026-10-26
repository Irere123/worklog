import type { ModelMessage } from "ai";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import { conversations, messages } from "../db/schema";
import { forbidden, notFound } from "../lib/errors";
import { newId } from "../lib/ids";
import { personalAgentOf, type Member } from "../members/service";

export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;

export async function createConversation(ctx: AppContext, agent: Member, asker: Member, opts: { inbox?: boolean; title?: string } = {}) {
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

/** Only the asker can read or continue a conversation. */
export async function getConversation(ctx: AppContext, viewer: Member, id: string) {
  const [row] = await ctx.db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.workspaceId, viewer.workspaceId)));
  if (!row) throw notFound("Conversation");
  if (row.askerId !== viewer.id) throw forbidden();
  return row;
}

export async function listConversations(ctx: AppContext, viewer: Member) {
  return ctx.db
    .select()
    .from(conversations)
    .where(eq(conversations.askerId, viewer.id))
    .orderBy(desc(conversations.updatedAt))
    .limit(50);
}

export async function loadMessages(ctx: AppContext, conversationId: string) {
  return ctx.db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.seq));
}

/**
 * Append-only: history is replayed verbatim on every turn, never edited. The conversation row is
 * locked while sequence numbers are assigned, so a brief landing in the inbox mid-turn (or two
 * concurrent turns) can't collide after the model call was already paid for.
 */
export async function appendMessages(ctx: AppContext, conversation: ConversationRow, items: ModelMessage[]) {
  if (!items.length) return [];
  const rows = await ctx.db.transaction(async (tx) => {
    await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, conversation.id)).for("update");
    const [{ next }] = (await tx
      .select({ next: sql<number>`coalesce(max(${messages.seq}), 0) + 1` })
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))) as [{ next: number }];
    const rows: MessageRow[] = items.map((m, i) => {
      if (m.role === "system") throw new Error("System messages are not persisted; instructions are rebuilt per turn");
      return {
        id: newId("msg"),
        conversationId: conversation.id,
        seq: Number(next) + i,
        role: m.role,
        content: m,
        text: displayText(m),
        createdAt: ctx.now(),
      };
    });
    await tx.insert(messages).values(rows);
    await tx.update(conversations).set({ updatedAt: ctx.now() }).where(eq(conversations.id, conversation.id));
    return rows;
  });
  for (const row of rows.filter((r) => r.text)) {
    await ctx.bus.publish({
      workspaceId: conversation.workspaceId,
      audienceId: conversation.askerId,
      type: "message.created",
      data: { conversationId: conversation.id, id: row.id, role: row.role, text: row.text },
    });
  }
  return rows;
}

function displayText(m: ModelMessage): string | null {
  if (m.role === "tool") return null;
  if (typeof m.content === "string") return m.content;
  const text = m.content
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
  return text || null;
}

/**
 * The owner's inbox conversation with their assistant: briefs and proactive pings are written
 * here (OpenClaw writes deliveries into the destination transcript) so "tell me more about #12"
 * has context.
 */
export async function postToInbox(ctx: AppContext, owner: Member, label: string, markdown: string) {
  const agent = await personalAgentOf(ctx, owner.id);
  let [inbox] = await ctx.db
    .select()
    .from(conversations)
    .where(and(eq(conversations.agentId, agent.id), eq(conversations.askerId, owner.id), eq(conversations.inbox, true)));
  if (!inbox) inbox = await createConversation(ctx, agent, owner, { inbox: true, title: "Inbox" });
  await appendMessages(ctx, inbox, [
    { role: "user", content: `[Worklog automation: ${label}]` },
    { role: "assistant", content: markdown },
  ]);
  return inbox;
}
