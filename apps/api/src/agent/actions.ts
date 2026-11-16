import { z } from "zod";

import { createAutomation } from "#automations/service";
import type { AppContext } from "#context";
import { getAttentionById } from "#db/queries/attention";
import { getBoardWithColumns, listBoards } from "#db/queries/boards";
import { getCardByNumber } from "#db/queries/cards";
import type { Member } from "#db/queries/members";
import { APPROVAL_KIND } from "#db/schema";
import { badRequest } from "#lib/errors";
import * as board from "#work/board";
import { performAttentionAction } from "#work/drift";
import { LOG_KINDS, logWork } from "#work/log";

/**
 * The writes an assistant makes that its owner's teammates will see, in one place: its tools run
 * them once the review agrees, and an approval the owner gives by hand runs exactly the one that
 * was proposed. Board changes are attributed to the assistant, so the team can see which moves an
 * agent made; work logs to the owner, since it is their work.
 */
export const ACTIONS = {
  comment_on_card: {
    input: z.object({ number: z.number().int(), body: z.string() }),
    describe: (i: { number: number; body: string }) =>
      `comment on #${i.number}: "${i.body.slice(0, 160)}"`,
    run: async (
      ctx: AppContext,
      agent: Member,
      _owner: Member,
      i: { number: number; body: string }
    ) => {
      const c = await board.addComment(ctx, agent, i.number, i.body);
      return { ok: true, id: c.id };
    },
  },
  move_card: {
    input: z.object({ number: z.number().int(), to: z.string() }),
    describe: (i: { number: number; to: string }) =>
      `move #${i.number} to ${i.to}`,
    run: async (
      ctx: AppContext,
      agent: Member,
      owner: Member,
      i: { number: number; to: string }
    ) => {
      const card = await moveCard(
        ctx,
        agent,
        owner.workspaceId,
        i.number,
        i.to
      );
      return {
        ok: true,
        number: card.number,
        stage: card.stage,
        column: card.columnName,
      };
    },
  },
  create_card: {
    input: z.object({
      title: z.string(),
      body: z.string().optional(),
      board: z.string().optional(),
      column: z.string().optional(),
      assignToOwner: z.boolean().optional(),
    }),
    describe: (i: { title: string }) => `create a card "${i.title}"`,
    run: async (
      ctx: AppContext,
      agent: Member,
      owner: Member,
      i: {
        title: string;
        body?: string;
        board?: string;
        column?: string;
        assignToOwner?: boolean;
      }
    ) => {
      const ws = owner.workspaceId;
      const boards = await listBoards(ctx.db, { workspaceId: ws });
      const target =
        boards.find(
          (b) =>
            b.id === i.board || b.name.toLowerCase() === i.board?.toLowerCase()
        ) ?? boards[0];
      if (!target) {
        return { error: "There are no boards yet" };
      }
      const detail = await getBoardWithColumns(ctx.db, {
        workspaceId: ws,
        id: target.id,
      });
      const column = i.column?.toLowerCase();
      const col = column
        ? detail.columns.find((c) => c.name.toLowerCase() === column)
        : undefined;
      const card = await board.createCard(ctx, agent, ws, {
        boardId: target.id,
        title: i.title,
        body: i.body,
        columnId: col?.id,
        assigneeIds: i.assignToOwner === true ? [owner.id] : [],
      });
      return { ok: true, number: card.number, stage: card.stage };
    },
  },
  answer_attention: {
    input: z.object({ id: z.string(), actionId: z.string() }),
    describe: (i: { actionId: string }) =>
      `answer an attention item with "${i.actionId}"`,
    run: async (
      ctx: AppContext,
      _agent: Member,
      owner: Member,
      i: { id: string; actionId: string }
    ) => {
      const item = await getAttentionById(ctx.db, {
        id: i.id,
        memberId: owner.id,
      });
      // Approving its own proposal would make the check meaningless.
      if (item.kind === APPROVAL_KIND) {
        throw badRequest(
          `Only ${owner.name} can answer their assistant's own requests for approval`
        );
      }
      const row = await performAttentionAction(ctx, owner, i.id, i.actionId);
      return { ok: true, id: row.id, state: row.state };
    },
  },
  log_work: {
    input: z.object({
      text: z.string(),
      kind: z.enum(LOG_KINDS).optional(),
      cardNumber: z.number().int().optional(),
    }),
    describe: (i: { text: string }) =>
      `log "${i.text.slice(0, 160)}" where the team sees it`,
    run: async (
      ctx: AppContext,
      _agent: Member,
      owner: Member,
      i: {
        text: string;
        kind?: (typeof LOG_KINDS)[number];
        cardNumber?: number;
      }
    ) => {
      const { activity } = await logWork(ctx, owner, {
        ...i,
        via: "agent",
        visibility: "team",
      });
      return { ok: true, id: activity.id };
    },
  },
  create_routine: {
    input: z.object({
      name: z.string().min(1).max(80),
      instructions: z.string().min(1).max(2000),
      schedule: z.union([
        z.object({
          type: z.literal("daily"),
          at: z.string().regex(/^\d{2}:\d{2}$/u),
          weekdays: z.array(z.number().int().min(0).max(6)).optional(),
        }),
        z.object({
          type: z.literal("weekly"),
          weekday: z.number().int().min(0).max(6),
          at: z.string().regex(/^\d{2}:\d{2}$/u),
        }),
      ]),
    }),
    describe: (i: { name: string; schedule: { type: string; at: string } }) =>
      `set up a routine "${i.name}" (${i.schedule.type} at ${i.schedule.at})`,
    run: async (
      ctx: AppContext,
      _agent: Member,
      owner: Member,
      i: {
        name: string;
        instructions: string;
        schedule:
          | { type: "daily"; at: string; weekdays?: number[] }
          | { type: "weekly"; weekday: number; at: string };
      }
    ) => {
      const row = await createAutomation(ctx, owner, {
        kind: "custom",
        name: i.name,
        instructions: i.instructions,
        schedule: i.schedule,
      });
      return { ok: true, id: row.id };
    },
  },
} as const;

export type ActionName = keyof typeof ACTIONS;

export function isAction(name: string): name is ActionName {
  return Object.hasOwn(ACTIONS, name);
}

// Loosely typed on purpose: `input` was validated against the action's own schema just before.
export async function runAction(
  ctx: AppContext,
  agent: Member,
  owner: Member,
  name: ActionName,
  input: unknown
) {
  const action = ACTIONS[name];
  const parsed = action.input.parse(input);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- parsed by this action's own schema on the line above
  return await (action.run as (...args: unknown[]) => Promise<unknown>)(
    ctx,
    agent,
    owner,
    parsed
  );
}

export function describeAction(name: ActionName, input: unknown) {
  const action = ACTIONS[name];
  const parsed = action.input.parse(input);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- parsed by this action's own schema on the line above
  return (action.describe as (i: unknown) => string)(parsed);
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
  const c = await getCardByNumber(ctx.db, { workspaceId: ws, number });
  const b = await getBoardWithColumns(ctx.db, {
    workspaceId: ws,
    id: c.boardId,
  });
  const col = b.columns.find((x) => x.name.toLowerCase() === to.toLowerCase());
  if (!col) {
    throw badRequest(
      `No column named "${to}" (columns: ${b.columns.map((x) => x.name).join(", ")})`
    );
  }
  return await board.triage(ctx, agent, ws, number, col.id);
}
