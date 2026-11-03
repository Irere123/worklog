import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

import { describeError, isExpected } from "./describe";
import type { ErrorInfo } from "./describe";
import { emit, settings, stamp } from "./sink";

export type Attrs = Record<
  string,
  string | number | boolean | null | undefined
>;
export type SpanKind = "server" | "client" | "consumer" | "internal";

/** A W3C trace context: where a span continues a trace another process started. */
export type TraceParent = { traceId: string; spanId: string };

// Spans finished before their trace's local root wait here, so a whole trace is kept or dropped
// together: an error or a slow root keeps every span of it, whatever the sample rate.
type Trace = {
  sampled: boolean;
  failed: boolean;
  keep: boolean | null;
  // How many traces each kept span stands for, so counts and rates can be estimated from what
  // was kept: one for a trace kept for its error or slowness (all of those are), 1/rate for one
  // kept by sampling.
  weight: number;
  held: Record<string, unknown>[];
  dropped: number;
};

// A runaway trace (a replay touching thousands of rows) can't hold memory without bound.
const MAX_HELD = 2000;

const active = new AsyncLocalStorage<Span>();

export class Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentId: string;
  readonly kind: SpanKind;
  name: string;
  readonly attrs: Attrs;
  status: "ok" | "error" = "ok";
  error: ErrorInfo | null = null;
  // Queries run in this span and the spans under it: their count and time spot N+1s and slow
  // writes without a span per query. A child adds its totals to its parent's as it ends.
  dbQueries = 0;
  dbMs = 0;

  readonly #trace: Trace;
  readonly #root: boolean;
  readonly #parent: Span | null;
  readonly #startedAt: Date;
  readonly #start: number;
  #ended = false;

  constructor(
    name: string,
    kind: SpanKind,
    attrs: Attrs,
    parent: Span | TraceParent | null,
    start = performance.now()
  ) {
    this.#start = start;
    this.#startedAt = new Date(Date.now() - (performance.now() - start));
    this.name = name;
    this.kind = kind;
    this.attrs = { ...attrs };
    this.spanId = randomBytes(8).toString("hex");
    if (parent instanceof Span) {
      this.#trace = parent.#trace;
      this.traceId = parent.traceId;
      this.parentId = parent.spanId;
      this.#root = false;
      this.#parent = parent;
    } else {
      this.#parent = null;
      this.traceId = parent?.traceId ?? randomBytes(16).toString("hex");
      this.parentId = parent?.spanId ?? "";
      this.#trace = {
        sampled: Math.random() < settings().sampleRate,
        failed: false,
        keep: null,
        weight: 1,
        held: [],
        dropped: 0,
      };
      this.#root = true;
    }
  }

  set(attrs: Attrs) {
    Object.assign(this.attrs, attrs);
  }

  /**
   * Records what went wrong. A refusal the caller caused (a 4xx, a broken constraint) is recorded
   * without failing the span or keeping its trace: it's how the API answers, not a fault.
   */
  fail(error: unknown) {
    this.error = describeError(error);
    if (isExpected(error)) {
      return;
    }
    this.status = "error";
    this.#trace.failed = true;
  }

  /** Keeps the trace without marking this span failed: a handled error was logged inside it. */
  flag() {
    this.#trace.failed = true;
  }

  end() {
    if (this.#ended) {
      return;
    }
    this.#ended = true;
    if (this.#parent) {
      this.#parent.dbQueries += this.dbQueries;
      this.#parent.dbMs += this.dbMs;
    }
    const durationMs = performance.now() - this.#start;
    const row = this.#row(durationMs);
    const trace = this.#trace;
    if (this.#root) {
      const vital = trace.failed || durationMs >= settings().slowMs;
      trace.keep = trace.sampled || vital;
      const { sampleRate } = settings();
      trace.weight = vital || sampleRate <= 0 ? 1 : Math.round(1 / sampleRate);
      if (trace.keep) {
        for (const held of trace.held) {
          emit("spans", { ...held, weight: trace.weight });
        }
        if (trace.dropped > 0) {
          row.attributes = JSON.stringify({
            ...JSON.parse(row.attributes),
            "trace.dropped_spans": trace.dropped,
          });
        }
        emit("spans", { ...row, weight: trace.weight });
      }
      trace.held = [];
      return;
    }
    if (trace.keep === null) {
      if (trace.held.length < MAX_HELD) {
        trace.held.push(row);
      } else {
        trace.dropped += 1;
      }
      return;
    }
    // Finished after its root, like a stream that outlives the request that started it. Its
    // trace may have been dropped by then, so it can arrive without its parents.
    if (trace.keep || this.status === "error") {
      emit("spans", {
        ...row,
        weight: trace.keep ? trace.weight : 1,
        attributes: JSON.stringify({
          ...JSON.parse(row.attributes),
          "trace.late": true,
        }),
      });
    }
  }

  #row(durationMs: number) {
    const { "workspace.id": workspaceId, ...rest } = this.attrs;
    return {
      timestamp: stamp(this.#startedAt),
      trace_id: this.traceId,
      span_id: this.spanId,
      parent_id: this.parentId,
      name: this.name,
      kind: this.kind,
      duration_ms: Math.round(durationMs * 1000) / 1000,
      status: this.status,
      workspace_id: typeof workspaceId === "string" ? workspaceId : "",
      db_queries: this.dbQueries,
      db_ms: Math.round(this.dbMs * 1000) / 1000,
      error_type: this.error?.type ?? "",
      error_message: this.error?.message ?? "",
      error_code: this.error?.code ?? "",
      attributes: JSON.stringify(compact(rest)),
    };
  }
}

