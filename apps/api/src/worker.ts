import { loadConfig } from "./config";
import { createContext } from "./context";
import { syncAppsFromEnv } from "./ingest/apps";
import { startStreams } from "./ingest/streams";
import { startWorker } from "./jobs/tasks";

// Jobs-only process, for deployments that run API replicas with RUN_SCHEDULER=false.
const ctx = await createContext(loadConfig());
// Apps that come from the environment pick up what changed there since the last start.
await syncAppsFromEnv(ctx);
const stop = await startWorker(ctx);
// Sockets apps need open (Discord's Gateway): one process holds each.
const stopStreams = startStreams(ctx);
console.log("Worklog worker running (ingestion, automations, entropy)");

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
