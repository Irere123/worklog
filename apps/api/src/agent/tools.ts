import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";

import { listActivities } from "../activity/service";
import { workSnapshot } from "../activity/snapshot";
import { logWork, LOG_KINDS } from "../activity/worklog";
import { performAttentionAction } from "../attention/actions";
import {
  giveFeedback,
  listOpenAttention,
  raiseAttention,
  updateAttention,
} from "../attention/service";
import * as board from "../board/service";
import type { AppContext } from "../context";
import { CARD_STAGES } from "../db/schema";
import { DAY_MS } from "../lib/time";
import { listMembers, resolveMember } from "../members/service";
import type { Member } from "../members/service";
import { addMemory, forgetMemory, listMemories } from "../memory/service";

type Scope = {
  ctx: AppContext;
  agent: Member;
  owner: Member;
  asker: Member;
  mode: "owner" | "teammate";
  conversationId: string;
};

// Expected failures (unknown card, bad column name) become results the model can recover from;
// they're logged so they still show up in observability.
function safe<I, O>(fn: (input: I) => Promise<O>) {
  return async (input: I) => {
    try {
      return await fn(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[agent] tool failed: ${message}`);
      return { error: message };
    }
  };
}

// Board changes are attributed to the assistant so the team can see which moves an agent made;
// work logs are attributed to the owner. Write tools exist only in owner mode, except one for
// teammates: leaving a note for the owner. Privacy is enforced by what these functions query
// (`includePrivate` is false for teammates), not by the prompt.
export function assistantTools(scope: Scope): ToolSet {
  const { ctx, agent, owner, asker, mode } = scope;
  const ws = owner.workspaceId;
  const includePrivateFor = (person: Member) =>
    mode === "owner" && person.id === owner.id;

  const read = {
    team_directory: tool({
      description:
        "List the people and agents in the workspace with their handles and roles.",
      inputSchema: z.object({}),
      execute: safe(async () => {
        const people = await listMembers(ctx, ws);
        return people.map((m) => ({
          handle: m.handle,
          name: m.name,
          kind: m.kind,
          title: m.title,
          agentOf: m.ownerId,
          provider: m.agentProvider,
        }));
      }),
    }),

    work_snapshot: tool({
      description: `What someone is working on right now: their in-progress cards, cards waiting in Maybe?, and recent activity. Use "${owner.handle}" for ${owner.name}.`,
      inputSchema: z.object({
        person: z.string().describe("Handle or member id"),
        days: z
          .number()
          .int()
          .min(1)
          .max(60)
          .optional()
          .describe("How far back to look for activity (default 7)"),
      }),
      execute: safe(async ({ person, days }) => {
        const m = await resolveMember(ctx, owner, person);
        return await workSnapshot(ctx, m, {
          includePrivate: includePrivateFor(m),
          days,
        });
      }),
    }),

    search_activity: tool({
      description:
        "Search the activity stream (cards, GitHub, Slack, Discord, work logs, decisions, agents).",
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe("Text to match in titles and details"),
        person: z.string().optional().describe("Only activity by this handle"),
        source: z
          .enum(["worklog", "github", "slack", "discord", "api"])
          .optional(),
        kind: z
          .string()
          .optional()
          .describe("e.g. log.decision, log.blocker, pr.merged, card.closed"),
        days: z
          .number()
          .int()
          .min(1)
          .max(180)
          .optional()
          .describe("Look back this many days (default 14)"),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      execute: safe(async ({ query, person, source, kind, days, limit }) => {
        const who = person ? await resolveMember(ctx, owner, person) : null;
        const rows = await listActivities(
          ctx,
          ws,
          mode === "owner" ? [owner.id] : [],
          {
            q: query,
            actorIds: who ? [who.id] : undefined,
            source,
            kinds: kind ? [kind] : undefined,
            since: new Date(ctx.now().getTime() - (days ?? 14) * DAY_MS),
            limit: limit ?? 30,
          }
        );
        return rows.map((a) => ({
          at: a.occurredAt.toISOString(),
          actorId: a.actorId,
          kind: a.kind,
          source: a.source,
          title: a.title,
          detail: a.body?.slice(0, 400) ?? null,
          url: a.url,
        }));
      }),
    }),

    search_cards: tool({
      description: "Find cards on the board.",
      inputSchema: z.object({
        query: z.string().optional(),
        stage: z
          .enum(CARD_STAGES)
          .optional()
          .describe("triage = Maybe?, active = in a column, not_now, done"),
        assignee: z.string().optional().describe("Handle of an assignee"),
        golden: z.boolean().optional(),
      }),
      execute: safe(async ({ query, stage, assignee, golden }) => {
        const who = assignee ? await resolveMember(ctx, owner, assignee) : null;
        const rows = await board.listCards(ctx, ws, {
          q: query,
          stage,
          assigneeId: who?.id,
          golden,
          limit: 40,
        });
        return rows.map((c) => ({
          number: c.number,
          title: c.title,
          stage: c.stage,
          column: c.columnName,
          golden: c.golden,
          tags: c.tags,
          assigneeIds: c.assigneeIds,
          lastActiveAt: c.lastActiveAt.toISOString(),
        }));
      }),
    }),

    get_card: tool({
      description:
        "Full detail for one card: description, comments and its recent activity.",
      inputSchema: z.object({ number: z.number().int() }),
      execute: safe(async ({ number }) => {
        const card = await board.getCardDetail(ctx, ws, number);
        const history = await listActivities(
          ctx,
          ws,
          mode === "owner" ? [owner.id] : [],
          { cardId: card.id, limit: 20 }
        );
        return {
          ...card,
          comments: card.comments.map((c) => ({
            authorId: c.authorId,
            body: c.body,
            at: c.createdAt.toISOString(),
          })),
          history: history.map((a) => ({
            at: a.occurredAt.toISOString(),
            kind: a.kind,
            title: a.title,
            detail: a.body,
          })),
        };
      }),
    }),

    recall: tool({
      description: `What you have learned about ${owner.name}: profile (how they work, what they own), facts, and recent daily journal entries.`,
      inputSchema: z.object({ query: z.string().optional() }),
      execute: safe(async ({ query }) => {
        const memories = await listMemories(ctx, owner.id, {
          includePrivate: mode === "owner",
          q: query,
          limit: 60,
        });
        return memories.map((m) => ({
          id: m.id,
          kind: m.kind,
          day: m.day,
          content: m.content,
          visibility: m.visibility,
        }));
      }),
    }),
  };

  if (mode === "teammate") {
    return {
      ...read,
      leave_note_for_owner: tool({
        description: `Leave a note in ${owner.name}'s attention list on behalf of ${asker.name} — use when you can't answer, or ${asker.name} needs ${owner.name} to act.`,
        inputSchema: z.object({
          note: z
            .string()
            .describe(
              `What ${asker.name} needs from ${owner.name}, and why — self-contained`
            ),
          urgent: z.boolean().describe("True only if it blocks work today"),
          cardNumber: z.number().int().optional(),
        }),
        execute: safe(async ({ note, urgent, cardNumber }) => {
          const card =
            cardNumber === undefined
              ? null
              : await board.findCard(ctx, ws, cardNumber);
          await raiseAttention(ctx, {
            workspaceId: ws,
            memberId: owner.id,
            kind: "assistant.note",
            title: `${asker.name} asked your assistant: ${note.slice(0, 120)}`,
            body: note,
            cardId: card?.id ?? null,
            fromId: asker.id,
            priority: urgent ? "high" : "normal",
            dedupeKey: `note:${scope.conversationId}`,
          });
          return { ok: true, message: `Left a note for ${owner.name}.` };
        }),
      }),
    };
  }

  return {
    ...read,
    my_attention: tool({
      description: `${owner.name}'s open attention items (review requests, mentions, assignments, blockers, notes from teammates).`,
      inputSchema: z.object({}),
      execute: safe(async () => {
        const items = await listOpenAttention(ctx, owner.id, 50);
        return items.map((a) => ({
          id: a.id,
          kind: a.kind,
          title: a.title,
          detail: a.body,
          priority: a.priority,
          count: a.count,
          url: a.url,
          why: a.reason,
          actions: a.actions,
          since: a.createdAt.toISOString(),
        }));
      }),
    }),

    answer_attention: tool({
      description:
        "Answer an attention item's one-click question for them (e.g. a drifting card: keep / not_now / done).",
      inputSchema: z.object({ id: z.string(), actionId: z.string() }),
      execute: safe(async ({ id, actionId }) => {
        const row = await performAttentionAction(ctx, owner, id, actionId);
        return { ok: true, id: row.id, state: row.state };
      }),
    }),

    attention_feedback: tool({
      description: `Record ${owner.name}'s feedback on a ping, e.g. "stop pinging me about these" → less_like_this. Muted kinds go to digests instead.`,
      inputSchema: z.object({
        id: z.string(),
        signal: z.enum(["useful", "not_useful", "less_like_this"]),
      }),
      execute: safe(
        async ({ id, signal }) => await giveFeedback(ctx, owner.id, id, signal)
      ),
    }),

    resolve_attention: tool({
      description: "Mark an attention item done, dismissed, or snoozed.",
      inputSchema: z.object({
        id: z.string(),
        state: z.enum(["done", "dismissed", "snoozed"]),
        snoozeHours: z
          .number()
          .int()
          .min(1)
          .max(24 * 14)
          .optional(),
      }),
      execute: safe(async ({ id, state, snoozeHours }) => {
        const until =
          state === "snoozed"
            ? new Date(ctx.now().getTime() + (snoozeHours ?? 24) * 3_600_000)
            : null;
        const row = await updateAttention(ctx, owner.id, id, {
          state,
          snoozedUntil: until,
        });
        return { ok: true, id: row.id, state: row.state };
      }),
    }),

    remember: tool({
      description: `Save something durable about ${owner.name}. profile = how they work, what they own, preferences; fact = knowledge worth keeping (decisions, context, why).`,
      inputSchema: z.object({
        content: z.string().describe("One self-contained statement"),
        kind: z.enum(["profile", "fact"]),
        private: z
          .boolean()
          .describe("True if teammates asking this assistant must not see it"),
        supersedes: z
          .array(z.string())
          .optional()
          .describe("Ids of memories this replaces"),
      }),
      execute: safe(
        async ({ content, kind, private: isPrivate, supersedes }) => {
          const row = await addMemory(ctx, {
            workspaceId: ws,
            memberId: owner.id,
            kind,
            content,
            visibility: isPrivate ? "private" : "team",
            source: "agent",
            supersedes,
          });
          return { ok: true, id: row.id };
        }
      ),
    }),

    forget: tool({
      description: "Retire a memory that is wrong or outdated.",
      inputSchema: z.object({ id: z.string() }),
      execute: safe(async ({ id }) => {
        await forgetMemory(ctx, owner.id, id);
        return { ok: true };
      }),
    }),

    log_work: tool({
      description: `Record work ${owner.name} did that no connector saw (calls, chats, decisions, fixes).`,
      inputSchema: z.object({
        text: z.string(),
        kind: z.enum(LOG_KINDS).optional(),
        cardNumber: z.number().int().optional(),
        private: z.boolean().optional(),
      }),
      execute: safe(async ({ text, kind, cardNumber, private: isPrivate }) => {
        const { activity } = await logWork(ctx, owner, {
          text,
          kind,
          cardNumber,
          via: "agent",
          visibility: isPrivate === true ? "private" : "team",
        });
        return { ok: true, id: activity.id };
      }),
    }),

    create_card: tool({
      description:
        "Create a card. Without a column it lands in Maybe? for triage.",
      inputSchema: z.object({
        title: z.string(),
        body: z.string().optional(),
        board: z
          .string()
          .optional()
          .describe("Board name or id; defaults to the first board"),
        column: z
          .string()
          .optional()
          .describe("Column name to put it straight into"),
        assignToOwner: z.boolean().optional(),
      }),
      execute: safe(
        async ({ title, body, board: boardRef, column, assignToOwner }) => {
          const boards = await board.listBoards(ctx, ws);
          const target =
            boards.find(
              (b) =>
                b.id === boardRef ||
                b.name.toLowerCase() === boardRef?.toLowerCase()
            ) ?? boards[0];
          if (!target) {
            return { error: "There are no boards yet" };
          }
          const detail = await board.getBoard(ctx, ws, target.id);
          const col = column
            ? detail.columns.find(
                (c) => c.name.toLowerCase() === column.toLowerCase()
              )
            : undefined;
          const card = await board.createCard(ctx, agent, ws, {
            boardId: target.id,
            title,
            body,
            columnId: col?.id,
            assigneeIds: assignToOwner === true ? [owner.id] : [],
          });
          return { ok: true, number: card.number, stage: card.stage };
        }
      ),
    }),

    move_card: tool({
      description:
        'Move a card: to a column by name, or to "maybe", "not_now", or "done".',
      inputSchema: z.object({ number: z.number().int(), to: z.string() }),
      execute: safe(async ({ number, to }) => {
        const card = await moveCard(ctx, agent, ws, number, to);
        return {
          ok: true,
          number: card.number,
          stage: card.stage,
          column: card.columnName,
        };
      }),
    }),

    comment_on_card: tool({
      description: `Comment on a card as ${owner.name}'s assistant.`,
      inputSchema: z.object({ number: z.number().int(), body: z.string() }),
      execute: safe(async ({ number, body }) => {
        const c = await board.addComment(ctx, agent, number, body);
        return { ok: true, id: c.id };
      }),
    }),
  };
}

// `to` is "maybe", "not_now" or "done", or else the name of a column.
async function moveCard(
  ctx: AppContext,
  agent: Member,
  ws: string,
  number: number,
  to: string
) {
  const dest = to.toLowerCase().replaceAll(/[\s?]/gu, "");
  if (dest === "maybe" || dest === "triage") {
    return await board.sendBackToTriage(ctx, agent, ws, number);
  }
  if (dest === "notnow" || dest === "not_now") {
    return await board.postpone(ctx, agent, ws, number);
  }
  if (dest === "done") {
    return await board.close(ctx, agent, ws, number);
  }
  const c = await board.findCard(ctx, ws, number);
  const b = await board.getBoard(ctx, ws, c.boardId);
  const col = b.columns.find((x) => x.name.toLowerCase() === to.toLowerCase());
  if (!col) {
    throw new Error(
      `No column named "${to}" (columns: ${b.columns.map((x) => x.name).join(", ")})`
    );
  }
  return await board.triage(ctx, agent, ws, number, col.id);
}
