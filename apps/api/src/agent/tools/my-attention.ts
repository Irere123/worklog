import { tool } from "ai";
import { z } from "zod";

import { listOpenAttention, listPendingFollowUps } from "#db/queries/attention";

import { safe } from "./scope";
import type { Scope } from "./scope";

export function myAttentionTool({ ctx, owner }: Scope) {
  return tool({
    description: `${owner.name}'s open attention items (review requests, mentions, assignments, blockers, notes from teammates), and the follow-ups they asked for that haven't come back yet. Dismissing one with resolve_attention cancels it.`,
    inputSchema: z.object({}),
    execute: safe(async () => {
      const [items, comingBack] = await Promise.all([
        listOpenAttention(ctx.db, {
          memberId: owner.id,
          now: ctx.now(),
          limit: 50,
        }),
        listPendingFollowUps(ctx.db, { memberId: owner.id, now: ctx.now() }),
      ]);
      const open = items.map((a) => ({
        id: a.id,
        kind: a.kind,
        title: a.title,
        detail: a.body,
        priority: a.priority,
        count: a.count,
        url: a.url,
        why: a.reason,
        actions: a.actions,
        since: a.createdAt.toISOString(),
      }));
      return {
        open,
        comingBack: comingBack.map((a) => ({
          id: a.id,
          what: a.body,
          at: a.snoozedUntil?.toISOString() ?? null,
        })),
      };
    }),
  });
}
