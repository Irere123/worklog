import { createApp } from "./app";
import { loadConfig } from "./config";
import { createContext } from "./context";
import { syncAppsFromEnv } from "./ingest/apps";
import { startStreams } from "./ingest/streams";
import { startWorker } from "./jobs/tasks";
import { log } from "./telemetry/log";
import { reportCrashes } from "./telemetry/start";

reportCrashes();
const config = loadConfig();
const ctx = await createContext(config, { service: "api" });
const app = createApp(ctx);
// Apps that come from the environment pick up what changed there since the last start.
await syncAppsFromEnv(ctx);
const stopWorker = config.RUN_SCHEDULER ? await startWorker(ctx) : null;
// Sockets apps need open (Discord's Gateway) run where the jobs do.
const stopStreams = config.RUN_SCHEDULER ? startStreams(ctx) : null;
// Realtime streams also carry what worker processes and other replicas publish.
const stopRelay = await ctx.bus.listen();

const server = Bun.serve({
  port: config.PORT,
  fetch: app.fetch,
  // SSE streams stay open
  idleTimeout: 0,
});

log.info("Worklog API started", {
  url: server.url.href,
  docs: `${config.PUBLIC_URL}/docs`,
  ai: ctx.models
    ? `${config.WORKLOG_MODEL} / ${config.WORKLOG_FAST_MODEL} via OpenRouter`
    : "off (set OPENROUTER_API_KEY)",
  mail: ctx.mailer.kind,
  jobs: stopWorker ? "on" : "off",
  telemetry: config.TINYBIRD_TOKEN ? "Tinybird" : "console only",
  release: config.WORKLOG_RELEASE,
});

// A second signal (Ctrl-C twice, `docker stop`) must not close everything again.
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  try {
    await stopStreams?.();
    await stopWorker?.();
    await server.stop();
    await stopRelay();
    await ctx.close();
    process.exit(0);
  } catch (error) {
    log.error("shutdown failed", { error });
    process.exit(1);
  }
}
process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
