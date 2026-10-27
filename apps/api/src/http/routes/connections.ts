import { createRoute, z } from "@hono/zod-openapi";

import type { AppContext } from "#context";
import { getConnectionById, listConnections } from "#db/queries/connections";
import type { ConnectionRow } from "#db/queries/connections";
import { listInboundEvents } from "#db/queries/inbound-events";
import {
  body,
  errors,
  Id,
  json,
  Ok,
  requireAdmin,
  respond,
  router,
} from "#http/router";
import {
  Connection,
  ConnectionHealth,
  Connector,
  ConnectorResponse,
  CreateConnectionRequest,
  DeliveriesQuery,
  Delivery,
  DiscordCommandsResponse,
  HealthQuery,
  PushEventsHeaders,
  PushEventsRequest,
  PushEventsResponse,
  ReplayQueuedResponse,
  ReplayRequest,
  UpdateConnectionRequest,
} from "#http/schemas/connections";
import * as conns from "#ingest/connections";
import { listConnectors } from "#ingest/connectors";
import { registerDiscordCommands } from "#ingest/connectors/discord";
import { connectionHealth, receivePushed, viewOf } from "#ingest/pipeline";
import { enqueue } from "#jobs/queue";
import { badRequest, forbidden } from "#lib/errors";

const withUrls = (ctx: AppContext, row: ConnectionRow) => ({
  ...row,
  webhookUrls: conns.webhookUrls(ctx, row),
});

