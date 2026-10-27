import { tool } from "ai";
import { z } from "zod";

import { forgetMemory } from "#memory/service";

import { safe } from "./scope";
import type { Scope } from "./scope";

export function forgetTool({ ctx, owner }: Scope) {
  return tool({
    description: "Retire a memory that is wrong or outdated.",
    inputSchema: z.object({ id: z.string() }),
    execute: safe(async ({ id }) => {
      await forgetMemory(ctx, owner.id, id);
      return { ok: true };
    }),
  });
}
