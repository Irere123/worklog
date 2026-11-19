import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { AppContext } from "#context";
import { listComments } from "#db/queries/cards";
import { handlesIn, handlesOf } from "#mcp/members";
import { reply } from "#mcp/reply";
import type { AgentGrant } from "#work/agents";
import { getCard } from "#work/board";

const COMMENTS_SHOWN = 20;

export function getCardTool(
  server: McpServer,
  ctx: AppContext,
  grant: AgentGrant
) {
  server.registerTool(
    "get_card",
    {
      title: "Read a card",
      description: `A card in full: what's wanted, where it stands, who is on it, and its latest ${COMMENTS_SHOWN} comments.`,
      inputSchema: z.object({ card: z.number().int().positive() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ card }) =>
      await reply(async () => {
        const c = await getCard(ctx, grant.agent.workspaceId, card);
        const latest = await listComments(ctx.db, {
          cardId: c.id,
          latest: COMMENTS_SHOWN + 1,
        });
        const comments = latest.slice(-COMMENTS_SHOWN);
        const handles = await handlesOf(ctx, [
          ...c.assigneeIds,
          ...comments.map((m) => m.authorId),
        ]);
        return {
          card: c.number,
          title: c.title,
          body: c.body,
          stage: c.stage,
          column: c.columnName,
          assignees: handlesIn(handles, c.assigneeIds),
          tags: c.tags,
          dueOn: c.dueOn,
          earlierComments: latest.length > COMMENTS_SHOWN ? true : null,
          comments: comments.map((m) => ({
            from: m.authorId ? handles.get(m.authorId) : null,
            at: m.createdAt,
            body: m.body,
          })),
        };
      })
  );
}
