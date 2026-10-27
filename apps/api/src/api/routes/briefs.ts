import { createRoute, z } from "@hono/zod-openapi";

import { body, errors, Id, json, respond, router } from "#api/router";
import {
  Brief,
  CreateBriefRequest,
  ListBriefsQuery,
} from "#api/schemas/briefs";
import { generateBrief } from "#automations/briefs";
import { deliver } from "#automations/delivery";
import { getBriefById, listBriefs } from "#db/queries/briefs";

export const briefRoutes = router()
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/briefs",
      operationId: "brief.list",
      tags: ["Briefs"],
      request: { query: ListBriefsQuery },
      responses: { 200: json(z.array(Brief)), ...errors },
    }),
    async (c) => {
      const rows = await listBriefs(c.get("ctx").db, {
        memberId: c.get("member").id,
        period: c.req.valid("query").period,
      });
      return respond(c, z.array(Brief), rows, 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/briefs/{id}",
      operationId: "brief.get",
      tags: ["Briefs"],
      request: { params: Id },
      responses: { 200: json(Brief), ...errors },
    }),
    async (c) =>
      respond(
        c,
        Brief,
        await getBriefById(c.get("ctx").db, {
          id: c.req.valid("param").id,
          memberId: c.get("member").id,
        }),
        200
      )
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/briefs",
      operationId: "brief.create",
      tags: ["Briefs"],
      summary: "Brief me now",
      description:
        "Builds the brief for the current window (replacing today's if it exists). Optionally delivers it to some of your delivery targets.",
      request: body(CreateBriefRequest),
      responses: { 201: json(Brief, "Created"), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const { period, deliverTo } = c.req.valid("json");
      const brief = await generateBrief(ctx, me, period);
      if (deliverTo !== undefined && deliverTo.length > 0) {
        await deliver(ctx, me.id, deliverTo, {
          type: `brief.${period}`,
          subject: brief.title,
          markdown: brief.body,
          url: ctx.config.PUBLIC_URL,
        });
      }
      return respond(c, Brief, brief, 201);
    }
  );
