import { tool } from "ai";
import { z } from "zod";

import { reviewed } from "#agent/review";

import { safe } from "./scope";
import type { Scope } from "./scope";

export function createCardTool(scope: Scope) {
  return tool({
    description:
      "Create a card. Without a column it lands in Maybe? for triage.",
    inputSchema: z.object({
      title: z.string(),
      body: z.string().optional(),
      board: z
        .string()
        .optional()
        .describe("Board name or id; defaults to the first board"),
      column: z
        .string()
        .optional()
        .describe("Column name to put it straight into"),
      assignToOwner: z.boolean().optional(),
    }),
    execute: safe(async (input) => await reviewed(scope, "create_card", input)),
  });
}
