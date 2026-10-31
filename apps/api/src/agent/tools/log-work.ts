import { tool } from "ai";
import { z } from "zod";

import { reviewed } from "#agent/review";
import { LOG_KINDS, logWork } from "#work/log";

import { safe } from "./scope";
import type { Scope } from "./scope";

// Work logs are attributed to the owner: it is their work, told to their assistant. One the team
// will see runs only once the review finds the owner told it; a private one is theirs alone.
export function logWorkTool(scope: Scope) {
  const { ctx, owner } = scope;
  return tool({
    description: `Record work ${owner.name} did that no connector saw (calls, chats, decisions, fixes).`,
    inputSchema: z.object({
      text: z.string(),
      kind: z.enum(LOG_KINDS).optional(),
      cardNumber: z.number().int().optional(),
      private: z.boolean().optional(),
    }),
    execute: safe(
      async ({ private: isPrivate, ...input }) => {
        if (isPrivate !== true) {
          return await reviewed(scope, "log_work", input);
        }
        const { activity } = await logWork(ctx, owner, {
          ...input,
          via: "agent",
          visibility: "private",
        });
        return { ok: true, id: activity.id };
      },
      {
        notFound:
          "Log it without a card number, or use search_cards to find the card.",
      }
    ),
  });
}
