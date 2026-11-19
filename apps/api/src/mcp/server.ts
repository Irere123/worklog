import { McpServer } from "@modelcontextprotocol/server";

import type { AppContext } from "#context";
import type { ApiScope } from "#db/schema";
import type { AgentGrant } from "#work/agents";

import { instructions } from "./instructions";
import { registerTools } from "./tools";

/**
 * The Worklog a coding agent sees over MCP, built per request for the agent the token speaks for.
 * Tools its approval didn't grant aren't listed at all, so a model never plans around a tool that
 * will refuse it.
 */
export function agentServer(ctx: AppContext, grant: AgentGrant) {
  const can = (scope: ApiScope) => grant.scopes.includes(scope);
  const server = new McpServer(
    {
      name: "worklog",
      title: "Worklog",
      version: ctx.config.WORKLOG_RELEASE,
    },
    {
      instructions: instructions(grant, {
        read: can("read"),
        write: can("write"),
      }),
    }
  );
  registerTools(server, ctx, grant, {
    report: can("ingest") || can("write"),
    read: can("read"),
    write: can("write"),
  });
  return server;
}
