import { createApp } from "./app";
import { loadConfig } from "./config";
import { createContext } from "./context";
import { startScheduler } from "./jobs/scheduler";

const config = loadConfig();
const ctx = await createContext(config);
const app = createApp(ctx);
const stopScheduler = config.RUN_SCHEDULER ? startScheduler(ctx) : null;

const server = Bun.serve({
  port: config.PORT,
  fetch: app.fetch,
  idleTimeout: 0, // SSE streams stay open
});

console.log(`Worklog API on ${server.url} — docs at ${config.PUBLIC_URL}/docs`);
console.log(`  AI: ${ctx.models ? `${config.WORKLOG_MODEL} / ${config.WORKLOG_FAST_MODEL} via OpenRouter` : "off (set OPENROUTER_API_KEY)"}`);
console.log(`  Mail: ${ctx.mailer.kind} · Scheduler: ${stopScheduler ? "on" : "off"} · DB: ${config.DATABASE_URL.startsWith("postgres") ? "postgres" : "pglite"}`);

const shutdown = async () => {
  await stopScheduler?.();
  await server.stop();
  await ctx.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
