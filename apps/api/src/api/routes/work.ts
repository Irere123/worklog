import { createRoute } from "@hono/zod-openapi";

import { body, errors, json, respond, router } from "#api/router";
import { Activity } from "#api/schemas/activity";
import { MemberRef } from "#api/schemas/members";
import { LogRequest, Snapshot, SnapshotQuery } from "#api/schemas/work";
import { resolveMember } from "#members/service";
import { logWork } from "#work/log";
import { workSnapshot } from "#work/snapshot";

export const workRoutes = router()
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/logs",
      operationId: "log.create",
      tags: ["Work"],
      summary: "Log work the connectors can't see — typed or dictated",
      description:
        'Calls, WhatsApp threads, decisions, fixes done off the radar. Clients can transcribe voice on-device and send `via: "voice"`. With AI configured, entries are titled, classified (decision / blocker / win) and linked to the right card in the background; blockers that name a teammate land in that teammate\'s attention list.',
      request: body(LogRequest),
      responses: { 201: json(Activity, "Logged"), ...errors },
    }),
    async (c) => {
      const input = c.req.valid("json");
      const { activity } = await logWork(c.get("ctx"), c.get("member"), {
        ...input,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
      });
      return respond(c, Activity, activity, 201);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/members/{ref}/now",
      operationId: "member.now",
      tags: ["People"],
      summary: "What this person or agent is working on right now",
      request: { params: MemberRef, query: SnapshotQuery },
      responses: { 200: json(Snapshot), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const person = await resolveMember(ctx, me, c.req.valid("param").ref);
      const snapshot = await workSnapshot(ctx, person, {
        includePrivate: person.id === me.id,
        days: c.req.valid("query").days,
      });
      return respond(c, Snapshot, snapshot, 200);
    }
  );
