import { createRoute, z } from "@hono/zod-openapi";

import { recordActivity } from "#activity/service";
import { body, errors, Id, json, Ok, respond, router } from "#api/router";
import {
  Activity,
  CreateActivityRequest,
  ListActivitiesQuery,
} from "#api/schemas/activity";
import type { AppContext } from "#context";
import { deleteOwnActivity, listActivities } from "#db/queries/activities";
import { getCardByNumber } from "#db/queries/cards";
import type { Member } from "#db/queries/members";
import { applyAgentState } from "#ingest/effects";
import { notFound } from "#lib/errors";
import { resolveMember } from "#members/service";

export const activityRoutes = router()
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/activities",
      operationId: "activity.list",
      tags: ["Work"],
      summary:
        "The team's work stream — every source, humans and agents, newest first",
      request: { query: ListActivitiesQuery },
      responses: { 200: json(z.array(Activity)), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const q = c.req.valid("query");
      const actor = q.actor ? await resolveMember(ctx, me, q.actor) : null;
      const card =
        q.card === undefined || q.card === 0
          ? null
          : await getCardByNumber(ctx.db, {
              workspaceId: me.workspaceId,
              number: q.card,
            });
      const rows = await listActivities(ctx.db, {
        workspaceId: me.workspaceId,
        privateFor: [me.id],
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
      return respond(c, z.array(Activity), rows, 200);
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
      request: body(CreateActivityRequest),
      responses: {
        201: json(
          Activity.nullable(),
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
          : await getCardByNumber(ctx.db, {
              workspaceId: me.workspaceId,
              number: input.cardNumber,
            });
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
      return respond(c, Activity.nullable(), row, 201);
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/v1/activities/{id}",
      operationId: "activity.delete",
      tags: ["Work"],
      summary: "Delete one of your own entries (e.g. a mistaken work log)",
      request: { params: Id },
      responses: { 200: json(Ok), ...errors },
    }),
    async (c) => {
      const me = c.get("member");
      if (
        !(await deleteOwnActivity(c.get("ctx").db, {
          id: c.req.valid("param").id,
          workspaceId: me.workspaceId,
          actorId: me.id,
        }))
      ) {
        throw notFound("Activity");
      }
      return respond(c, Ok, { ok: true }, 200);
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
