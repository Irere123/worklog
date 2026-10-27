import { generateText, Output } from "ai";
import type { z } from "zod";

import { TIMEOUTS } from "./models";
import type { Models } from "./models";

type Call = {
  model: keyof Models;
  // Joined with blank lines; empty parts are dropped, so optional sections can be written inline.
  instructions: string | string[];
  prompt: string;
  timeout: keyof typeof TIMEOUTS;
};

// Every one-shot model call outside a conversation goes through here, so the shape of a call
// (tier, instructions, prompt, timeout, structured output) is written once. Callers decide what
// happens without a model; this takes one.
export async function structured<T>(
  models: Models,
  call: Call & { schema: z.ZodType<T> }
): Promise<T> {
  const { output } = await generateText({
    model: models[call.model],
    instructions: join(call.instructions),
    prompt: call.prompt,
    output: Output.object({ schema: call.schema }),
    timeout: TIMEOUTS[call.timeout],
  });
  return output;
}

export async function complete(models: Models, call: Call) {
  const result = await generateText({
    model: models[call.model],
    instructions: join(call.instructions),
    prompt: call.prompt,
    timeout: TIMEOUTS[call.timeout],
  });
  return {
    text: result.text.trim(),
    modelId: result.finalStep.response.modelId,
  };
}

function join(instructions: string | string[]) {
  return Array.isArray(instructions)
    ? instructions.filter(Boolean).join("\n\n")
    : instructions;
}
