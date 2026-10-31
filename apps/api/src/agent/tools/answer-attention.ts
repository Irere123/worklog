import { tool } from "ai";
import { z } from "zod";

import { reviewed } from "#agent/review";

import { safe } from "./scope";
import type { Scope } from "./scope";

// Answers can move a card for everyone, so they run only once the review finds the owner asked.
export function answerAttentionTool(scope: Scope) {
  return tool({
    description:
      "Answer an attention item's one-click question for them (e.g. a drifting card: keep / not_now / done).",
    inputSchema: z.object({ id: z.string(), actionId: z.string() }),
    execute: safe(
      async (input) => await reviewed(scope, "answer_attention", input),
      {
        notFound:
          "Use my_attention to see the open items and their ids, then try again.",
      }
    ),
  });
}
