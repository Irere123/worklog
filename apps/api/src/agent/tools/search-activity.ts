import { tool } from "ai";
import { z } from "zod";

import { listActivities } from "#db/queries/activities";
import { DAY_MS } from "#lib/time";
import { resolveMember } from "#work/members";

import { privateFor, safe } from "./scope";
import type { Scope } from "./scope";

export function searchActivityTool(scope: Scope) {
  const { ctx, owner } = scope;
  return tool({
    description:
      "Search the activity stream (cards, GitHub, Slack, Discord, work logs, decisions, agents).",
    inputSchema: z.object({
      query: z
        .string()
        .optional()
        .describe("Text to match in titles and details"),
      person: z.string().optional().describe("Only activity by this handle"),
      source: z
        .enum(["worklog", "github", "slack", "discord", "api"])
        .optional(),
      kind: z
        .string()
        .optional()
        .describe("e.g. log.decision, log.blocker, pr.merged, card.closed"),
      days: z
        .number()
        .int()
        .min(1)
        .max(180)
        .optional()
        .describe("Look back this many days (default 14)"),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    execute: safe(
      async ({ query, person, source, kind, days, limit }) => {
        const who = person ? await resolveMember(ctx, owner, person) : null;
        const rows = await listActivities(ctx.db, {
          workspaceId: owner.workspaceId,
          privateFor: privateFor(scope),
          q: query,
          actorIds: who ? [who.id] : undefined,
          source,
          kinds: kind ? [kind] : undefined,
          since: new Date(ctx.now().getTime() - (days ?? 14) * DAY_MS),
          limit: limit ?? 30,
        });
        return rows.map((a) => ({
          at: a.occurredAt.toISOString(),
          actorId: a.actorId,
          kind: a.kind,
          source: a.source,
          title: a.title,
          detail: a.body?.slice(0, 400) ?? null,
          url: a.url,
        }));
      },
      {
        notFound:
          "Use team_directory to find the person's handle, then try again.",
      }
    ),
  });
}
