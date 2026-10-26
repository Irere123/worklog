import { createApp } from "../app";
import { loadConfig } from "../config";
import { createContext } from "../context";

const ctx = await createContext(
  loadConfig({
    ...process.env,
    DATABASE_URL: "memory://",
    OPENROUTER_API_KEY: "",
  }),
  { models: null }
);
const res = await createApp(ctx).request("/openapi.json");
console.log(JSON.stringify(await res.json(), null, 2));
await ctx.close();
