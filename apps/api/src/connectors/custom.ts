import { z } from "zod";

import type { Connector, WorklogEvent } from "#connectors/types";

const Actor = z.object({
  id: z.string().min(1),
  handle: z.string().nullish(),
  name: z.string().nullish(),
  bot: z.boolean().optional(),
});

export const PushedEvent = z.object({
  id: z
    .string()
    .min(1)
    .max(300)
    .describe(
      "Unique per event in your system — retries with the same id are ignored"
    ),
  // Published in the OpenAPI spec, which can't carry regex flags (see HH_MM
  // in api/schemas/common.ts).
  // oxlint-disable-next-line require-unicode-regexp -- flags break the published pattern
  kind: z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/),
  occurredAt: z.iso.datetime(),
  actor: Actor.nullable(),
  title: z.string().min(1).max(300),
  body: z.string().max(4000).nullish(),
  url: z.url().nullish(),
  thread: z.string().max(300).nullish(),
  object: z
    .object({
      type: z.string(),
      key: z.string(),
      title: z.string().nullish(),
      url: z.url().nullish(),
    })
    .nullish(),
  cardNumbers: z.array(z.number().int()).optional(),
  importance: z.number().min(0).max(1).optional(),
  mentions: z.array(Actor).optional(),
  reviewers: z.array(Actor).optional(),
  agent: z
    .object({
      onBehalfOf: Actor.nullish(),
      state: z.enum(["working", "needs_you", "finished", "failed"]).optional(),
    })
    .nullish(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const PushedBatch = z.object({ events: z.array(z.unknown()).optional() });

export const customConnector: Connector = {
  id: "custom",
  name: "Custom (push API)",
  description:
    "Your own code pushes Worklog events (POST /v1/connections/{id}/events) and gets the same quality pipeline as built-in connectors.",
  secrets: [],
  settings: [
    {
      key: "identityNamespace",
      description:
        'Where your actor ids live, e.g. "jira:acme" or "github" to match GitHub ids (default: this connection)',
    },
    { key: "bots", description: '"quiet" (default), "drop" or "keep"' },
  ],
  endpoints: {},
  identityNamespace: (conn) =>
    typeof conn.settings.identityNamespace === "string"
      ? conn.settings.identityNamespace
      : `custom:${conn.id}`,
  receive: () => ({
    type: "reject",
    status: 404,
    error: "push events with POST /v1/connections/{id}/events",
  }),
  normalize({ payload }) {
    const raw = PushedBatch.parse(payload).events ?? [];
    const events: WorklogEvent[] = [];
    const invalid: string[] = [];
    for (const item of raw) {
      const parsed = PushedEvent.safeParse(item);
      if (!parsed.success) {
        invalid.push(z.prettifyError(parsed.error).slice(0, 200));
        continue;
      }
      const e = parsed.data;
      events.push({
        id: e.id,
        kind: e.kind,
        occurredAt: new Date(e.occurredAt),
        actor: e.actor,
        title: e.title,
        body: e.body,
        url: e.url,
        thread: e.thread,
        object: e.object,
        cardRefs: { numbers: e.cardNumbers },
        importance: e.importance,
        agent: e.agent,
        data: e.data,
        signals: [
          ...(e.mentions ?? []).map((who) => ({
            type: "mentioned" as const,
            who,
          })),
          ...(e.reviewers ?? []).map((who) => ({
            type: "review_requested" as const,
            who,
          })),
        ],
      });
    }
    return {
      events,
      ignored: invalid.length
        ? `${invalid.length} invalid event(s): ${invalid[0]}`
        : undefined,
    };
  },
};
