import { z } from "@hono/zod-openapi";

import { ATTENTION_STATES, FEEDBACK_SIGNALS, PRIORITIES } from "#db/schema";

import { Timestamp } from "./common";

export const Attention = z
  .object({
    id: z.string(),
    kind: z.string(),
    title: z.string(),
    body: z.string().nullable(),
    url: z.string().nullable(),
    cardId: z.string().nullable(),
    activityId: z.string().nullable(),
    fromId: z.string().nullable(),
    priority: z.enum(PRIORITIES),
    state: z.enum(ATTENTION_STATES),
    count: z.number().int(),
    snoozedUntil: Timestamp.nullable(),
    disposition: z
      .enum(["push", "digest", "drop"])
      .nullable()
      .openapi({ description: "What the proactive check decided" }),
    reason: z
      .string()
      .nullable()
      .openapi({ description: "Why am I seeing this" }),
    pushedAt: Timestamp.nullable(),
    actions: z
      .array(z.object({ id: z.string(), label: z.string() }))
      .nullable()
      .openapi({
        description:
          "One-click answers: POST /v1/attention/{id}/actions/{actionId}",
      }),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi("AttentionItem");

export const AttentionListItem = Attention.extend({
  cardNumber: z.number().int().nullable().openapi({
    description: "The linked card's number, to open or fetch it",
  }),
}).openapi("AttentionListItem");

export const ListAttentionQuery = z.object({
  state: z.enum(ATTENTION_STATES).optional(),
});

export const UpdateAttentionRequest = z.object({
  state: z.enum(ATTENTION_STATES),
  snoozedUntil: z.iso.datetime().optional(),
});

export const ActionParams = z.object({ id: z.string(), actionId: z.string() });

export const FeedbackRequest = z.object({ signal: z.enum(FEEDBACK_SIGNALS) });

export const FeedbackResponse = z.object({
  kind: z.string(),
  muted: z.boolean(),
});

export const MetricsQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).optional(),
});

export const AttentionMetrics = z
  .object({
    days: z.number().int(),
    pushes: z.number().int(),
    itemsPushed: z.number().int(),
    actedOnRate: z.number().nullable(),
    dismissalRate: z.number().nullable(),
    feedback: z.object({
      useful: z.number().int(),
      not_useful: z.number().int(),
      less_like_this: z.number().int(),
    }),
    precision: z
      .number()
      .nullable()
      .openapi({ description: "useful / all rated pushes" }),
    mutedKinds: z.array(z.string()).openapi({
      description: "Kinds now held for digests because of your feedback",
    }),
  })
  .openapi("AttentionMetrics");
