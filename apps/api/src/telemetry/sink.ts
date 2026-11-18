import { hostname } from "node:os";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

export type Datasource = "spans" | "logs" | "metrics";

export type TelemetrySettings = {
  /** Unset: nothing leaves the process; logs still reach its console. */
  tinybirdToken?: string;
  tinybirdHost: string;
  sampleRate: number;
  slowMs: number;
  service: string;
  release: string;
  fetch: typeof fetch;
};

const FLUSH_MS = 2000;
const BATCH_ROWS = 500;
const MAX_QUEUED = 20_000;
const SEND_TIMEOUT_MS = 10_000;
const BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60_000;

const instance = `${hostname()}:${process.pid}`;
const gzipAsync = promisify(gzip);

let current: TelemetrySettings = {
  tinybirdHost: "https://api.tinybird.co",
  sampleRate: 1,
  slowMs: 2000,
  service: "worklog",
  release: "dev",
  fetch,
};
const DATASOURCES: Datasource[] = ["spans", "logs", "metrics"];
const queues: Record<Datasource, string[]> = {
  spans: [],
  logs: [],
  metrics: [],
};
const counts = { dropped: 0, quarantined: 0, failedSends: 0 };
let timer: ReturnType<typeof setInterval> | null = null;
let running: Promise<void> | null = null;
let queued: Promise<void> | null = null;
let failures = 0;
let pausedUntil = 0;
let lastWarning = 0;

export function settings() {
  return current;
}

/** Rows lost, rows Tinybird quarantined, failed sends, and what waits now: for runtime samples. */
export function sinkHealth() {
  return {
    ...counts,
    queued: DATASOURCES.reduce((sum, d) => sum + queues[d].length, 0),
  };
}

/** Points telemetry at Tinybird, or at nothing without a token. Returns what flushes and stops it. */
export function configureSink(next: TelemetrySettings) {
  current = next;
  failures = 0;
  pausedUntil = 0;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (!next.tinybirdToken) {
    for (const queue of Object.values(queues)) {
      queue.length = 0;
    }
    return async () => {
      await Promise.resolve();
    };
  }
  timer = setInterval(() => {
    flushSoon();
  }, FLUSH_MS);
  timer.unref();
  return async () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    await flush();
  };
}

/** UTC, as ClickHouse writes a DateTime64(3): what the datasources parse without guessing. */
export function stamp(date = new Date()) {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

export function emit(datasource: Datasource, row: Record<string, unknown>) {
  if (!current.tinybirdToken) {
    return;
  }
  const queue = queues[datasource];
  queue.push(
    JSON.stringify({
      ...row,
      service: current.service,
      release: current.release,
      instance,
    })
  );
  if (queue.length > MAX_QUEUED) {
    counts.dropped += queue.length - MAX_QUEUED;
    queue.splice(0, queue.length - MAX_QUEUED);
  }
  if (queue.length >= BATCH_ROWS) {
    flushSoon();
  }
}

/**
 * Sends everything queued by the time it's called, now, whatever the backoff: for shutdown, a
 * crash and tests. One send runs at a time; calls that come while one runs share a single send
 * after it, so an outage can't pile up waiting flushes.
 */
export async function flush() {
  if (running === null) {
    running = sendOnce();
    await running;
    return;
  }
  queued ??= sendAfter(running);
  await queued;
}

function flushSoon() {
  if (running !== null || Date.now() < pausedUntil) {
    return;
  }
  void flush();
}

async function sendOnce() {
  try {
    await sendAll();
  } finally {
    running = null;
  }
}

async function sendAfter(previous: Promise<void>) {
  await previous;
  queued = null;
  running ??= sendOnce();
  await running;
}

async function sendAll() {
  for (const datasource of DATASOURCES) {
    const queue = queues[datasource];
    while (queue.length > 0) {
      const batch = queue.splice(0, BATCH_ROWS);
      const outcome = await send(datasource, batch);
      if (outcome.retry) {
        queue.unshift(...batch);
        counts.failedSends += 1;
        failures += 1;
        const backoff = Math.min(
          MAX_BACKOFF_MS,
          BACKOFF_MS * 2 ** (failures - 1)
        );
        pausedUntil = Date.now() + (outcome.retryAfterMs ?? backoff);
        return;
      }
      failures = 0;
    }
  }
}

type Outcome = { retry: false } | { retry: true; retryAfterMs: number | null };

async function send(datasource: Datasource, rows: string[]) {
  const { tinybirdHost, tinybirdToken } = current;
  if (!tinybirdToken) {
    return { retry: false } satisfies Outcome;
  }
  const url = new URL("/v0/events", tinybirdHost);
  url.searchParams.set("name", datasource);
  try {
    const res = await current.fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tinybirdToken}`,
        "content-type": "application/x-ndjson",
        "content-encoding": "gzip",
      },
      body: await gzipAsync(`${rows.join("\n")}\n`),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const text = await res.text();
    if (res.ok) {
      noteQuarantined(datasource, text);
      return { retry: false } satisfies Outcome;
    }
    warn(
      `Tinybird answered ${res.status} for ${datasource}: ${text.slice(0, 200)}`
    );
    if (res.status === 429 || res.status >= 500) {
      return { retry: true, retryAfterMs: retryAfterMs(res) } satisfies Outcome;
    }
    counts.dropped += rows.length;
    return { retry: false } satisfies Outcome;
  } catch (error) {
    warn(`can't reach Tinybird: ${String(error)}`);
    return { retry: true, retryAfterMs: null } satisfies Outcome;
  }
}

function noteQuarantined(datasource: Datasource, body: string) {
  let quarantined = 0;
  try {
    const parsed: unknown = JSON.parse(body);
    const value: unknown =
      typeof parsed === "object" && parsed !== null
        ? Reflect.get(parsed, "quarantined_rows")
        : 0;
    quarantined = typeof value === "number" ? value : 0;
  } catch {
    return;
  }
  if (quarantined > 0) {
    counts.quarantined += quarantined;
    warn(
      `Tinybird quarantined ${quarantined} ${datasource} rows: the datasource and the API disagree on a column`
    );
  }
}

function retryAfterMs(res: Response) {
  const after = res.headers.get("retry-after");
  return after && /^\d+$/u.test(after)
    ? Math.min(Number(after) * 1000, MAX_BACKOFF_MS)
    : null;
}

function warn(message: string) {
  const now = Date.now();
  if (now - lastWarning < 60_000) {
    return;
  }
  lastWarning = now;
  console.warn(
    `[telemetry] ${message}${counts.dropped > 0 ? ` (${counts.dropped} rows dropped so far)` : ""}`
  );
}
