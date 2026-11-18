import { describeError, fingerprint, scrub } from "./describe";
import { emit, stamp } from "./sink";
import { activeSpan } from "./trace";

type Level = "info" | "warn" | "error";

/**
 * What a log line carries besides its message. `error` is described (type, message, stack) and
 * grouped into an issue; the rest are attributes. Never content: no message text, payloads or
 * prompts, since logs leave for Tinybird.
 */
export type LogFields = {
  error?: unknown;
  [key: string]: unknown;
};

/**
 * The one way the API logs. The message is fixed text, so occurrences group into one issue; what
 * varies goes in the fields. Lines print to the console and, with Tinybird set up, are stored
 * with the trace they happened in.
 */
export const log = {
  info: (message: string, fields?: LogFields) => {
    write("info", message, fields);
  },
  warn: (message: string, fields?: LogFields) => {
    write("warn", message, fields);
  },
  error: (message: string, fields?: LogFields) => {
    write("error", message, fields);
  },
};

function write(level: Level, message: string, fields: LogFields = {}) {
  const { error, ...rest } = fields;
  const attrs = Object.fromEntries(
    Object.entries(rest)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, field(v)])
  );
  print(level, message, attrs, error);

  const span = activeSpan();
  if (level === "error") {
    span?.flag();
  }
  emit("logs", {
    timestamp: stamp(),
    level,
    message: scrub(message),
    trace_id: span?.traceId ?? "",
    span_id: span?.spanId ?? "",
    ...errorColumns(level, message, error),
    attributes: JSON.stringify(attrs),
  });
}

function errorColumns(level: Level, message: string, error: unknown) {
  if (error === undefined) {
    return {
      error_type: "",
      error_message: "",
      error_stack: "",
      error_code: "",
      error_frame: "",
      fingerprint: level === "error" ? fingerprint(message, null) : "",
    };
  }
  const described = describeError(error);
  return {
    error_type: described.type,
    error_message: described.message,
    error_stack: described.stack,
    error_code: described.code,
    error_frame: described.frame,
    fingerprint: fingerprint(message, described),
  };
}

function print(
  level: Level,
  message: string,
  attrs: Record<string, unknown>,
  error: unknown
) {
  const parts: unknown[] = [message];
  if (Object.keys(attrs).length > 0) {
    parts.push(attrs);
  }
  if (error !== undefined) {
    parts.push(error);
  }
  if (level === "error") {
    console.error(...parts);
  } else if (level === "warn") {
    console.warn(...parts);
  } else {
    console.log(...parts);
  }
}

function field(value: unknown) {
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return scrub(value);
  }
  try {
    return scrub(JSON.stringify(value) ?? String(value));
  } catch {
    return scrub(String(value));
  }
}
