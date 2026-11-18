import { tool } from "ai";
import { z } from "zod";

import { listAutomations } from "#db/queries/automations";
import { getCardByNumber } from "#db/queries/cards";
import { getWorkspaceById } from "#db/queries/workspaces";
import { badRequest } from "#lib/errors";
import { startOfLocalMinute, timezoneOf } from "#lib/time";
import { scheduleFollowUp } from "#work/attention";

import { safe } from "./scope";
import type { Scope } from "./scope";

export function followUpTool({ ctx, owner }: Scope) {
  return tool({
    description: `Bring something back to ${owner.name} at a time they choose ("remind me Thursday", "check on this after the release"). It reaches them through their attention check, so within their active hours.`,
    inputSchema: z.object({
      what: z
        .string()
        .describe(
          "What to bring back and why, self-contained, as you'd say it to them then"
        ),
      at: z
        .string()
        .describe(
          `When, on ${owner.name}'s local clock: YYYY-MM-DDTHH:MM (the current time is in their message)`
        ),
      cardNumber: z.number().int().optional(),
    }),
    execute: safe(
      async ({ what, at, cardNumber }) => {
        const tz = timezoneOf(
          owner,
          await getWorkspaceById(ctx.db, { id: owner.workspaceId })
        );
        const when = startOfLocalMinute(at, tz);
        if (!when) {
          throw badRequest("Give the time as YYYY-MM-DDTHH:MM");
        }
        const card =
          cardNumber === undefined
            ? null
            : await getCardByNumber(ctx.db, {
                workspaceId: owner.workspaceId,
                number: cardNumber,
              });
        const item = await scheduleFollowUp(ctx, owner, {
          what,
          at: when,
          cardId: card?.id ?? null,
        });
        const automations = await listAutomations(ctx.db, {
          memberId: owner.id,
        });
        const checking = automations.some(
          (a) => a.kind === "check" && a.enabled
        );
        return {
          ok: true,
          id: item?.id,
          at: when.toISOString(),
          ...(checking
            ? {}
            : {
                note: `${owner.name}'s attention check is off, so it will wait in their attention list and their next digest instead of being pushed.`,
              }),
        };
      },
      {
        notFound:
          "Set it without a card number, or use search_cards to find the card.",
      }
    ),
  });
}
