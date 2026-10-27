import { tool } from "ai";
import { z } from "zod";

import { resolveMember } from "#members/service";
import { workSnapshot } from "#work/snapshot";

import { includesPrivate, safe } from "./scope";
import type { Scope } from "./scope";

export function workSnapshotTool(scope: Scope) {
  const { ctx, owner } = scope;
  return tool({
    description: `What someone is working on right now: their in-progress cards, cards waiting in Maybe?, and recent activity. Use "${owner.handle}" for ${owner.name}.`,
    inputSchema: z.object({
      person: z.string().describe("Handle or member id"),
      days: z
        .number()
        .int()
        .min(1)
        .max(60)
        .optional()
        .describe("How far back to look for activity (default 7)"),
    }),
    execute: safe(async ({ person, days }) => {
      const m = await resolveMember(ctx, owner, person);
      return await workSnapshot(ctx, m, {
        includePrivate: includesPrivate(scope, m),
        days,
      });
    }),
  });
}
