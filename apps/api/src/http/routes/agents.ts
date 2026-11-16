import { createRoute, z } from "@hono/zod-openapi";

import { errors, json, Ok, respond, router } from "#http/router";
import {
  AgentApproval,
  AgentApprovalQuery,
  AgentConnection,
} from "#http/schemas/agents";
import { MemberRef } from "#http/schemas/members";
import { forbidden } from "#lib/errors";
import {
  agentApproval,
  disconnectAgent,
  listConnectedAgents,
} from "#work/agents";
import { resolveMember } from "#work/members";

export const agentConnectionRoutes = router()
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/agent-approval",
      operationId: "agentApproval.get",
      tags: ["Agents"],
      summary:
        "What a coding agent asking to connect is, and where it could work",
      description:
        "For the approval page an MCP client's sign-in lands on. It reads the browser's session and ignores any API key: an approval is a person's own decision, and the token goes to whoever that session belongs to. Without a session it answers 401.",
      request: { query: AgentApprovalQuery },
      responses: { 200: json(AgentApproval), ...errors },
    }),
    async (c) => {
      const user = c.get("user");
      if (!user) {
        throw forbidden("Approving an agent needs a signed-in person");
      }
      return respond(
        c,
        AgentApproval,
        await agentApproval(c.get("ctx"), user, c.req.valid("query").clientId),
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/agent-connections",
      operationId: "agentConnection.list",
      tags: ["Agents"],
      summary: "Coding agents that connected themselves over MCP",
      description:
        "Yours, or everyone's for admins: which tool each is, whether its domain vouches for it, and when it last called.",
      responses: { 200: json(z.array(AgentConnection)), ...errors },
    }),
    async (c) =>
      respond(
        c,
        z.array(AgentConnection),
        await listConnectedAgents(c.get("ctx"), c.get("member")),
        200
      )
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/members/{ref}/disconnect",
      operationId: "member.disconnect",
      tags: ["Agents"],
      summary: "Disconnect a coding agent that connected itself",
      description:
        "Revokes every approval it holds and takes it off the team; its history stays. Connecting it again asks its person to approve it again. Its person or an admin can do this.",
      request: { params: MemberRef },
      responses: { 200: json(Ok), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const agent = await resolveMember(ctx, me, c.req.valid("param").ref);
      await disconnectAgent(ctx, me, agent);
      return respond(c, Ok, { ok: true }, 200);
    }
  );
