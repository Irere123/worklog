import { tool } from "ai";
import { z } from "zod";

import { listOpenAttention } from "#db/queries/attention";

import { safe } from "./scope";
import type { Scope } from "./scope";

export function myAttentionTool({ ctx, owner }: Scope) {
  return tool({
    description: `${owner.name}'s open attention items (review requests, mentions, assignments, blockers, notes from teammates).`,
    inputSchema: z.object({}),
    execute: safe(async () => {
      const items = await listOpenAttention(ctx.db, {
        memberId: owner.id,
        now: ctx.now(),
        limit: 50,
      });
      return items.map((a) => ({
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
    }),
  });
}
