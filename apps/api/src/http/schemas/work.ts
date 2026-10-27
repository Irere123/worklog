import { z } from "@hono/zod-openapi";

import { MEMBER_KINDS, VISIBILITY } from "#db/schema";
import { LOG_KINDS } from "#work/log";

import { IsoTimestamp } from "./common";

export const Snapshot = z
  .object({
    person: z.object({
      id: z.string(),
      name: z.string(),
      handle: z.string(),
      kind: z.enum(MEMBER_KINDS),
      title: z.string().nullable(),
    }),
    inProgress: z.array(
      z.object({
        number: z.number().int(),
        title: z.string(),
        column: z.string().nullable(),
        golden: z.boolean(),
        lastActiveAt: IsoTimestamp,
      })
    ),
    upNext: z.array(z.object({ number: z.number().int(), title: z.string() })),
    recent: z.array(
      z.object({
        at: IsoTimestamp,
        kind: z.string(),
        source: z.string(),
        title: z.string(),
        detail: z.string().nullable(),
        url: z.string().nullable(),
      })
    ),
    lastActiveAt: IsoTimestamp.nullable(),
  })
  .openapi("WorkSnapshot");

export const SnapshotQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).optional(),
});

export const LogRequest = z.object({
  text: z.string().min(1),
  via: z.enum(["text", "voice", "api"]).optional(),
  kind: z.enum(LOG_KINDS).optional(),
  cardNumber: z.number().int().optional(),
  visibility: z.enum(VISIBILITY).optional(),
  occurredAt: z.iso.datetime().optional(),
});
