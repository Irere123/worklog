import { generateText, isStepCount, tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";

import { TIMEOUTS } from "#agent/models";
import { prompt, UNTRUSTED_NOTE } from "#agent/prompts";

import { safe } from "./scope";
import type { Scope } from "./scope";

const MAX_STEPS = 8;

export function lookIntoTool(scope: Scope, lookups: ToolSet) {
  const { ctx, owner } = scope;
  return tool({
    description:
      "Hand a question that needs many lookups (a month of activity, everything about a project) to a helper, and get back a short report instead of every result.",
    inputSchema: z.object({
      task: z
        .string()
        .describe(
          "What to find out, self-contained: the helper sees nothing of this conversation"
        ),
    }),
    execute: safe(async ({ task }) => {
      const { models } = ctx;
      if (!models) {
        return { error: "AI isn't configured" };
      }
      const result = await generateText({
        model: models.main,
        instructions: [
          prompt("helper", { owner: owner.name }),
          UNTRUSTED_NOTE,
        ].join("\n\n"),
        prompt: task,
        tools: lookups,
        stopWhen: isStepCount(MAX_STEPS),
        timeout: TIMEOUTS.background,
      });
      return { report: result.text.trim() || "The helper found nothing." };
    }),
  });
}
