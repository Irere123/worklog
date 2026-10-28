import { z } from "@hono/zod-openapi";

import { PushedEvent } from "#connectors/custom";
import type { Connector as ConnectorDef } from "#connectors/types";
import { CONNECTION_STATUSES } from "#db/schema";

import { derived, Timestamp } from "./common";

export const Connection = z
  .object({
    id: z.string(),
    provider: z.string().openapi({ example: "github" }),
    name: z.string(),
    status: z.enum(CONNECTION_STATUSES).openapi({
      description:
        "Only active connections record anything. pending: installed, not yet set up; suspended: paused at the provider; revoked: uninstalled, or its token stopped working",
    }),
    statusReason: z.string().nullable(),
    externalId: z.string().nullable().openapi({
      description:
        "The provider account it's installed on (GitHub installation, Slack team), for app-installed connections",
    }),
    settings: z.record(z.string(), z.unknown()),
    lastEventAt: Timestamp.nullable(),
    createdAt: Timestamp,
    webhookUrls: z
      .record(z.string(), z.string())
      .openapi({ description: "Paste these into the provider's app settings" }),
  })
  .openapi("Connection");

export const CreateConnectionRequest = z.object({
  provider: z.string().openapi({ example: "github" }),
  name: z.string().optional(),
  secrets: z.record(z.string(), z.string()).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export const UpdateConnectionRequest = z.object({
  name: z.string().optional(),
  status: z.enum(["active", "paused"]).optional().openapi({
    description: "Pause or resume. Other states come from the provider",
  }),
  settings: z.record(z.string(), z.unknown()).optional(),
  secrets: z
    .record(z.string(), z.string())
    .optional()
    .openapi({ description: "Merged into existing secrets" }),
});

export const Connector = z
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
    capabilities: z.object({
      app: z.boolean().openapi({
        description:
          "Installs through the server's app: POST /v1/apps/{provider}/install",
      }),
      sync: z.boolean().openapi({
        description:
          "Reads recent history and catches up daily through the provider's API",
      }),
      sources: z.boolean().openapi({
        description:
          "Lists what it can watch: GET /v1/connections/{id}/sources",
      }),
      hooks: z.boolean().openapi({
        description:
          "Creates and repairs its own webhooks on the provider, given a token",
      }),
    }),
  })
  .openapi("Connector");

export const ConnectorResponse = derived(Connector, (k: ConnectorDef) => ({
  ...k,
  endpoints: Object.keys(k.endpoints),
  capabilities: {
    app: Boolean(k.app),
    sync: Boolean(k.sync),
    sources: Boolean(k.sources),
    hooks: Boolean(k.hooks),
  },
}));

export const HealthQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).optional(),
});

export const ConnectionHealth = z
  .object({
    days: z.number().int(),
    status: z.enum(CONNECTION_STATUSES),
    statusReason: z.string().nullable(),
    /** Whose accounts its events name: what identities resolve in. */
    identityNamespace: z.string().nullable(),
    lastEventAt: z.string().nullable(),
    deliveries: z.record(z.string(), z.number()),
    activities: z.object({
      kept: z.number(),
      merged: z.number(),
      duplicates: z.number(),
    }),
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
    rejections: z.object({
      total: z.number().int(),
      lastAt: z.string().nullable(),
      last: z.string().nullable(),
      failingNow: z.boolean().openapi({
        description:
          "Rejected since the last accepted delivery: check the secret or signature settings",
      }),
    }),
    backlog: z.object({
      pending: z.number().int(),
      oldestAt: z.string().nullable(),
    }),
    lagMs: z.object({
      p50: z.number().nullable(),
      p95: z.number().nullable(),
    }),
    sync: z.array(
      z.object({
        stream: z.string(),
        state: z.enum(["idle", "running", "failed"]),
        syncedAt: z.string().nullable(),
        error: z.string().nullable(),
      })
    ),
  })
  .openapi("ConnectionHealth");

export const Delivery = z
  .object({
    id: z.string(),
    deliveryId: z.string(),
    via: z.enum(["webhook", "app", "push", "sync"]),
    partitionKey: z.string(),
    eventType: z.string(),
    status: z.enum(["pending", "processed", "ignored", "failed"]),
    outcome: z.record(z.string(), z.unknown()).nullable(),
    error: z.string().nullable(),
    attempts: z.number().int(),
    receivedAt: Timestamp,
    payload: z.unknown().optional(),
  })
  .openapi("Delivery");

export const DeliveriesQuery = z.object({
  status: Delivery.shape.status.optional(),
  includePayload: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const ReplayRequest = z.object({ since: z.iso.datetime().optional() });

export const ReplayQueuedResponse = z.object({ queued: z.literal(true) });

export const PushEventsHeaders = z.object({
  "idempotency-key": z.string().max(200).optional(),
});

export const PushEventsRequest = z.object({
  events: z.array(PushedEvent).min(1).max(500),
});

export const PushEventsResponse = z.object({
  accepted: z.number().int(),
  duplicate: z.boolean(),
});

export const DiscordCommandsResponse = z.object({
  registered: z.array(z.string()),
});