export const connectionRoutes = router()
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/connectors",
      operationId: "connector.list",
      tags: ["Connections"],
      summary:
        "Connectors this server supports, with the secrets and settings each needs",
      responses: { 200: json(z.array(Connector)), ...errors },
    }),
    (c) => respond(c, z.array(ConnectorResponse), listConnectors(), 200)
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/connections",
      operationId: "connection.list",
      tags: ["Connections"],
      responses: { 200: json(z.array(Connection)), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const rows = await listConnections(ctx.db, {
        workspaceId: c.get("member").workspaceId,
      });
      return respond(
        c,
        z.array(Connection),
        rows.map((r) => withUrls(ctx, r)),
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/connections",
      operationId: "connection.create",
      tags: ["Connections"],
      summary: "Connect a tool (admins)",
      description: [
        "Pick a connector from `GET /v1/connectors`. Secrets are encrypted at rest and never returned; the response includes the webhook URL(s) to paste into the tool.",
        "- **github**: secrets `webhookSecret`; settings `boardId` (issues become cards), `repos`, `bots`, `ignoreKinds`.",
        "- **gitea** (self-hosted Gitea/Forgejo): same as GitHub plus `baseUrl`.",
        "- **slack**: secrets `signingSecret`, `botToken`; settings `channels` (work-update channels), `channelNames`, `teamUrl`.",
        "- **discord**: secrets `publicKey`, `applicationId`, `botToken`; then `POST /v1/connections/{id}/discord/commands`.",
        "- **webhook**: any tool — map its webhooks with rules in `settings` (no code).",
        "- **custom**: your code pushes events to `POST /v1/connections/{id}/events`.",
      ].join("\n"),
      request: body(CreateConnectionRequest),
      responses: { 201: json(Connection, "Connected"), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      requireAdmin(me);
      const row = await conns.createConnection(
        ctx,
        me.workspaceId,
        c.req.valid("json")
      );
      return respond(c, Connection, withUrls(ctx, row), 201);
    }
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/v1/connections/{id}",
      operationId: "connection.update",
      tags: ["Connections"],
      request: { params: Id, ...body(UpdateConnectionRequest) },
      responses: { 200: json(Connection), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      requireAdmin(me);
      const row = await conns.updateConnection(
        ctx,
        me.workspaceId,
        c.req.valid("param").id,
        c.req.valid("json")
      );
      return respond(c, Connection, withUrls(ctx, row), 200);
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/v1/connections/{id}",
      operationId: "connection.delete",
      tags: ["Connections"],
      request: { params: Id },
      responses: { 200: json(Ok), ...errors },
    }),
    async (c) => {
      const me = c.get("member");
      requireAdmin(me);
      await conns.deleteConnection(
        c.get("ctx"),
        me.workspaceId,
        c.req.valid("param").id
      );
      return respond(c, Ok, { ok: true }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/connections/{id}/health",
      operationId: "connection.health",
      tags: ["Connections"],
      summary:
        "Is this connection producing signal? Deliveries, what became activity, and why things were skipped",
      request: { params: Id, query: HealthQuery },
      responses: { 200: json(ConnectionHealth), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const conn = await getConnectionById(ctx.db, {
        id: c.req.valid("param").id,
        workspaceId: c.get("member").workspaceId,
      });
      return respond(
        c,
        ConnectionHealth,
        await connectionHealth(ctx, conn, c.req.valid("query").days),
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/connections/{id}/deliveries",
      operationId: "connection.deliveries",
      tags: ["Connections"],
      summary:
        "The raw inbox: every delivery, what happened to it, and why (admins)",
      request: { params: Id, query: DeliveriesQuery },
      responses: { 200: json(z.array(Delivery)), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      requireAdmin(me);
      const conn = await getConnectionById(ctx.db, {
        id: c.req.valid("param").id,
        workspaceId: me.workspaceId,
      });
      const q = c.req.valid("query");
      const rows = await listInboundEvents(ctx.db, {
        connectionId: conn.id,
        status: q.status,
        limit: q.limit ?? 50,
      });
      return respond(
        c,
        z.array(Delivery),
        rows.map((r) => ({
          ...r,
          outcome: r.outcome ?? null,
          payload: q.includePayload === "true" ? r.payload : undefined,
        })),
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/connections/{id}/replay",
      operationId: "connection.replay",
      tags: ["Connections"],
      summary:
        "Rebuild this connection's activity from stored deliveries (after changing settings or fixing a connector)",
      description:
        "Runs in the background. Attention items and board changes are not re-applied. Deliveries are kept for `INBOUND_RETENTION_DAYS` (90 by default), so a replay starts no earlier than that, and older activity is left as it is.",
      request: { params: Id, ...body(ReplayRequest) },
      responses: { 202: json(ReplayQueuedResponse, "Queued"), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      requireAdmin(me);
      const conn = await getConnectionById(ctx.db, {
        id: c.req.valid("param").id,
        workspaceId: me.workspaceId,
      });
      await enqueue(
        ctx,
        "ingest:replay",
        {
          workspaceId: me.workspaceId,
          connectionId: conn.id,
          since: c.req.valid("json").since ?? null,
        },
        { queue: `ingest:${conn.id}`, maxAttempts: 1 }
      );
      return respond(c, ReplayQueuedResponse, { queued: true }, 202);
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/connections/{id}/events",
      operationId: "connection.pushEvents",
      tags: ["Connections"],
      summary: "Push events from your own code into a custom connection",
      description:
        "For integrations written as code. Use an API key with the `ingest` scope. Events go through the same pipeline as webhooks: identity matching, noise rules, merging, signals. Send an `Idempotency-Key` header to make retries safe.",
      request: {
        params: Id,
        headers: PushEventsHeaders,
        ...body(PushEventsRequest),
      },
      responses: { 202: json(PushEventsResponse, "Accepted"), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const conn = await getConnectionById(ctx.db, {
        id: c.req.valid("param").id,
        workspaceId: me.workspaceId,
      });
      if (conn.provider !== "custom") {
        throw badRequest("Push events only to a custom connection");
      }
      if (conn.status !== "active") {
        throw forbidden("This connection is paused");
      }
      const { events } = c.req.valid("json");
      const key =
        c.req.valid("header")["idempotency-key"] ??
        `${me.id}:${crypto.randomUUID()}`;
      const result = await receivePushed(ctx, conn, key, events);
      return respond(
        c,
        PushEventsResponse,
        { accepted: events.length, duplicate: result.duplicate },
        202
      );
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/connections/{id}/discord/commands",
      operationId: "connection.registerDiscordCommands",
      tags: ["Connections"],
      summary:
        "Register Worklog's slash commands (/log, /now, /ask, /brief) with Discord",
      request: { params: Id },
      responses: { 200: json(DiscordCommandsResponse), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      requireAdmin(me);
      const conn = await getConnectionById(ctx.db, {
        id: c.req.valid("param").id,
        workspaceId: me.workspaceId,
      });
      if (conn.provider !== "discord") {
        throw badRequest("Not a Discord connection");
      }
      return respond(
        c,
        DiscordCommandsResponse,
        { registered: await registerDiscordCommands(ctx, viewOf(ctx, conn)) },
        200
      );
    }
  );
