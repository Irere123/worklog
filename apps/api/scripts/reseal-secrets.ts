import { loadConfig } from "#config";
import { createContext } from "#context";
import { resealSecrets } from "#ingest/reseal";

const ctx = await createContext(
  loadConfig({ ...process.env, OPENROUTER_API_KEY: "" }),
  { models: null }
);
console.log(
  `Re-sealed ${await resealSecrets(ctx)} value(s) with the current key`
);
await ctx.close();
