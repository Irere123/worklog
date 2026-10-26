import { createRoute, z } from "@hono/zod-openapi";

import {
  deleteOwnActivity,
  listActivities,
  recordActivity,
} from "#activity/service";
import { LOG_KINDS, logWork } from "#activity/worklog";
import { body, errors, json, Ok, router } from "#api/router";
import {
  ActivitySchema,
  AttentionMetricsSchema,
  AttentionSchema,
  BriefSchema,
  toActivity,
  toAttention,
  toBrief,
} from "#api/schemas";
import { performAttentionAction } from "#attention/actions";
import {
  attentionMetrics,
  giveFeedback,
  listAttention,
  updateAttention,
} from "#attention/service";
import { findCard } from "#board/service";
import { generateBrief, getBrief, listBriefs } from "#briefs/service";
import type { AppContext } from "#context";
import { ATTENTION_STATES, FEEDBACK_SIGNALS, VISIBILITY } from "#db/schema";
import { deliver } from "#delivery/service";
import { applyAgentState } from "#ingest/effects";
import { notFound } from "#lib/errors";
import { resolveMember } from "#members/service";
import type { Member } from "#members/service";

export const workRoutes = router()
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/activities",
      operationId: "activity.list",
      tags: ["Work"],
      summary:
        "The team's work stream — every source, humans and agents, newest first",
      request: {
        query: z.object({
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
        }),
      },
      responses: { 200: json(z.array(ActivitySchema)), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const q = c.req.valid("query");
      const actor = q.actor ? await resolveMember(ctx, me, q.actor) : null;
      const card =
        q.card === undefined || q.card === 0
          ? null
          : await findCard(ctx, me.workspaceId, q.card);
      const rows = await listActivities(ctx, me.workspaceId, [me.id], {
        actorIds: actor ? [actor.id] : undefined,
        source: q.source,
        kinds: q.kind ? [q.kind] : undefined,
        cardId: card?.id,
        since: q.since ? new Date(q.since) : undefined,
        until: q.until ? new Date(q.until) : undefined,
        q: q.q,
        before: q.before,
        limit: q.limit,
      });
      return c.json(rows.map(toActivity), 200);
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/activities",
      operationId: "activity.create",
      tags: ["Work"],
      summary: "Report work as yourself — for agents, CI and scripts",
      description: [
        "The API key's member is the actor. Send `externalId` to make retries idempotent.",
        "",
        "**Agents** (Cursor, Grok Bot, Claude Code, your own): say who the work is for (`onBehalfOf`, defaulting to the human the agent belongs to) and where it stands (`state`). People are only pinged when an agent `needs_you` (high priority) or `failed`; `finished` waits for their digest; `working` never notifies. Use the same `thread` for every update on one task.",
      ].join("\n"),
      request: body(
        z.object({
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
          state: z
            .enum(["working", "needs_you", "finished", "failed"])
            .optional(),
          data: z.record(z.string(), z.unknown()).optional(),
        })
      ),
      responses: {
        201: json(
          ActivitySchema.nullable(),
          "Created (null if externalId was already recorded)"
        ),
        ...errors,
      },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const input = c.req.valid("json");
      const card =
        input.cardNumber === undefined || input.cardNumber === 0
          ? null
          : await findCard(ctx, me.workspaceId, input.cardNumber);
      const onBehalfOf = await workingFor(ctx, me, input.onBehalfOf);
      const thread = input.thread ?? input.externalId ?? null;
      const row = await recordActivity(ctx, {
        workspaceId: me.workspaceId,
        actorId: me.id,
        source: "api",
        kind: input.kind,
        title: input.title,
        body: input.body,
        url: input.url,
        cardId: card?.id,
        visibility: input.visibility,
        externalId: input.externalId,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
        threadKey: thread,
        importance:
          input.importance ?? (input.state === "needs_you" ? 0.8 : undefined),
        onBehalfOfId: onBehalfOf?.id ?? null,
        agentState: input.state ?? null,
        data: input.data,
      });
      if (row && input.state) {
        await applyAgentState(ctx, {
          workspaceId: me.workspaceId,
          agentName: me.name,
          onBehalfOfId: onBehalfOf?.id ?? null,
          state: input.state,
          title: input.title,
          url: input.url ?? null,
          activityId: row.id,
          thread: thread ?? row.id,
          agentId: me.id,
        });
      }
      return c.json(row ? toActivity(row) : null, 201);
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/v1/activities/{id}",
      operationId: "activity.delete",
      tags: ["Work"],
      summary: "Delete one of your own entries (e.g. a mistaken work log)",
      request: { params: z.object({ id: z.string() }) },
      responses: { 200: json(Ok), ...errors },
    }),
    async (c) => {
      const me = c.get("member");
      if (
        !(await deleteOwnActivity(
          c.get("ctx"),
          me.workspaceId,
          me.id,
          c.req.valid("param").id
        ))
      ) {
        throw notFound("Activity");
      }
      return c.json({ ok: true as const }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/logs",
      operationId: "log.create",
      tags: ["Work"],
      summary: "Log work the connectors can't see — typed or dictated",
      description:
        'Calls, WhatsApp threads, decisions, fixes done off the radar. Clients can transcribe voice on-device and send `via: "voice"`. With AI configured, entries are titled, classified (decision / blocker / win) and linked to the right card in the background; blockers that name a teammate land in that teammate\'s attention list.',
      request: body(
        z.object({
          text: z.string().min(1),
          via: z.enum(["text", "voice", "api"]).optional(),
          kind: z.enum(LOG_KINDS).optional(),
          cardNumber: z.number().int().optional(),
          visibility: z.enum(VISIBILITY).optional(),
          occurredAt: z.iso.datetime().optional(),
        })
      ),
      responses: { 201: json(ActivitySchema, "Logged"), ...errors },
    }),
    async (c) => {
      const input = c.req.valid("json");
      const { activity } = await logWork(c.get("ctx"), c.get("member"), {
        ...input,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
      });
      return c.json(toActivity(activity), 201);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/attention",
      operationId: "attention.list",
      tags: ["Attention"],
      summary: "What needs you — highest priority first",
      request: {
        query: z.object({ state: z.enum(ATTENTION_STATES).optional() }),
      },
      responses: { 200: json(z.array(AttentionSchema)), ...errors },
    }),
    async (c) => {
      const rows = await listAttention(
        c.get("ctx"),
        c.get("member").id,
        c.req.valid("query").state
      );
      return c.json(rows.map(toAttention), 200);
    }
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/v1/attention/{id}",
      operationId: "attention.update",
      tags: ["Attention"],
      summary: "Mark done, dismiss, snooze or re-open",
      request: {
        params: z.object({ id: z.string() }),
        ...body(
          z.object({
            state: z.enum(ATTENTION_STATES),
            snoozedUntil: z.iso.datetime().optional(),
          })
        ),
      },
      responses: { 200: json(AttentionSchema), ...errors },
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
      return c.json(toAttention(row), 200);
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
      request: {
        params: z.object({ id: z.string() }),
        ...body(z.object({ signal: z.enum(FEEDBACK_SIGNALS) })),
      },
      responses: {
        200: json(z.object({ kind: z.string(), muted: z.boolean() })),
        ...errors,
      },
    }),
    async (c) =>
      c.json(
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
      request: { params: z.object({ id: z.string(), actionId: z.string() }) },
      responses: { 200: json(AttentionSchema), ...errors },
    }),
    async (c) => {
      const { id, actionId } = c.req.valid("param");
      return c.json(
        toAttention(
          await performAttentionAction(
            c.get("ctx"),
            c.get("member"),
            id,
            actionId
          )
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
      request: {
        query: z.object({
          days: z.coerce.number().int().min(1).max(90).optional(),
        }),
      },
      responses: { 200: json(AttentionMetricsSchema), ...errors },
    }),
    async (c) =>
      c.json(
        await attentionMetrics(
          c.get("ctx"),
          c.get("member").id,
          c.req.valid("query").days
        ),
        200
      )
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/briefs",
      operationId: "brief.list",
      tags: ["Briefs"],
      request: {
        query: z.object({ period: z.enum(["daily", "weekly"]).optional() }),
      },
      responses: { 200: json(z.array(BriefSchema)), ...errors },
    }),
    async (c) => {
      const rows = await listBriefs(
        c.get("ctx"),
        c.get("member").id,
        c.req.valid("query").period
      );
      return c.json(rows.map(toBrief), 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/briefs/{id}",
      operationId: "brief.get",
      tags: ["Briefs"],
      request: { params: z.object({ id: z.string() }) },
      responses: { 200: json(BriefSchema), ...errors },
    }),
    async (c) => {
      const row = await getBrief(
        c.get("ctx"),
        c.get("member").id,
        c.req.valid("param").id
      );
      if (!row) {
        throw notFound("Brief");
      }
      return c.json(toBrief(row), 200);
    }
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
      request: body(
        z.object({
          period: z.enum(["daily", "weekly"]).default("daily"),
          deliverTo: z
            .array(z.string())
            .optional()
            .openapi({ description: "Delivery target ids" }),
        })
      ),
      responses: { 201: json(BriefSchema, "Created"), ...errors },
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
      return c.json(toBrief(brief), 201);
    }
  );

async function workingFor(
  ctx: AppContext,
  me: Member,
  ref: string | undefined
) {
  const forRef = ref ?? (me.kind === "agent" ? me.ownerId : null);
  return forRef ? await resolveMember(ctx, me, forRef) : null;
}
