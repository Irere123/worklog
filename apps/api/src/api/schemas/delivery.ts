import { z } from "@hono/zod-openapi";

import { TARGET_KINDS, VISIBILITY } from "#db/schema";

import { Timestamp } from "./common";

export const Target = z
  .object({
    id: z.string(),
    kind: z.enum(TARGET_KINDS),
    label: z.string(),
    address: z.string(),
    connectionId: z.string().nullable(),
    visibility: z.enum(VISIBILITY).openapi({
      description:
        "private: only you read it, so it gets everything. team: others might, so it only gets what your team can see.",
    }),
    enabled: z.boolean(),
    createdAt: Timestamp,
  })
  .openapi("DeliveryTarget");

export const CreateTargetRequest = z.object({
  kind: Target.shape.kind,
  address: z.string().min(1),
  label: z.string().optional(),
  connectionId: z.string().optional(),
  visibility: z.enum(VISIBILITY).optional(),
});

export const UpdateTargetRequest = z.object({
  label: z.string().min(1).optional(),
  visibility: z.enum(VISIBILITY).optional(),
});

export const TargetTestResponse = z.object({
  delivered: z.boolean(),
  error: z.string().nullable(),
});
