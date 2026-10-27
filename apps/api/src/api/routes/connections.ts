import { createRoute, z } from "@hono/zod-openapi";

import { body, errors, json, Ok, requireAdmin, router } from "#api/router";
import {
  ConnectionSchema,
  IdentitySchema,
  toConnection,
  toIdentity,
} from "#api/schemas";
import * as conns from "#connectors/connections";
import { PushedEvent } from "#connectors/custom";
import { registerDiscordCommands } from "#connectors/discord";
import { listConnectors } from "#connectors/registry";
import { getConnectionById, listConnections } from "#db/queries/connections";
import { listIdentities } from "#db/queries/identities";
import { listInboundEvents } from "#db/queries/inbound-events";
import { linkIdentityToMember } from "#ingest/identity";
import { connectionHealth, receivePushed, viewOf } from "#ingest/pipeline";
import { enqueue } from "#jobs/queue";
import { badRequest, forbidden } from "#lib/errors";
import { resolveMember } from "#members/service";

const Id = z.object({ id: z.string() });

const ConnectorSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    secrets: z.array(
      z.object({
        key: z.string(),
        required: z.boolean(),
        description: z.string(),
      })
    ),
    settings: z.array(z.object({ key: z.string(), description: z.string() })),
    endpoints: z.array(z.string()),
  })
  .openapi("Connector");

const HealthSchema = z
  .object({
    days: z.number().int(),
    lastEventAt: z.string().nullable(),
    deliveries: z.record(z.string(), z.number()),
    activities: z.object({ kept: z.number(), merged: z.number() }),
    signalRate: z.number().nullable(),
    topSkipReasons: z.array(
      z.object({ reason: z.string(), count: z.number() })
    ),
    unlinkedIdentities: z.number(),
    recentFailures: z.array(
      z.object({
        at: z.string(),
        eventType: z.string(),
        error: z.string().nullable(),
      })
    ),
  })
  .openapi("ConnectionHealth");

const DeliverySchema = z
  .object({
    id: z.string(),
    deliveryId: z.string(),
    eventType: z.string(),
    status: z.enum(["pending", "processed", "ignored", "failed"]),
    outcome: z.record(z.string(), z.unknown()).nullable(),
    error: z.string().nullable(),
    attempts: z.number().int(),
    receivedAt: z.string(),
    payload: z.unknown().optional(),
  })
  .openapi("Delivery");

