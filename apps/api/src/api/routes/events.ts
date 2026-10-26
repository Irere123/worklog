import { createRoute, z } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import { canSee, EVENT_TYPES, type StoredEvent } from "../../events/bus";
import { errors, router } from "../router";

const HEARTBEAT_MS = 10_000;

export const EventSchema = z
  .object({
    seq: z.number().int(),
    type: z.enum(EVENT_TYPES),
    data: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
  })
  .openapi("Event");

const frame = (e: StoredEvent) => ({
  id: String(e.seq),
  event: e.type,
  data: JSON.stringify({ seq: e.seq, type: e.type, data: e.data, createdAt: e.createdAt.toISOString() }),
});

/**
 * One realtime stream for every client. Frames carry `id: <seq>`; reconnect with
 * `Last-Event-ID` (EventSource does this automatically) or `?after=<seq>` and missed
 * events are replayed first. Browsers can't set headers on EventSource, so `?token=` is accepted here.
 */
export const eventRoutes = router().openapi(
  createRoute({
    method: "get",
    path: "/v1/events",
    operationId: "event.subscribe",
    tags: ["Realtime"],
    summary: "Server-sent events: activity, cards, attention, briefs, messages, automation runs",
    request: {
      query: z.object({
        after: z.coerce.number().int().optional().openapi({ description: "Replay events after this seq" }),
        token: z.string().optional().openapi({ description: "API token, for clients that can't send headers" }),
      }),
    },
    responses: {
      200: { content: { "text/event-stream": { schema: EventSchema } }, description: "Event stream" },
      ...errors,
    },
  }),
  (c) => {
    const ctx = c.get("ctx");
    const me = c.get("member");
    const lastId = c.req.header("last-event-id");
    const after = c.req.valid("query").after ?? (lastId ? Number(lastId) : undefined);
    c.header("X-Accel-Buffering", "no");

    return streamSSE(c, async (stream) => {
      let cursor = after ?? Number.MAX_SAFE_INTEGER;
      const queue: StoredEvent[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = ctx.bus.subscribe((e) => {
        if (!canSee(e, me.workspaceId, me.id)) return;
        queue.push(e);
        wake?.();
      });
      stream.onAbort(() => {
        unsubscribe();
        wake?.();
      });

      await stream.writeSSE({ event: "server.connected", data: JSON.stringify({ memberId: me.id }) });
      if (after !== undefined) {
        for (const e of await ctx.bus.replay(me.workspaceId, me.id, after)) {
          await stream.writeSSE(frame(e));
          cursor = e.seq;
        }
        await stream.writeSSE({ event: "server.synced", data: JSON.stringify({ seq: cursor }) });
      }

      while (!stream.aborted) {
        while (queue.length) {
          const e = queue.shift()!;
          if (after !== undefined && e.seq <= cursor) continue; // already sent during replay
          await stream.writeSSE(frame(e));
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, HEARTBEAT_MS);
        });
        wake = null;
        if (!queue.length && !stream.aborted) await stream.writeSSE({ event: "server.heartbeat", data: "{}" });
      }
    });
  },
);
