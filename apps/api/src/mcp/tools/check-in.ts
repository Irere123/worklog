import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { AppContext } from "#context";
import { reply } from "#mcp/reply";
import { checkIn } from "#work/agents";
import type { AgentGrant } from "#work/agents";

export const WAIT_MAX_S = 50;

const STATUS = {
  open: "waiting",
  snoozed: "snoozed",
  done: "resolved",
  dismissed: "dismissed",
} as const;

export function checkInTool(
  server: McpServer,
  ctx: AppContext,
  grant: AgentGrant
) {
  server.registerTool(
    "check_in",
    {
      title: "Check for an answer",
      description: `Whether ${grant.owner.name} answered your latest "needs_you" on a thread, and what they wrote back, in their inbox or on its card.`,
      inputSchema: z.object({
        thread: z.string().describe("The thread report_progress returned"),
        wait: z
          .number()
          .int()
          .min(0)
          .max(WAIT_MAX_S)
          .optional()
          .describe(
            `Seconds to hold for an answer, up to ${WAIT_MAX_S}, instead of calling again. Use it when nothing else is left to do.`
          ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ thread, wait }, extra) =>
      await reply(async () => {
        const asked = await checkIn(ctx, grant, thread, {
          waitMs: (wait ?? 0) * 1000,
          signal: extra.mcpReq.signal,
        });
        if (!asked) {
          return {
            status: "not_asked",
            note: 'Nothing on this thread is waiting. Ask with report_progress state "needs_you".',
          };
        }
        const status = STATUS[asked.item.state];
        return {
          status,
          resolvedAt: asked.item.resolvedAt,
          replies: asked.replies,
          next:
            status === "waiting" &&
            (wait ?? 0) === 0 &&
            asked.replies.length === 0
              ? `Not answered yet. check_in with wait: ${WAIT_MAX_S} to hold for it.`
              : null,
        };
      })
  );
}
