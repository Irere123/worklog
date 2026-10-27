import { tool } from "ai";
import { z } from "zod";

import { addComment } from "#board/service";

import { safe } from "./scope";
import type { Scope } from "./scope";

export function commentOnCardTool({ ctx, agent, owner }: Scope) {
  return tool({
    description: `Comment on a card as ${owner.name}'s assistant.`,
    inputSchema: z.object({ number: z.number().int(), body: z.string() }),
    execute: safe(async ({ number, body }) => {
      const c = await addComment(ctx, agent, number, body);
      return { ok: true, id: c.id };
    }),
  });
}
