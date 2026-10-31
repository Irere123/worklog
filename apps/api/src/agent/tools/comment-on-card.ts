import { tool } from "ai";
import { z } from "zod";

import { reviewed } from "#agent/review";

import { safe } from "./scope";
import type { Scope } from "./scope";

// Teammates read it, so it runs only once the review finds the owner asked for it.
export function commentOnCardTool(scope: Scope) {
  return tool({
    description: `Comment on a card as ${scope.owner.name}'s assistant.`,
    inputSchema: z.object({ number: z.number().int(), body: z.string() }),
    execute: safe(
      async (input) => await reviewed(scope, "comment_on_card", input),
      {
        notFound: "Use search_cards to find the card's number, then try again.",
      }
    ),
  });
}
