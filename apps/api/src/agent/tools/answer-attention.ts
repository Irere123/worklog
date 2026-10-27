import { tool } from "ai";
import { z } from "zod";

import { performAttentionAction } from "#work/drift";

import { safe } from "./scope";
import type { Scope } from "./scope";

export function answerAttentionTool({ ctx, owner }: Scope) {
  return tool({
    description:
      "Answer an attention item's one-click question for them (e.g. a drifting card: keep / not_now / done).",
    inputSchema: z.object({ id: z.string(), actionId: z.string() }),
    execute: safe(async ({ id, actionId }) => {
      const row = await performAttentionAction(ctx, owner, id, actionId);
      return { ok: true, id: row.id, state: row.state };
    }),
  });
}
