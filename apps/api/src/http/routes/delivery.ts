import { createRoute, z } from "@hono/zod-openapi";

import {
  createTarget,
  deleteTarget,
  deliver,
  updateTarget,
} from "#automations/delivery";
import { listDeliveryTargets } from "#db/queries/delivery-targets";
import { body, errors, Id, json, Ok, respond, router } from "#http/router";
import {
  CreateTargetRequest,
  Target,
  TargetTestResponse,
  UpdateTargetRequest,
} from "#http/schemas/delivery";

export const deliveryRoutes = router()
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/delivery-targets",
      operationId: "target.list",
      tags: ["Delivery"],
      responses: { 200: json(z.array(Target)), ...errors },
    }),
    async (c) => {
      const rows = await listDeliveryTargets(c.get("ctx").db, {
        memberId: c.get("member").id,
      });
      return respond(c, z.array(Target), rows, 200);
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/delivery-targets",
      operationId: "target.create",
      tags: ["Delivery"],
      summary: "Add a place to receive briefs and notifications",
      description:
        "email: an address. slack: a channel id (C…) or your user id (U…) for a DM, plus the Slack connectionId. discord: a channel id plus connectionId, or a channel webhook URL. webhook: any https URL (works with ntfy, Pushover bridges, Zapier…). Only your own email address and a Slack DM to you start as private; set `visibility` to private for anything else only you read, such as your own ntfy topic.",
      request: body(CreateTargetRequest),
      responses: { 201: json(Target, "Created"), ...errors },
    }),
    async (c) =>
      respond(
        c,
        Target,
        await createTarget(c.get("ctx"), c.get("member"), c.req.valid("json")),
        201
      )
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/v1/delivery-targets/{id}",
      operationId: "target.update",
      tags: ["Delivery"],
      summary: "Rename a target, or say who reads it",
      request: { params: Id, ...body(UpdateTargetRequest) },
      responses: { 200: json(Target), ...errors },
    }),
    async (c) =>
      respond(
        c,
        Target,
        await updateTarget(
          c.get("ctx"),
          c.get("member").id,
          c.req.valid("param").id,
          c.req.valid("json")
        ),
        200
      )
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/delivery-targets/{id}/test",
      operationId: "target.test",
      tags: ["Delivery"],
      summary: "Send a test message",
      request: { params: Id },
      responses: { 200: json(TargetTestResponse), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const { delivered, failed } = await deliver(
        ctx,
        me.id,
        [c.req.valid("param").id],
        {
          type: "test",
          subject: "Worklog test message",
          markdown: `Hi ${me.name} — this is where your Worklog briefs and notifications will arrive.`,
        }
      );
      return respond(
        c,
        TargetTestResponse,
        { delivered: delivered.length > 0, error: failed[0]?.error ?? null },
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/v1/delivery-targets/{id}",
      operationId: "target.delete",
      tags: ["Delivery"],
      request: { params: Id },
      responses: { 200: json(Ok), ...errors },
    }),
    async (c) => {
      await deleteTarget(
        c.get("ctx"),
        c.get("member").id,
        c.req.valid("param").id
      );
      return respond(c, Ok, { ok: true }, 200);
    }
  );
