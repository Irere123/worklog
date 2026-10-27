import { z } from "@hono/zod-openapi";

import { PushedEvent } from "#connectors/custom";
import type { Connector as ConnectorDef } from "#ingest/types";

import { derived, Timestamp } from "./common";

export const Connection = z
  .object({
    id: z.string(),
    provider: z.string().openapi({ example: "github" }),
    name: z.string(),
    status: z.enum(["active", "paused"]),
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
  status: Connection.shape.status.optional(),
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
  })
  .openapi("Connector");

export const ConnectorResponse = derived(Connector, (k: ConnectorDef) => ({
  ...k,
  endpoints: Object.keys(k.endpoints),
}));

export const HealthQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).optional(),
});

export const ConnectionHealth = z
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

export const Delivery = z
  .object({
    id: z.string(),
    deliveryId: z.string(),
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
