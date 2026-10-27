import { tool } from "ai";
import { z } from "zod";

import { LOG_KINDS, logWork } from "#work/log";

import { safe } from "./scope";
import type { Scope } from "./scope";

// Work logs are attributed to the owner: it is their work, told to their assistant.
export function logWorkTool({ ctx, owner }: Scope) {
  return tool({
    description: `Record work ${owner.name} did that no connector saw (calls, chats, decisions, fixes).`,
    inputSchema: z.object({
      text: z.string(),
      kind: z.enum(LOG_KINDS).optional(),
      cardNumber: z.number().int().optional(),
      private: z.boolean().optional(),
    }),
    execute: safe(async ({ text, kind, cardNumber, private: isPrivate }) => {
      const { activity } = await logWork(ctx, owner, {
        text,
        kind,
        cardNumber,
        via: "agent",
        visibility: isPrivate === true ? "private" : "team",
      });
      return { ok: true, id: activity.id };
    }),
  });
}
