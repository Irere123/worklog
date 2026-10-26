import { Hono } from "hono";
import type { Context } from "hono";

import type { AppContext } from "../context";
import { receive } from "../ingest/pipeline";

type HookEnv = { Variables: { ctx: AppContext } };

/**
 * Inbound webhooks for every connector: `/hooks/{connectionId}` plus an optional channel
 * (`/events`, `/commands`, `/interactions`). Not bearer-authenticated — each connection has its own
 * URL and the provider's signature over the raw body is what authenticates the request.
 */
export function hookRoutes() {
  const app = new Hono<HookEnv>();
  app.post("/hooks/:id", async (c) => await handle(c));
  app.post("/hooks/:id/:channel", async (c) => await handle(c));
  return app;
}

async function handle(
  c: Context<HookEnv, "/hooks/:id" | "/hooks/:id/:channel">
) {
  const ctx = c.get("ctx");
  const result = await receive(ctx, c.req.param("id"), {
    channel: c.req.param("channel") ?? "",
    headers: c.req.raw.headers,
    rawBody: await c.req.text(),
    receivedAt: ctx.now(),
  });
  return Response.json(result.body, { status: result.status });
}
