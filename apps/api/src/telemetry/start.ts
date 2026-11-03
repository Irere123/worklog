import { setTimeout as sleep } from "node:timers/promises";

import type { Pool } from "pg";

import type { Config } from "#config";

import { traceModelCalls } from "./ai";
import { log } from "./log";
import { configureSink, emit, flush, sinkHealth, stamp } from "./sink";

const SAMPLE_MS = 30_000;

/**
 * Starts shipping this process's spans, logs and runtime samples to Tinybird, when a token is
 * set. Returns what flushes and stops it.
 */
export function startTelemetry(
  config: Config,
  opts: { service: string; pool: Pool; fetch: typeof fetch }
) {
  const stopSink = configureSink({
    tinybirdToken: config.TINYBIRD_TOKEN,
    tinybirdHost: config.TINYBIRD_HOST,
    sampleRate: config.TELEMETRY_SAMPLE_RATE,
    slowMs: config.TELEMETRY_SLOW_MS,
    service: opts.service,
    release: config.WORKLOG_RELEASE,
    fetch: opts.fetch,
  });
  traceModelCalls();
  const stopSamples = config.TINYBIRD_TOKEN ? sampleRuntime(opts.pool) : null;
  return async () => {
    stopSamples?.();
    await stopSink();
  };
}

/**
 * A crash is logged, and the log shipped, before the process exits as it would have without
 * this. For the long-running processes only: tests and scripts keep their runner's handling.
 */
export function reportCrashes() {
  process.on("uncaughtException", (error) => {
    void crash("uncaught exception", error);
  });
  process.on("unhandledRejection", (error) => {
    void crash("unhandled rejection", error);
  });
}

async function crash(kind: string, error: unknown) {
  log.error(`process: ${kind}`, { error });
  // Tinybird being down must not keep a crashed process alive.
  await Promise.race([flush(), sleep(5000)]);
  process.exit(1);
}

// The event loop's lag, memory, CPU, the connection pool and telemetry's own health, every 30
// seconds: a slow endpoint can't tell you on its own whether the whole process was struggling,
// and a quiet hour can't tell you whether its rows were lost. The samples double as a heartbeat.
function sampleRuntime(pool: Pool) {
  let cpu = process.cpuUsage();
  let lagMs = 0;
  let expected = performance.now() + 1000;
  const lag = setInterval(() => {
    const now = performance.now();
    lagMs = Math.max(lagMs, now - expected);
    expected = now + 1000;
  }, 1000);
  lag.unref();

  const sample = setInterval(() => {
    const memory = process.memoryUsage();
    const used = process.cpuUsage(cpu);
    cpu = process.cpuUsage();
    const timestamp = stamp();
    const sink = sinkHealth();
    const metrics: Record<string, number> = {
      "process.event_loop_lag_ms": Math.round(lagMs),
      "process.rss_mb": memory.rss / 1e6,
      "process.heap_used_mb": memory.heapUsed / 1e6,
      "process.cpu_percent":
        ((used.user + used.system) / 1000 / SAMPLE_MS) * 100,
      "db.pool.total": pool.totalCount,
      "db.pool.idle": pool.idleCount,
      "db.pool.waiting": pool.waitingCount,
      // Counted since the process started: a rise means rows went missing.
      "telemetry.dropped_rows": sink.dropped,
      "telemetry.quarantined_rows": sink.quarantined,
      "telemetry.failed_sends": sink.failedSends,
      "telemetry.queued_rows": sink.queued,
    };
    lagMs = 0;
    for (const [name, value] of Object.entries(metrics)) {
      emit("metrics", {
        timestamp,
        name,
        value: Math.round(value * 100) / 100,
      });
    }
  }, SAMPLE_MS);
  sample.unref();

  return () => {
    clearInterval(lag);
    clearInterval(sample);
  };
}
