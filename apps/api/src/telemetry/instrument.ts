import type { Pool, PoolClient } from "pg";

import { activeSpan, startSpan, traced } from "./trace";
import type { Attrs, Span } from "./trace";

/**
 * A fetch whose calls are spans: method, host and status. Never the path or query, which carry
 * secrets for some targets (a Slack incoming-webhook URL is its own credential).
 */
export function tracedFetch(inner: typeof fetch): typeof fetch {
  const wrapped = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    return await traced(
      `${method} ${url.host}`,
      { "http.method": method, "server.address": url.host },
      async (span) => {
        const res = await inner(input, init);
        span.set({ "http.status_code": res.status });
        if (res.status >= 500) {
          span.fail(new Error(`${url.host} answered ${res.status}`));
        }
        return res;
      },
      { kind: "client" }
    );
  };
  return Object.assign(wrapped, inner);
}

// Below this a query only counts toward its span's totals; at or above it, it gets a span of its
// own with its SQL. Drizzle sends parameters apart from the text, so no values are recorded.
const SLOW_QUERY_MS = 250;
const MAX_STATEMENT = 2000;

const instrumented = new WeakSet<object>();

/**
 * Counts every query on the pool toward the span it ran in, and records slow ones. Drizzle, Better
 * Auth and Graphile Worker all query through it.
 */
export function instrumentPool(pool: Pool) {
  wrapQuery(pool);
  pool.on("connect", (client) => {
    wrapQuery(client);
  });
}

// The promise form is what Drizzle, Better Auth and Graphile Worker call, on the pool and on the
// clients it lends for transactions. Pool#query runs on a client through pg's callback form,
// which passes through untimed, so a query counts once. It's timed at the pool, not the client,
// because pg hands a waiting query its connection in the context of whoever released it: timed
// there, it would count toward another request. So a query's time includes waiting for a
// connection, and a slow one says how busy the pool was when it was asked.
function wrapQuery(target: Pool | PoolClient) {
  if (instrumented.has(target)) {
    return;
  }
  instrumented.add(target);
  const query = target.query.bind(target) as (...args: unknown[]) => unknown;
  Object.defineProperty(target, "query", {
    configurable: true,
    writable: true,
    value: (...args: unknown[]) => {
      const span = activeSpan();
      if (!span || typeof args.at(-1) === "function") {
        return query(...args);
      }
      const started = performance.now();
      const busy = "waitingCount" in target ? poolBusy(target) : {};
      const result = query(...args);
      return result instanceof Promise
        ? timed(result, { span, query: args[0], started, busy })
        : result;
    },
  });
}

type Call = { span: Span; query: unknown; started: number; busy: Attrs };

function poolBusy(pool: Pool): Attrs {
  return {
    "db.pool.waiting": pool.waitingCount,
    "db.pool.idle": pool.idleCount,
  };
}

async function timed(result: Promise<unknown>, call: Call) {
  try {
    const value = await result;
    record(call);
    return value;
  } catch (error) {
    record(call, error);
    throw error;
  }
}

function record({ span, query, started, busy }: Call, error?: unknown) {
  const ms = performance.now() - started;
  span.dbQueries += 1;
  span.dbMs += ms;
  if (ms < SLOW_QUERY_MS && error === undefined) {
    return;
  }
  const text = statementOf(query);
  const slow = startSpan(
    "db.query",
    { "db.statement": text.slice(0, MAX_STATEMENT), ...busy },
    { kind: "client", parent: span, startedAt: started }
  );
  if (error !== undefined) {
    slow.fail(error);
  }
  slow.end();
}

function statementOf(query: unknown) {
  if (typeof query === "string") {
    return query;
  }
  if (
    typeof query === "object" &&
    query !== null &&
    "text" in query &&
    typeof query.text === "string"
  ) {
    return query.text;
  }
  return "";
}
