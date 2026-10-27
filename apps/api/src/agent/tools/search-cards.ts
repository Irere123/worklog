import { tool } from "ai";
import { z } from "zod";

import { listCards } from "#board/service";
import { CARD_STAGES } from "#db/schema";
import { resolveMember } from "#members/service";

import { safe } from "./scope";
import type { Scope } from "./scope";

export function searchCardsTool({ ctx, owner }: Scope) {
  return tool({
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
      const rows = await listCards(ctx, owner.workspaceId, {
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
  });
}
