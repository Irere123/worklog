import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppContext } from "../context";
import { receive } from "../ingest/pipeline";

/**
 * Inbound webhooks for every connector: `/hooks/{connectionId}` plus an optional channel
 * (`/events`, `/commands`, `/interactions`). Not bearer-authenticated — each connection has its own
 * URL and the provider's signature over the raw body is what authenticates the request.
 */
export function hookRoutes() {
  const app = new Hono<{ Variables: { ctx: AppContext } }>();
  const handle = async (c: { get(k: "ctx"): AppContext; req: { param(k: string): string | undefined; text(): Promise<string>; raw: Request }; json: (b: unknown, s: ContentfulStatusCode) => Response }) => {
    const ctx = c.get("ctx");
    const result = await receive(ctx, c.req.param("id")!, {
      channel: c.req.param("channel") ?? "",
      headers: c.req.raw.headers,
      rawBody: await c.req.text(),
      receivedAt: ctx.now(),
    });
    return c.json(result.body, result.status as ContentfulStatusCode);
  };
  app.post("/hooks/:id", (c) => handle(c));
  app.post("/hooks/:id/:channel", (c) => handle(c));
  return app;
}
