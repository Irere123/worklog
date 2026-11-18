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
await syncAppsFromEnv(ctx);
const stopWorker = config.RUN_SCHEDULER ? await startWorker(ctx) : null;
const stopStreams = config.RUN_SCHEDULER ? startStreams(ctx) : null;
const stopRelay = await ctx.bus.listen();

const server = Bun.serve({
  hostname: config.HOST,
  port: config.PORT,
  fetch: app.fetch,
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

const DRAIN_MS = 10_000;

let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  try {
    await stopStreams?.();
    await stopWorker?.();
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
