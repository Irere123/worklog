import { tool } from "ai";
import { z } from "zod";

import { createCard } from "#board/service";
import { getBoardWithColumns, listBoards } from "#db/queries/boards";

import { safe } from "./scope";
import type { Scope } from "./scope";

// Board changes are attributed to the assistant, so the team can see which moves an agent made.
export function createCardTool({ ctx, agent, owner }: Scope) {
  const ws = owner.workspaceId;
  return tool({
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
        const boards = await listBoards(ctx.db, { workspaceId: ws });
        const target =
          boards.find(
            (b) =>
              b.id === boardRef ||
              b.name.toLowerCase() === boardRef?.toLowerCase()
          ) ?? boards[0];
        if (!target) {
          return { error: "There are no boards yet" };
        }
        const detail = await getBoardWithColumns(ctx.db, {
          workspaceId: ws,
          id: target.id,
        });
        const col = column
          ? detail.columns.find(
              (c) => c.name.toLowerCase() === column.toLowerCase()
            )
          : undefined;
        const card = await createCard(ctx, agent, ws, {
          boardId: target.id,
          title,
          body,
          columnId: col?.id,
          assigneeIds: assignToOwner === true ? [owner.id] : [],
        });
        return { ok: true, number: card.number, stage: card.stage };
      }
    ),
  });
}
