import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

import type { Config } from "../config";

// `fast` is for high-volume background work (proactive checks, log structuring, memory consolidation).
export type Models = { main: LanguageModel; fast: LanguageModel };

export function createModels(config: Config): Models | null {
  if (!config.OPENROUTER_API_KEY) {
    return null;
  }
  const openrouter = createOpenRouter({
    apiKey: config.OPENROUTER_API_KEY,
    appName: "Worklog",
    appUrl: config.PUBLIC_URL,
    // "strict" keeps usage/cost reporting on streamed responses.
    compatibility: "strict",
  });
  const model = (id: string) =>
    openrouter.chat(id, {
      usage: { include: true },
      provider: {
        // Work data never goes to providers that train on prompts.
        data_collection: "deny",
        // Prompt caches live per upstream: keep Claude conversations on Anthropic unless it's down.
        ...(id.startsWith("anthropic/")
          ? { order: ["anthropic"], allow_fallbacks: true }
          : {}),
      },
    });
  return {
    main: model(config.WORKLOG_MODEL),
    fast: model(config.WORKLOG_FAST_MODEL),
  };
}

// One hung provider call must not stall a request or the scheduler.
export const TIMEOUTS = {
  chat: { totalMs: 120_000, stepMs: 60_000 },
  background: { totalMs: 90_000, stepMs: 60_000 },
  quick: { totalMs: 30_000 },
} as const;

// Conversations are append-only with stable instructions and tools, so every turn can read the previous ones from cache.
export const CACHED = {
  openrouter: { cacheControl: { type: "ephemeral" } },
} as const;

export function modelIdOf(model: LanguageModel): string {
  return typeof model === "string" ? model : model.modelId;
}
