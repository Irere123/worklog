import { loadConfig } from "./config";
import { createContext } from "./context";
import { healthReport } from "./http/health";
import { syncAppsFromEnv } from "./ingest/apps";
import { startStreams } from "./ingest/streams";
import { exitWhenRunnerStops, startWorker } from "./jobs/tasks";
import { log } from "./telemetry/log";
import { reportCrashes } from "./telemetry/start";

reportCrashes();
const config = loadConfig();
const ctx = await createContext(config, { service: "worker" });
await syncAppsFromEnv(ctx);
const stop = await startWorker(ctx);
const stopStreams = startStreams(ctx);

const health = Bun.serve({
  hostname: config.HOST,
  port: config.WORKER_PORT,
  fetch: async (req) => {
    if (new URL(req.url).pathname !== "/health") {
      return new Response("Not found", { status: 404 });
    }
    const { status, body } = await healthReport(ctx);
    return Response.json(body, { status });
  },
});

log.info("Worklog worker running (ingestion, automations, entropy)", {
  health: `${health.url.href}health`,
  concurrency: config.WORKER_CONCURRENCY,
  telemetry: config.TINYBIRD_TOKEN ? "Tinybird" : "console only",
  release: config.WORKLOG_RELEASE,
});

let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  try {
    await stopStreams();
    await stop();
    await health.stop(true);
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

void exitWhenRunnerStops(stop.done, {
  stopping: () => shuttingDown,
  exit: async () => {
    await shutdown(1);
  },
});
