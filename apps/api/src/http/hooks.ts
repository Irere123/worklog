import { Hono } from "hono";
import type { Context } from "hono";

import type { AppContext } from "#context";
import { receive } from "#ingest/pipeline";
import { receiveForApp } from "#ingest/routing";
import { readBounded } from "#lib/body";

type HookEnv = { Variables: { ctx: AppContext } };

export function hookRoutes() {
  const app = new Hono<HookEnv>();
  app.post("/hooks/apps/:provider", async (c) => await handleApp(c));
  app.post("/hooks/apps/:provider/:channel", async (c) => await handleApp(c));
  app.post("/hooks/:id", async (c) => await handle(c));
  app.post("/hooks/:id/:channel", async (c) => await handle(c));
  return app;
}

async function handleApp(
  c: Context<
    HookEnv,
    "/hooks/apps/:provider" | "/hooks/apps/:provider/:channel"
  >
) {
  const ctx = c.get("ctx");
  const rawBody = await boundedBody(c.req.raw);
  if (rawBody === null) {
    return tooLarge();
  }
  const result = await receiveForApp(ctx, c.req.param("provider"), {
    channel: c.req.param("channel") ?? "",
    headers: c.req.raw.headers,
    rawBody,
    receivedAt: ctx.now(),
  });
  return Response.json(result.body, { status: result.status });
}

async function handle(
  c: Context<HookEnv, "/hooks/:id" | "/hooks/:id/:channel">
) {
  const ctx = c.get("ctx");
  const rawBody = await boundedBody(c.req.raw);
  if (rawBody === null) {
    return tooLarge();
  }
  const result = await receive(ctx, c.req.param("id"), {
    channel: c.req.param("channel") ?? "",
    headers: c.req.raw.headers,
    rawBody,
    receivedAt: ctx.now(),
  });
  return Response.json(result.body, { status: result.status });
}

const MAX_BODY = 25 * 1024 * 1024;

async function boundedBody(req: Request) {
  const bytes = await readBounded(req, MAX_BODY);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}

function tooLarge() {
  return Response.json({ error: "payload too large" }, { status: 413 });
}
