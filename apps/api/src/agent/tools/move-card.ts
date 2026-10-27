import { tool } from "ai";
import { z } from "zod";

import type { AppContext } from "#context";
import { getBoardWithColumns } from "#db/queries/boards";
import { getCardByNumber } from "#db/queries/cards";
import type { Member } from "#db/queries/members";
import * as board from "#work/board";

import { safe } from "./scope";
import type { Scope } from "./scope";

// Board changes are attributed to the assistant, so the team can see which moves an agent made.
export function moveCardTool({ ctx, agent, owner }: Scope) {
  return tool({
    description:
      'Move a card: to a column by name, or to "maybe", "not_now", or "done".',
    inputSchema: z.object({ number: z.number().int(), to: z.string() }),
    execute: safe(async ({ number, to }) => {
      const card = await moveCard(ctx, agent, owner.workspaceId, number, to);
      return {
        ok: true,
        number: card.number,
        stage: card.stage,
        column: card.columnName,
      };
    }),
  });
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
    throw new Error(
      `No column named "${to}" (columns: ${b.columns.map((x) => x.name).join(", ")})`
    );
  }
  return await board.triage(ctx, agent, ws, number, col.id);
}
