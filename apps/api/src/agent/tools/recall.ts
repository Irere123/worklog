import { tool } from "ai";
import { z } from "zod";

import { listMemories } from "#db/queries/memories";

import { safe } from "./scope";
import type { Scope } from "./scope";

export function recallTool({ ctx, owner, mode }: Scope) {
  return tool({
    description: `What you have learned about ${owner.name}: profile (how they work, what they own), facts, and daily journal entries. Your instructions hold a digest; use this for details, ids to supersede, and anything newer. An unconfirmed line is your inference, not something they said: lean on it lightly, and check it with ${owner.name} when it matters.`,
    inputSchema: z.object({
      query: z
        .string()
        .optional()
        .describe(
          "Words to look for; each word is matched on its own and misspellings are fine. Omit for the most recent."
        ),
    }),
    execute: safe(async ({ query }) => {
      const memories = await listMemories(ctx.db, {
        memberId: owner.id,
        includePrivate: mode === "owner",
        kinds: ["profile", "fact", "journal"],
        now: ctx.now(),
        q: query,
        limit: 60,
      });
      return memories.map((m) => ({
        id: m.id,
        kind: m.kind,
        day: m.day,
        content: m.content,
        aliases: m.aliases,
        expiresAt: m.expiresAt?.toISOString() ?? null,
        visibility: m.visibility,
        confirmed: m.confirmed,
      }));
    }),
  });
}
