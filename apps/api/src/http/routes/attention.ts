import { createRoute, z } from "@hono/zod-openapi";

import { body, errors, Id, json, respond, router } from "#http/router";
import {
  ActionParams,
  Attention,
  AttentionMetrics,
  FeedbackRequest,
  FeedbackResponse,
  ListAttentionQuery,
  MetricsQuery,
  UpdateAttentionRequest,
} from "#http/schemas/attention";
import {
  attentionMetrics,
  giveFeedback,
  listAttention,
  updateAttention,
} from "#work/attention";
import { performAttentionAction } from "#work/drift";

export const attentionRoutes = router()
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/attention",
      operationId: "attention.list",
      tags: ["Attention"],
      summary: "What needs you — highest priority first",
      request: { query: ListAttentionQuery },
      responses: { 200: json(z.array(Attention)), ...errors },
    }),
    async (c) => {
      const rows = await listAttention(
        c.get("ctx"),
        c.get("member").id,
        c.req.valid("query").state
      );
      return respond(c, z.array(Attention), rows, 200);
    }
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/v1/attention/{id}",
      operationId: "attention.update",
      tags: ["Attention"],
      summary: "Mark done, dismiss, snooze or re-open",
      request: { params: Id, ...body(UpdateAttentionRequest) },
      responses: { 200: json(Attention), ...errors },
    }),
    async (c) => {
      const { state, snoozedUntil } = c.req.valid("json");
      const row = await updateAttention(
        c.get("ctx"),
        c.get("member").id,
        c.req.valid("param").id,
        {
          state,
          snoozedUntil: snoozedUntil ? new Date(snoozedUntil) : null,
        }
      );
      return respond(c, Attention, row, 200);
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/attention/{id}/feedback",
      operationId: "attention.feedback",
      tags: ["Attention"],
      summary: "Was this worth your attention? Teaches the proactive check",
      description:
        "`less_like_this` (or three `not_useful` without a `useful`) holds this kind of item for digests instead of pinging you.",
      request: { params: Id, ...body(FeedbackRequest) },
      responses: { 200: json(FeedbackResponse), ...errors },
    }),
    async (c) =>
      respond(
        c,
        FeedbackResponse,
        await giveFeedback(
          c.get("ctx"),
          c.get("member").id,
          c.req.valid("param").id,
          c.req.valid("json").signal
        ),
        200
      )
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/attention/{id}/actions/{actionId}",
      operationId: "attention.act",
      tags: ["Attention"],
      summary:
        "Answer an item's one-click question (e.g. a drifting card: keep / not now / done)",
      request: { params: ActionParams },
      responses: { 200: json(Attention), ...errors },
    }),
    async (c) => {
      const { id, actionId } = c.req.valid("param");
      return respond(
        c,
        Attention,
        await performAttentionAction(
          c.get("ctx"),
          c.get("member"),
          id,
          actionId
        ),
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/attention/metrics",
      operationId: "attention.metrics",
      tags: ["Attention"],
      summary:
        "How well your assistant's pings are doing: precision, engagement, muted kinds",
      request: { query: MetricsQuery },
      responses: { 200: json(AttentionMetrics), ...errors },
    }),
    async (c) =>
      respond(
        c,
        AttentionMetrics,
        await attentionMetrics(
          c.get("ctx"),
          c.get("member").id,
          c.req.valid("query").days
        ),
        200
      )
  );