export function activeSpan(): Span | undefined {
  return active.getStore();
}

/** Runs `fn` with `span` as the active span, for work a library hands back to run. */
export function runIn<T>(span: Span, fn: () => T): T {
  return active.run(span, fn);
}

/**
 * Runs `fn` outside any trace, for callbacks that fire long after whatever registered them: a
 * pool connection's error belongs to no request that happened to open it.
 */
export function outsideTrace<T>(fn: () => T): T {
  return active.exit(fn);
}

/**
 * Runs `fn` as a span, a child of the active one unless `parent` says otherwise (`null` starts a
 * new trace). A throw fails the span and is rethrown.
 */
export async function traced<T>(
  name: string,
  attrs: Attrs,
  fn: (span: Span) => Promise<T>,
  opts: { kind?: SpanKind; parent?: Span | TraceParent | null } = {}
): Promise<T> {
  const span = startSpan(name, attrs, opts);
  try {
    return await active.run(span, async () => await fn(span));
  } catch (error) {
    span.fail(error);
    throw error;
  } finally {
    span.end();
  }
}

/**
 * A span the caller ends, for work whose start and end arrive as separate callbacks. `startedAt`
 * (a `performance.now()` reading) backdates it, for work only known to be worth a span once done.
 */
export function startSpan(
  name: string,
  attrs: Attrs,
  opts: {
    kind?: SpanKind;
    parent?: Span | TraceParent | null;
    startedAt?: number;
  } = {}
) {
  const parent = opts.parent === undefined ? activeSpan() : opts.parent;
  return new Span(
    name,
    opts.kind ?? "internal",
    attrs,
    parent ?? null,
    opts.startedAt
  );
}

const TRACEPARENT =
  /^00-(?<traceId>[0-9a-f]{32})-(?<spanId>[0-9a-f]{16})-[0-9a-f]{2}$/u;

export function parseTraceparent(
  header: string | undefined
): TraceParent | null {
  const groups = header ? TRACEPARENT.exec(header.trim())?.groups : undefined;
  const traceId = groups?.traceId;
  const spanId = groups?.spanId;
  if (!traceId || !spanId || /^0+$/u.test(traceId)) {
    return null;
  }
  return { traceId, spanId };
}

function compact(attrs: Attrs) {
  return Object.fromEntries(
    Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null)
  );
}