export const connectionRoutes = router()
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/connectors",
      operationId: "connector.list",
      tags: ["Connections"],
      summary:
        "Connectors this server supports, with the secrets and settings each needs",
      responses: { 200: json(z.array(ConnectorSchema)), ...errors },
    }),
    (c) =>
      c.json(
        listConnectors().map((k) => ({
          id: k.id,
          name: k.name,
          description: k.description,
          secrets: k.secrets,
          settings: k.settings,
          endpoints: Object.keys(k.endpoints),
        })),
        200
      )
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/connections",
      operationId: "connection.list",
      tags: ["Connections"],
      responses: { 200: json(z.array(ConnectionSchema)), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const rows = await listConnections(ctx.db, {
        workspaceId: c.get("member").workspaceId,
      });
      return c.json(
        rows.map((r) => toConnection(r, conns.webhookUrls(ctx, r))),
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
      request: body(
        z.object({
          provider: z.string().openapi({ example: "github" }),
          name: z.string().optional(),
          secrets: z.record(z.string(), z.string()).optional(),
          settings: z.record(z.string(), z.unknown()).optional(),
        })
      ),
      responses: { 201: json(ConnectionSchema, "Connected"), ...errors },
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
      return c.json(toConnection(row, conns.webhookUrls(ctx, row)), 201);
    }
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/v1/connections/{id}",
      operationId: "connection.update",
      tags: ["Connections"],
      request: {
        params: Id,
        ...body(
          z.object({
            name: z.string().optional(),
            status: z.enum(["active", "paused"]).optional(),
            settings: z.record(z.string(), z.unknown()).optional(),
            secrets: z
              .record(z.string(), z.string())
              .optional()
              .openapi({ description: "Merged into existing secrets" }),
          })
        ),
      },
      responses: { 200: json(ConnectionSchema), ...errors },
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
      return c.json(toConnection(row, conns.webhookUrls(ctx, row)), 200);
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
      return c.json({ ok: true as const }, 200);
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
      request: {
        params: Id,
        query: z.object({
          days: z.coerce.number().int().min(1).max(90).optional(),
        }),
      },
      responses: { 200: json(HealthSchema), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const conn = await getConnectionById(ctx.db, {
        id: c.req.valid("param").id,
        workspaceId: c.get("member").workspaceId,
      });
      return c.json(
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
      request: {
        params: Id,
        query: z.object({
          status: z
            .enum(["pending", "processed", "ignored", "failed"])
            .optional(),
          includePayload: z.enum(["true", "false"]).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      },
      responses: { 200: json(z.array(DeliverySchema)), ...errors },
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
      return c.json(
        rows.map((r) => ({
          id: r.id,
          deliveryId: r.deliveryId,
          eventType: r.eventType,
          status: r.status,
          outcome: r.outcome ?? null,
          error: r.error,
          attempts: r.attempts,
          receivedAt: r.receivedAt.toISOString(),
          ...(q.includePayload === "true" ? { payload: r.payload } : {}),
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
      request: {
        params: Id,
        ...body(z.object({ since: z.iso.datetime().optional() })),
      },
      responses: {
        202: json(z.object({ queued: z.literal(true) }), "Queued"),
        ...errors,
      },
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
      return c.json({ queued: true as const }, 202);
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
        headers: z.object({
          "idempotency-key": z.string().max(200).optional(),
        }),
        ...body(z.object({ events: z.array(PushedEvent).min(1).max(500) })),
      },
      responses: {
        202: json(
          z.object({ accepted: z.number().int(), duplicate: z.boolean() }),
          "Accepted"
        ),
        ...errors,
      },
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
      return c.json(
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
      responses: {
        200: json(z.object({ registered: z.array(z.string()) })),
        ...errors,
      },
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
      return c.json(
        { registered: await registerDiscordCommands(ctx, viewOf(ctx, conn)) },
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/identities",
      operationId: "identity.listAll",
      tags: ["Connections"],
      summary:
        "Accounts seen in connected tools — filter to the ones not matched to anyone yet",
      request: {
        query: z.object({ unlinked: z.enum(["true", "false"]).optional() }),
      },
      responses: { 200: json(z.array(IdentitySchema)), ...errors },
    }),
    async (c) => {
      const rows = await listIdentities(c.get("ctx").db, {
        workspaceId: c.get("member").workspaceId,
        unlinked: c.req.valid("query").unlinked === "true",
      });
      return c.json(rows.map(toIdentity), 200);
    }
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/v1/identities/{id}",
      operationId: "identity.assign",
      tags: ["Connections"],
      summary:
        "Match an account to a member (admins) — their past activity is re-attributed",
      request: {
        params: Id,
        ...body(
          z.object({
            member: z
              .string()
              .nullable()
              .openapi({ description: "Member id or handle; null to unlink" }),
          })
        ),
      },
      responses: {
        200: json(
          z.object({ identity: IdentitySchema, reattributed: z.number().int() })
        ),
        ...errors,
      },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      requireAdmin(me);
      const ref = c.req.valid("json").member;
      const member = ref ? await resolveMember(ctx, me, ref) : null;
      const { identity, reattributed } = await linkIdentityToMember(
        ctx,
        me.workspaceId,
        c.req.valid("param").id,
        member?.id ?? null
      );
      return c.json({ identity: toIdentity(identity), reattributed }, 200);
    }
  );
