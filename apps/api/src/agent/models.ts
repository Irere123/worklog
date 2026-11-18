import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

import type { Config } from "#config";

export type Models = { main: LanguageModel; fast: LanguageModel };

export function createModels(config: Config) {
  if (!config.OPENROUTER_API_KEY) {
    return null;
  }
  const openrouter = createOpenRouter({
    apiKey: config.OPENROUTER_API_KEY,
    appName: "Worklog",
    appUrl: config.PUBLIC_URL,
    compatibility: "strict",
  });
  const model = (id: string) =>
    openrouter.chat(id, {
      usage: { include: true },
      provider: {
        data_collection: "deny",
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

export const TIMEOUTS = {
  chat: { totalMs: 120_000, stepMs: 60_000 },
  background: { totalMs: 90_000, stepMs: 60_000 },
  quick: { totalMs: 30_000 },
  dictation: { totalMs: 6000 },
} as const;

export const CACHED = {
  openrouter: { cacheControl: { type: "ephemeral" } },
} as const;
