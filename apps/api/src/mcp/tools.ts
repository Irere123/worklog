import type { McpServer } from "@modelcontextprotocol/server";

import type { AppContext } from "#context";
import type { AgentGrant } from "#work/agents";

import { checkInTool } from "./tools/check-in";
import { commentOnCardTool } from "./tools/comment-on-card";
import { createCardTool } from "./tools/create-card";
import { getCardTool } from "./tools/get-card";
import { moveCardTool } from "./tools/move-card";
import { reportProgressTool } from "./tools/report-progress";
import { searchCardsTool } from "./tools/search-cards";

export function registerTools(
  server: McpServer,
  ctx: AppContext,
  grant: AgentGrant,
  can: { report: boolean; read: boolean; write: boolean }
) {
  if (can.report) {
    reportProgressTool(server, ctx, grant);
    checkInTool(server, ctx, grant);
  }
  if (can.read) {
    searchCardsTool(server, ctx, grant);
    getCardTool(server, ctx, grant);
  }
  if (can.write) {
    createCardTool(server, ctx, grant);
    moveCardTool(server, ctx, grant);
    commentOnCardTool(server, ctx, grant);
  }
}
