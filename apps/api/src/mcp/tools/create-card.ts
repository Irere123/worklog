import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { AppContext } from "#context";
import { act } from "#mcp/writes";
import type { AgentGrant } from "#work/agents";

export function createCardTool(
  server: McpServer,
  ctx: AppContext,
  grant: AgentGrant
) {
  server.registerTool(
    "create_card",
    {
      title: "Create a card",
      description:
        "Put work on the board that isn't there yet. Without a column it lands in Maybe? for the team to triage.",
      inputSchema: z.object({
        title: z.string().min(1).max(200),
        body: z.string().max(4000).optional().describe("Markdown"),
        board: z
          .string()
          .optional()
          .describe("Board name; the first if left out"),
        column: z
          .string()
          .optional()
          .describe("Column name, to start it there"),
        assignToOwner: z
          .boolean()
          .optional()
          .describe(`Assign it to ${grant.owner.name}`),
      }),
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async (input) => await act(ctx, grant, "create_card", input)
  );
}
