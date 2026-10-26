import { loadConfig } from "./config";
import { createContext } from "./context";
import { startScheduler } from "./jobs/scheduler";

/** Scheduler-only process, for deployments that run API replicas with RUN_SCHEDULER=false. */
const ctx = await createContext(loadConfig());
const stop = startScheduler(ctx);
console.log("Worklog worker running (automations, entropy)");

const shutdown = async () => {
  await stop();
  await ctx.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
