import { createApp } from "./app";
import { loadConfig } from "./config";
import { createContext } from "./context";
import { startWorker } from "./jobs/worker";

const config = loadConfig();
const ctx = await createContext(config);
const app = createApp(ctx);
const stopWorker = config.RUN_SCHEDULER ? await startWorker(ctx) : null;

const server = Bun.serve({
  port: config.PORT,
  fetch: app.fetch,
  // SSE streams stay open
  idleTimeout: 0,
});

console.log(
  `Worklog API on ${server.url.href} — docs at ${config.PUBLIC_URL}/docs`
);
console.log(
  `  AI: ${ctx.models ? `${config.WORKLOG_MODEL} / ${config.WORKLOG_FAST_MODEL} via OpenRouter` : "off (set OPENROUTER_API_KEY)"}`
);
console.log(`  Mail: ${ctx.mailer.kind} · Jobs: ${stopWorker ? "on" : "off"}`);

// A second signal (Ctrl-C twice, `docker stop`) must not close everything again.
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  try {
    await stopWorker?.();
    await server.stop();
    await ctx.close();
    process.exit(0);
  } catch (error) {
    console.error("Shutdown failed", error);
    process.exit(1);
  }
}
process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
