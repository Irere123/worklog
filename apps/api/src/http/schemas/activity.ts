import { z } from "@hono/zod-openapi";

import { VISIBILITY } from "#db/schema";

import { Timestamp } from "./common";

export const Activity = z
  .object({
    id: z.string(),
    actorId: z.string().nullable(),
    source: z.string(),
    kind: z.string().openapi({ example: "pr.merged" }),
    title: z.string(),
    body: z.string().nullable(),
    url: z.string().nullable(),
    cardId: z.string().nullable(),
    visibility: z.enum(VISIBILITY),
    data: z.record(z.string(), z.unknown()),
    connectionId: z.string().nullable(),
    actorIdentityId: z.string().nullable().openapi({
      description:
        "The external account that did it (set even when not matched to a member yet)",
    }),
    onBehalfOfId: z
      .string()
      .nullable()
      .openapi({ description: "For agent work: the person it was done for" }),
    agentState: z
      .enum(["working", "needs_you", "finished", "failed"])
      .nullable(),
    threadKey: z.string().nullable().openapi({
      description: "Related events share a thread, e.g. github:acme/api#7",
    }),
    importance: z.number(),
    count: z.number().int().openapi({
      description:
        "How many events were merged into this one (bursts of commits, comments, replies)",
    }),
    occurredAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi("Activity");

export const ListActivitiesQuery = z.object({
  actor: z
    .string()
    .optional()
    .openapi({ description: 'Member id, handle or "me"' }),
  source: z.string().optional().openapi({ example: "github" }),
  kind: z.string().optional().openapi({ example: "log.decision" }),
  card: z.coerce
    .number()
    .int()
    .optional()
    .openapi({ description: "Card number" }),
  since: z.iso.datetime().optional(),
  until: z.iso.datetime().optional(),
  q: z.string().optional(),
  before: z.string().optional().openapi({
    description: "Cursor: an activity id from the previous page",
  }),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const CreateActivityRequest = z.object({
  kind: z.string().min(1).openapi({ example: "agent.task" }),
  title: z.string().min(1).max(300),
  body: z.string().max(4000).optional(),
  url: z.url().optional(),
  cardNumber: z.number().int().optional(),
  visibility: z.enum(VISIBILITY).optional(),
  externalId: z.string().optional(),
  occurredAt: z.iso.datetime().optional(),
  thread: z.string().max(300).optional().openapi({
    description: "Groups updates on one task, e.g. cursor:bc-123",
  }),
  importance: z.number().min(0).max(1).optional(),
  onBehalfOf: z.string().optional().openapi({
    description: "Member id or handle of the human this was done for",
  }),
  state: z.enum(["working", "needs_you", "finished", "failed"]).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const ActivityCountsQuery = z.object({
  since: z.iso.datetime(),
});

export const ActivityCounts = z
  .array(
    z.object({
      kind: z.string().openapi({ example: "card.closed" }),
      count: z.number().int(),
    })
  )
  .openapi("ActivityCounts");
