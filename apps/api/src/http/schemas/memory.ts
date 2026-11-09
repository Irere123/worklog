import { z } from "@hono/zod-openapi";

import { MEMORY_KINDS, VISIBILITY } from "#db/schema";

import { IsoTimestamp, Timestamp } from "./common";

export const MemoryEvidence = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("activity"),
      id: z
        .string()
        .openapi({ description: "The activity it was learned from" }),
    }),
    z.object({
      kind: z.literal("said"),
      at: IsoTimestamp,
      text: z.string().openapi({ description: "What you said, quoted" }),
    }),
  ])
  .openapi("MemoryEvidence");

export const Memory = z
  .object({
    id: z.string(),
    kind: z.enum(MEMORY_KINDS),
    content: z.string(),
    aliases: z.array(z.string()),
    visibility: z.enum(VISIBILITY),
    status: z.enum(["active", "superseded"]),
    supersededBy: z.string().nullable().openapi({
      description:
        "The memory that replaced this one; null while active, or if it was forgotten",
    }),
    day: z.string().nullable(),
    source: z.enum(["self", "agent", "teammate"]),
    confirmed: z.boolean().openapi({
      description:
        "False when the assistant inferred it rather than was told or shown it; it then stays out of what conversations start with",
    }),
    evidence: z.array(MemoryEvidence).openapi({
      description:
        "What it was learned from, so it can be checked against the record",
    }),
    expiresAt: Timestamp.nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi("Memory");

export const ListMemoriesQuery = z.object({
  kind: z.enum(MEMORY_KINDS).optional(),
  q: z.string().optional(),
});

export const CreateMemoryRequest = z.object({
  content: z.string().min(1).openapi({
    example: "I own the payments service; ask me before changing retry logic",
  }),
  kind: z.enum(["profile", "fact"]).default("profile"),
  visibility: z.enum(VISIBILITY).default("team"),
  aliases: z
    .array(z.string())
    .optional()
    .openapi({ example: ["billing", "@emma"] }),
  expiresAt: z.iso
    .datetime()
    .optional()
    .openapi({ description: "Stop recalling it after this" }),
});

export const MemoryExport = z
  .object({
    files: z.array(
      z.object({
        path: z.string().openapi({ example: "team/profile.md" }),
        content: z.string().openapi({ description: "Markdown" }),
      })
    ),
  })
  .openapi("MemoryExport");
