import { z } from "@hono/zod-openapi";

import { Timestamp } from "./common";

export const Brief = z
  .object({
    id: z.string(),
    period: z.enum(["daily", "weekly"]),
    periodStart: Timestamp,
    periodEnd: Timestamp,
    title: z.string(),
    body: z.string().openapi({ description: "Markdown" }),
    data: z.record(z.string(), z.unknown()).openapi({
      description:
        "The structured data the brief was written from, for native rendering",
    }),
    composedBy: z.string(),
    createdAt: Timestamp,
  })
  .openapi("Brief");

export const ListBriefsQuery = z.object({
  period: Brief.shape.period.optional(),
});

export const CreateBriefRequest = z.object({
  period: Brief.shape.period.default("daily"),
  deliverTo: z
    .array(z.string())
    .optional()
    .openapi({ description: "Delivery target ids" }),
});
