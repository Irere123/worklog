import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { AppContext } from "#context";
import { act } from "#mcp/writes";
import type { AgentGrant } from "#work/agents";

export function commentOnCardTool(
  server: McpServer,
  ctx: AppContext,
  grant: AgentGrant
) {
  server.registerTool(
    "comment_on_card",
    {
      title: "Comment on a card",
      description:
        "Add to a card's discussion. Mention a teammate with @handle to bring them in.",
      inputSchema: z.object({
        number: z.number().int().positive().describe("The card number"),
        body: z.string().min(1).max(4000).describe("Markdown"),
      }),
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async (input) => await act(ctx, grant, "comment_on_card", input)
  );
}
