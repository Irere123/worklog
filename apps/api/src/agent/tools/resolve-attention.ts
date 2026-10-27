import { tool } from "ai";
import { z } from "zod";

import { updateAttention } from "#attention/service";

import { safe } from "./scope";
import type { Scope } from "./scope";

export function resolveAttentionTool({ ctx, owner }: Scope) {
  return tool({
    description: "Mark an attention item done, dismissed, or snoozed.",
    inputSchema: z.object({
      id: z.string(),
      state: z.enum(["done", "dismissed", "snoozed"]),
      snoozeHours: z
        .number()
        .int()
        .min(1)
        .max(24 * 14)
        .optional(),
    }),
    execute: safe(async ({ id, state, snoozeHours }) => {
      const until =
        state === "snoozed"
          ? new Date(ctx.now().getTime() + (snoozeHours ?? 24) * 3_600_000)
          : null;
      const row = await updateAttention(ctx, owner.id, id, {
        state,
        snoozedUntil: until,
      });
      return { ok: true, id: row.id, state: row.state };
    }),
  });
}
