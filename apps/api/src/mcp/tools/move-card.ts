import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { AppContext } from "#context";
import { act } from "#mcp/writes";
import type { AgentGrant } from "#work/agents";

export function moveCardTool(
  server: McpServer,
  ctx: AppContext,
  grant: AgentGrant
) {
  server.registerTool(
    "move_card",
    {
      title: "Move a card",
      description:
        'Move a card to a column by name, or to "maybe", "not_now" or "done".',
      inputSchema: z.object({
        number: z.number().int().positive().describe("The card number"),
        to: z.string(),
      }),
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => await act(ctx, grant, "move_card", input)
  );
}
