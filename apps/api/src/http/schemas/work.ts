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
    rhythm: z.array(z.number().int()).openapi({
      description:
        "Activities per day over the last 91 days (13 weeks) of their own calendar, oldest first and today last. Their private entries count only when they ask",
    }),
  })
  .openapi("WorkSnapshot");

const AgentRun = z
  .object({
    state: z.enum(["working", "needs_you", "finished", "failed"]),
    title: z.string(),
    at: IsoTimestamp,
    cardNumber: z.number().int().nullable().openapi({
      description: "The card the run is on, if it named one",
    }),
  })
  .openapi("AgentRun");

export const TeamNow = z
  .array(
    z.object({
      memberId: z.string(),
      current: z
        .object({
          number: z.number().int(),
          title: z.string(),
          column: z.string().nullable(),
          golden: z.boolean(),
        })
        .nullable()
        .openapi({
          description:
            "The card they're on: golden first, then the most recently active",
        }),
      latest: z
        .object({
          at: IsoTimestamp,
          kind: z.string(),
          source: z.string(),
          title: z.string(),
        })
        .nullable()
        .openapi({ description: "The latest thing they did in the window" }),
      agent: z.union([AgentRun, z.null()]).openapi({
        description:
          "For an agent: the run waiting on someone if any, else where its latest update left it",
      }),
      runs: z.array(AgentRun).openapi({
        description:
          "For an agent: every run still working or waiting on someone, one per thread, waiting first",
      }),
      lastActiveAt: IsoTimestamp.nullable(),
      rhythm: z.array(z.number().int()).openapi({
        description:
          "Activities per day over the last 14 days of the member's own calendar, oldest first and today last",
      }),
    })
  )
  .openapi("TeamNow");

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
