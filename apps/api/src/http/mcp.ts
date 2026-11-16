import { requireMcpAuth } from "@better-auth/mcp";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { Hono } from "hono";

import type { AppContext } from "#context";
import { AGENT_TOKEN_SCOPES, mcpAvailable, mcpResource } from "#lib/auth";
import { ApiError } from "#lib/errors";
import { agentServer } from "#mcp/server";
import { log } from "#telemetry/log";
import { agentForToken } from "#work/agents";

type McpEnv = { Variables: { ctx: AppContext } };

/**
 * Where coding agents connect. An agent with no token gets a challenge naming this server's
 * metadata, which leads its client through Worklog's own sign-in and approval and back here; so
 * adding the URL to the tool is the whole setup.
 */
export function mcpRoutes(ctx: AppContext) {
  const app = new Hono<McpEnv>();
  if (!mcpAvailable(ctx.config)) {
    log.warn("mcp: off until PUBLIC_URL is https", {
      publicUrl: ctx.config.PUBLIC_URL,
    });
    app.all("/mcp", (c) =>
      c.json(
        {
          error: {
            code: "mcp_unavailable",
            message:
              "Coding agents connect over HTTPS: this server's PUBLIC_URL needs an https:// address",
          },
        },
        404
      )
    );
    return app;
  }
  const resource = mcpResource(ctx.config);
  const metadata = new URL(
    "/.well-known/oauth-protected-resource/mcp",
    ctx.config.PUBLIC_URL
  ).toString();

  const serve = requireMcpAuth(
    ctx.auth,
    async (request, claims) => {
      let grant;
      try {
        grant = await agentForToken(ctx, claims);
      } catch (error) {
        if (error instanceof ApiError) {
          return refusal(error, metadata);
        }
        throw error;
      }
      // Built per request around the caller: tools and instructions differ by agent and grant.
      const handler = createMcpHandler(() => agentServer(ctx, grant), {
        onerror: (error) => {
          log.warn("mcp: request failed", { error });
        },
      });
      return await handler.fetch(request);
    },
    { resource, challengeScopes: AGENT_TOKEN_SCOPES }
  );

  app.post("/mcp", async (c) => await serve(c.req.raw));
  // Stateless: there is no session stream to open or end.
  app.on(["GET", "DELETE"], "/mcp", (c) =>
    c.json({ error: { code: "method_not_allowed", message: "POST only" } }, 405)
  );
  // OAuth discovery documents (RFC 9728, RFC 8414) live at the root, outside /api/auth.
  app.get(
    "/.well-known/*",
    async (c) => await c.get("ctx").auth.handler(c.req.raw)
  );
  return app;
}

// A 401 carries the challenge, so the client signs in again instead of giving up.
function refusal(error: ApiError, metadata: string) {
  const headers = new Headers();
  if (error.status === 401) {
    headers.set(
      "www-authenticate",
      `Bearer error="invalid_token", error_description="${error.message.replaceAll('"', "'")}", resource_metadata="${metadata}"`
    );
  }
  return Response.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32_001, message: error.message },
    },
    { status: error.status, headers }
  );
}
