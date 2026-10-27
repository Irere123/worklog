import { z } from "@hono/zod-openapi";

import { EVENT_TYPES } from "#db/schema";

import { Timestamp } from "./common";

export const Event = z
  .object({
    seq: z.number().int(),
    type: z.enum(EVENT_TYPES),
    data: z.record(z.string(), z.unknown()),
    createdAt: Timestamp,
  })
  .openapi("Event");

export const EventsQuery = z.object({
  after: z.coerce
    .number()
    .int()
    .optional()
    .openapi({ description: "Replay events after this seq" }),
  token: z.string().optional().openapi({
    description: "API token, for clients that can't send headers",
  }),
});
