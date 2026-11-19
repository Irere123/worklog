import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { AppContext } from "#context";
import { CARD_STAGES } from "#db/schema";
import { assigneeOf, handlesIn, handlesOf } from "#mcp/members";
import { reply } from "#mcp/reply";
import type { AgentGrant } from "#work/agents";
import { listCards } from "#work/board";

const CARDS_SHOWN = 20;

export function searchCardsTool(
  server: McpServer,
  ctx: AppContext,
  grant: AgentGrant
) {
  server.registerTool(
    "search_cards",
    {
      title: "Search the board",
      description: `Find cards on the team's board by words in their title or description, stage or assignee; the ${CARDS_SHOWN} most recently active.`,
      inputSchema: z.object({
        query: z.string().optional(),
        stage: z
          .enum(CARD_STAGES)
          .optional()
          .describe(
            "triage: not started (Maybe?), active: in a column, not_now: set aside, done"
          ),
        assignee: z
          .string()
          .optional()
          .describe(
            `A teammate's handle, or "mine" for ${grant.owner.name}'s cards`
          ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, stage, assignee }) =>
      await reply(async () => {
        const assigneeId =
          assignee === undefined
            ? undefined
            : await assigneeOf(ctx, grant, assignee);
        const rows = await listCards(ctx, grant.agent.workspaceId, {
          q: query,
          stage,
          assigneeId,
          limit: CARDS_SHOWN + 1,
        });
        if (!rows.length) {
          return "No card matches. Try fewer words, or leave out stage and assignee.";
        }
        const shown = rows.slice(0, CARDS_SHOWN);
        const handles = await handlesOf(
          ctx,
          shown.flatMap((c) => c.assigneeIds)
        );
        return {
          cards: shown.map((c) => ({
            card: c.number,
            title: c.title,
            stage: c.stage,
            column: c.columnName,
            assignees: handlesIn(handles, c.assigneeIds),
            tags: c.tags,
            lastActiveAt: c.lastActiveAt,
          })),
          more:
            rows.length > CARDS_SHOWN
              ? "More match: narrow the query, stage or assignee"
              : null,
        };
      })
  );
}
