import { setTimeout as sleep } from "node:timers/promises";

import { createApp } from "./app";
import { loadConfig } from "./config";
import { createContext } from "./context";
import { syncAppsFromEnv } from "./ingest/apps";
import { startStreams } from "./ingest/streams";
import { exitWhenRunnerStops, startWorker } from "./jobs/tasks";
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
  hostname: config.HOST,
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

// Under what a platform waits after SIGTERM before killing the process (Railway's draining time
// is set to 30 seconds), so closing the database and flushing telemetry still get their turn.
const DRAIN_MS = 10_000;

// A second signal (Ctrl-C twice, `docker stop`) must not close everything again.
let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  try {
    await stopStreams?.();
    await stopWorker?.();
    // A graceful stop waits for every open request, and an event stream never ends on its own:
    // after the drain, what's still open is cut, and browsers reconnect to the new deployment
    // with Last-Event-ID, missing nothing.
    await Promise.race([server.stop(), sleep(DRAIN_MS)]);
    await server.stop(true);
    await stopRelay();
    await ctx.close();
    process.exit(code);
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

if (stopWorker) {
  void exitWhenRunnerStops(stopWorker.done, {
    stopping: () => shuttingDown,
    exit: async () => {
      await shutdown(1);
    },
  });
}
