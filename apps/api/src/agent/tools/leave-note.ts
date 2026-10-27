import { tool } from "ai";
import { z } from "zod";

import { getCardByNumber } from "#db/queries/cards";
import { raiseAttention } from "#work/attention";

import { safe } from "./scope";
import type { Scope } from "./scope";

// The one write a teammate's conversation can make: it goes to the owner's own list, nowhere public.
export function leaveNoteTool({ ctx, owner, asker, conversationId }: Scope) {
  return tool({
    description: `Leave a note in ${owner.name}'s attention list on behalf of ${asker.name} — use when you can't answer, or ${asker.name} needs ${owner.name} to act.`,
    inputSchema: z.object({
      note: z
        .string()
        .describe(
          `What ${asker.name} needs from ${owner.name}, and why — self-contained`
        ),
      urgent: z.boolean().describe("True only if it blocks work today"),
      cardNumber: z.number().int().optional(),
    }),
    execute: safe(async ({ note, urgent, cardNumber }) => {
      const card =
        cardNumber === undefined
          ? null
          : await getCardByNumber(ctx.db, {
              workspaceId: owner.workspaceId,
              number: cardNumber,
            });
      await raiseAttention(ctx, {
        workspaceId: owner.workspaceId,
        memberId: owner.id,
        kind: "assistant.note",
        title: `${asker.name} asked your assistant: ${note.slice(0, 120)}`,
        body: note,
        cardId: card?.id ?? null,
        fromId: asker.id,
        priority: urgent ? "high" : "normal",
        dedupeKey: `note:${conversationId}`,
      });
      return { ok: true, message: `Left a note for ${owner.name}.` };
    }),
  });
}
