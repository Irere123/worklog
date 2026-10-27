import { createRoute, z } from "@hono/zod-openapi";

import { body, errors, Id, json, Ok, respond, router } from "#api/router";
import {
  Automation,
  AutomationResponse,
  AutomationRun,
  CreateAutomationRequest,
  RunResultResponse,
  UpdateAutomationRequest,
} from "#api/schemas/automations";
import { runAutomation } from "#automations/run";
import * as automations from "#automations/service";
import type { AppContext } from "#context";
import { getAutomationById, listAutomations } from "#db/queries/automations";
import { listDeliveryTargets } from "#db/queries/delivery-targets";
import { badRequest } from "#lib/errors";

export const automationRoutes = router()
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/automations",
      operationId: "automation.list",
      tags: ["Automations"],
      summary:
        "Your scheduled briefs, attention check, memory consolidation and custom automations",
      responses: { 200: json(z.array(Automation)), ...errors },
    }),
    async (c) => {
      const rows = await listAutomations(c.get("ctx").db, {
        memberId: c.get("member").id,
      });
      return respond(c, z.array(AutomationResponse), rows, 200);
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/automations",
      operationId: "automation.create",
      tags: ["Automations"],
      summary: "Create an automation",
      description:
        'Custom automations are instructions your assistant runs on a schedule, e.g. "Every Friday at 3pm, list my PRs still waiting on review and who has them." It stays quiet when there is nothing worth saying.',
      request: body(CreateAutomationRequest),
      responses: { 201: json(Automation, "Created"), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const input = c.req.valid("json");
      await assertOwnTargets(ctx, me.id, input.targetIds);
      return respond(
        c,
        AutomationResponse,
        await automations.createAutomation(ctx, me, input),
        201
      );
    }
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/v1/automations/{id}",
      operationId: "automation.update",
      tags: ["Automations"],
      summary:
        "Change schedule, delivery targets, instructions, or turn it off",
      request: { params: Id, ...body(UpdateAutomationRequest) },
      responses: { 200: json(Automation), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const patch = c.req.valid("json");
      await assertOwnTargets(ctx, me.id, patch.targetIds);
      return respond(
        c,
        AutomationResponse,
        await automations.updateAutomation(
          ctx,
          me,
          c.req.valid("param").id,
          patch
        ),
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/v1/automations/{id}",
      operationId: "automation.delete",
      tags: ["Automations"],
      request: { params: Id },
      responses: { 200: json(Ok), ...errors },
    }),
    async (c) => {
      await automations.deleteAutomation(
        c.get("ctx"),
        c.get("member").id,
        c.req.valid("param").id
      );
      return respond(c, Ok, { ok: true }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/automations/{id}/run",
      operationId: "automation.run",
      tags: ["Automations"],
      summary: "Run it now (ignores active hours; doesn't change the schedule)",
      request: { params: Id },
      responses: { 200: json(RunResultResponse), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const row = await getAutomationById(ctx.db, {
        id: c.req.valid("param").id,
        memberId: c.get("member").id,
      });
      return respond(
        c,
        RunResultResponse,
        await runAutomation(ctx, row, { manual: true }),
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/automations/{id}/runs",
      operationId: "automation.runs",
      tags: ["Automations"],
      request: { params: Id },
      responses: { 200: json(z.array(AutomationRun)), ...errors },
    }),
    async (c) => {
      const rows = await automations.listRuns(
        c.get("ctx"),
        c.get("member").id,
        c.req.valid("param").id
      );
      return respond(c, z.array(AutomationRun), rows, 200);
    }
  );

async function assertOwnTargets(
  ctx: AppContext,
  memberId: string,
  ids?: string[]
) {
  if (ids === undefined || ids.length === 0) {
    return;
  }
  const targets = await listDeliveryTargets(ctx.db, { memberId });
  const mine = new Set(targets.map((t) => t.id));
  const foreign = ids.filter((id) => !mine.has(id));
  if (foreign.length) {
    throw badRequest(`Unknown delivery target(s): ${foreign.join(", ")}`);
  }
}
