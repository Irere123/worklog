import { createRoute } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";

import type { StoredEvent } from "#db/queries/events";
import { canSee } from "#events";
import { errors, router } from "#http/router";
import { Event, EventsQuery } from "#http/schemas/events";

const HEARTBEAT_MS = 10_000;

function createWaiter() {
  let wake: (() => void) | null = null;
  return {
    wake() {
      wake?.();
    },
    async wait(ms: number) {
      // oxlint-disable-next-line promise/avoid-new -- joining a timer and a callback into one awaitable is what the Promise constructor is for.
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, ms);
      });
      wake = null;
    },
  };
}

const frame = (e: StoredEvent) => ({
  id: String(e.seq),
  event: e.type,
  data: JSON.stringify(Event.parse(e)),
});

export const eventRoutes = router().openapi(
  createRoute({
    method: "get",
    path: "/v1/events",
    operationId: "event.subscribe",
    tags: ["Realtime"],
    summary:
      "Server-sent events: activity, cards, attention, briefs, messages, automation runs",
    request: { query: EventsQuery },
    responses: {
      200: {
        content: { "text/event-stream": { schema: Event } },
        description: "Event stream",
      },
      ...errors,
    },
  }),
  (c) => {
    const ctx = c.get("ctx");
    const me = c.get("member");
    const lastId = c.req.header("last-event-id");
    const after =
      c.req.valid("query").after ?? (lastId ? Number(lastId) : undefined);
    c.header("X-Accel-Buffering", "no");

    return streamSSE(c, async (stream) => {
      let cursor = after ?? Number.MAX_SAFE_INTEGER;
      const queue: StoredEvent[] = [];
      const waiter = createWaiter();
      const unsubscribe = ctx.bus.subscribe((e) => {
        if (!canSee(e, me.workspaceId, me.id)) {
          return;
        }
        queue.push(e);
        waiter.wake();
      });
      stream.onAbort(() => {
        unsubscribe();
        waiter.wake();
      });

      await stream.writeSSE({
        event: "server.connected",
        data: JSON.stringify({ memberId: me.id }),
      });
      if (after !== undefined) {
        for (const e of await ctx.bus.replay(me.workspaceId, me.id, after)) {
          await stream.writeSSE(frame(e));
          cursor = e.seq;
        }
        await stream.writeSSE({
          event: "server.synced",
          data: JSON.stringify({ seq: cursor }),
        });
      }

      while (!stream.aborted) {
        while (queue.length > 0) {
          for (const e of queue.splice(0)) {
            // Skip what the replay already sent.
            if (after === undefined || e.seq > cursor) {
              await stream.writeSSE(frame(e));
            }
          }
        }
        await waiter.wait(HEARTBEAT_MS);
        if (queue.length === 0 && !stream.aborted) {
          await stream.writeSSE({ event: "server.heartbeat", data: "{}" });
        }
      }
    });
  }
);
