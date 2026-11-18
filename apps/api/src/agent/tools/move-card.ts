import { tool } from "ai";
import { z } from "zod";

import { reviewed } from "#agent/review";

import { safe } from "./scope";
import type { Scope } from "./scope";

export function moveCardTool(scope: Scope) {
  return tool({
    description:
      'Move a card: to a column by name, or to "maybe", "not_now", or "done".',
    inputSchema: z.object({ number: z.number().int(), to: z.string() }),
    execute: safe(async (input) => await reviewed(scope, "move_card", input), {
      notFound: "Use search_cards to find the card's number, then try again.",
    }),
  });
}
