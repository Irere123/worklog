import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { AppContext } from "#context";
import { generateId } from "#lib/ids";
import { firstName } from "#mcp/members";
import { reply } from "#mcp/reply";
import { spendWrite } from "#mcp/writes";
import { assertRoomToAsk, repeatsLastReport } from "#work/agents";
import type { AgentGrant } from "#work/agents";
import { reportWork } from "#work/report";

import { WAIT_MAX_S } from "./check-in";

export function reportProgressTool(
  server: McpServer,
  ctx: AppContext,
  grant: AgentGrant
) {
  const { agent, owner } = grant;
  server.registerTool(
    "report_progress",
    {
      title: "Report progress",
      description: `Tell ${owner.name}'s team where your task stands. Only "needs_you" notifies ${firstName(owner)} right away; "failed" soon after, "finished" in their next digest, and "working" only shows on the board.`,
      inputSchema: z.object({
        state: z.enum(["working", "needs_you", "finished", "failed"]),
        title: z
          .string()
          .min(1)
          .max(300)
          .describe(
            'One line a teammate understands, e.g. "Adding retries to the referrals sync"'
          ),
        details: z
          .string()
          .max(4000)
          .optional()
          .describe(
            "Markdown: the question and options for needs_you, what changed for finished, the error for failed"
          ),
        url: z
          .url()
          .optional()
          .describe("A pull request, branch, run or preview to look at"),
        card: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("The board card this work is for"),
        thread: z
          .string()
          .max(200)
          .optional()
          .describe("The thread an earlier report returned, for the same task"),
      }),
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async (input) =>
      await reply(async () => {
        const known =
          input.thread ??
          (input.card === undefined
            ? undefined
            : `mcp:${agent.id}:card-${input.card}`);
        const thread = known ?? `mcp:${generateId()}`;
        const repeated =
          known !== undefined &&
          (await repeatsLastReport(ctx, agent, { ...input, thread }));
        if (!repeated) {
          if (input.state === "needs_you") {
            await assertRoomToAsk(ctx, grant, thread);
          }
          spendWrite(ctx, agent);
          await reportWork(ctx, agent, {
            source: "mcp",
            kind: `agent.${input.state}`,
            title: input.title,
            body: input.details,
            url: input.url,
            cardNumber: input.card,
            thread,
            state: input.state,
          });
        }
        return input.state === "needs_you"
          ? {
              thread,
              next: `${firstName(owner)} was asked. Carry on with what doesn't depend on it, then check_in with this thread and wait: ${WAIT_MAX_S} to hear back.`,
            }
          : { thread };
      })
  );
}
