import { tool } from "ai";
import { z } from "zod";

import { giveFeedback } from "#work/attention";

import { safe } from "./scope";
import type { Scope } from "./scope";

export function attentionFeedbackTool({ ctx, owner }: Scope) {
  return tool({
    description: `Record ${owner.name}'s feedback on a ping, e.g. "stop pinging me about these" → less_like_this. Muted kinds go to digests instead.`,
    inputSchema: z.object({
      id: z.string(),
      signal: z.enum(["useful", "not_useful", "less_like_this"]),
    }),
    execute: safe(
      async ({ id, signal }) => await giveFeedback(ctx, owner.id, id, signal)
    ),
  });
}
