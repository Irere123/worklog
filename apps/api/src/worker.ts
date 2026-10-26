import { loadConfig } from "./config";
import { createContext } from "./context";
import { startScheduler } from "./jobs/scheduler";

/** Scheduler-only process, for deployments that run API replicas with RUN_SCHEDULER=false. */
const ctx = await createContext(loadConfig());
const stop = startScheduler(ctx);
console.log("Worklog worker running (automations, entropy)");

async function shutdown() {
  try {
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
