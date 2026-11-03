import { loadConfig } from "./config";
import { createContext } from "./context";
import { syncAppsFromEnv } from "./ingest/apps";
import { startStreams } from "./ingest/streams";
import { startWorker } from "./jobs/tasks";
import { log } from "./telemetry/log";
import { reportCrashes } from "./telemetry/start";

reportCrashes();
// Jobs-only process, for deployments that run API replicas with RUN_SCHEDULER=false.
const config = loadConfig();
const ctx = await createContext(config, { service: "worker" });
// Apps that come from the environment pick up what changed there since the last start.
await syncAppsFromEnv(ctx);
const stop = await startWorker(ctx);
// Sockets apps need open (Discord's Gateway): one process holds each.
const stopStreams = startStreams(ctx);
log.info("Worklog worker running (ingestion, automations, entropy)", {
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
    await stopStreams();
    await stop();
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
