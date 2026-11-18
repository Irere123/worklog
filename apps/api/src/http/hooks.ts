import { Hono } from "hono";
import type { Context } from "hono";

import type { AppContext } from "#context";
import { receive } from "#ingest/pipeline";
import { receiveForApp } from "#ingest/routing";

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
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY || !req.body) {
    return declared > MAX_BODY ? null : "";
  }
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const read = await reader.read();
    if (read.done) {
      break;
    }
    const chunk: unknown = read.value;
    if (!(chunk instanceof Uint8Array)) {
      throw new TypeError("A request body chunk wasn't bytes");
    }
    size += chunk.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function tooLarge() {
  return Response.json({ error: "payload too large" }, { status: 413 });
}
