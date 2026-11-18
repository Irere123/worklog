import { createHash } from "node:crypto";

export type ErrorInfo = {
  type: string;
  message: string;
  /** Frames only: the message lines a stack starts with would carry what `message` withholds. */
  stack: string;
  /** What a program can act on: a Postgres SQLSTATE, a system errno, an API or provider code. */
  code: string;
  /** The first frame of our own code, as `function file`: where to start looking. */
  frame: string;
  key: string;
};

const MAX_MESSAGE = 1000;
const MAX_STACK = 4000;
const MAX_QUERY = 500;

const MASKS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/giu, "[email]"],
  [/\bwl_[\w-]+/gu, "[token]"],
  [/\bxox[a-z]-[\w-]+/giu, "[token]"],
  [/\bgh[opsu]_\w+/gu, "[token]"],
  [/\bgithub_pat_\w+/gu, "[token]"],
  [/\b(?<scheme>bearer|basic)\s+[\w.~+/=-]+/giu, "$<scheme> [redacted]"],
  [
    /(?<name>[\w-]*(?:token|key|secret|password))(?<sep>\s*[=:]\s*)[^\s&,;"']+/giu,
    "$<name>$<sep>[redacted]",
  ],
];

const AI_ERRORS_WITHOUT_CONTENT = new Set([
  "AI_APICallError",
  "AI_RetryError",
  "AI_LoadAPIKeyError",
  "AI_NoSuchModelError",
  "AI_NoSuchProviderError",
  "AI_UnsupportedFunctionalityError",
]);

export function scrub(text: string) {
  let out = text;
  for (const [pattern, mask] of MASKS) {
    out = out.replaceAll(pattern, mask);
  }
  return out;
}

export function describeError(error: unknown): ErrorInfo {
  if (!(error instanceof Error)) {
    const text = clip(scrub(String(error)), 200);
    return {
      type: "NonError",
      message: text,
      stack: "",
      code: "",
      frame: "",
      key: text,
    };
  }
  const own = messageOf(error);
  const message = [own, ...causesOf(error)].filter(Boolean).join(" ← ");
  const stack = error.stack ?? "";
  return {
    type: error.name,
    message: clip(scrub(message), MAX_MESSAGE),
    stack: clip(scrub(framesOf(stack)), MAX_STACK),
    code: codeOf(error),
    frame: ownFrame(stack),
    key: keyOf(error, own),
  };
}

/**
 * A refusal the caller caused (a 4xx, a constraint the request broke) rather than a fault: the
 * span records it, but it doesn't mark the span failed or keep its trace.
 */
export function isExpected(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  const status: unknown = Reflect.get(error, "status");
  if (typeof status === "number" && status >= 400 && status < 500) {
    return true;
  }
  return codeOf(error).startsWith("23");
}

/**
 * Groups occurrences of one problem: where it was logged, what kind of error and its code, its
 * message with what differs between occurrences taken out, and the first of our own frames.
 */
export function fingerprint(where: string, error: ErrorInfo | null) {
  const parts = [normalize(where)];
  if (error) {
    parts.push(error.type, error.code, normalize(error.key), error.frame);
  }
  return createHash("sha1").update(parts.join("\n")).digest("hex").slice(0, 16);
}

function messageOf(error: Error) {
  const query: unknown = Reflect.get(error, "query");
  if (
    typeof query === "string" &&
    Array.isArray(Reflect.get(error, "params"))
  ) {
    return `Failed query: ${clip(query, MAX_QUERY)}`;
  }
  if (
    error.name.startsWith("AI_") &&
    !AI_ERRORS_WITHOUT_CONTENT.has(error.name)
  ) {
    return "";
  }
  return error.message;
}

function causesOf(error: Error, depth = 0): string[] {
  const { cause } = error;
  if (!(cause instanceof Error) || depth >= 3) {
    return [];
  }
  const own = messageOf(cause);
  return [
    own ? `caused by ${cause.name}: ${own}` : `caused by ${cause.name}`,
    ...causesOf(cause, depth + 1),
  ];
}

function keyOf(error: Error, own: string) {
  const [firstLine = ""] = own.split("\n");
  if (error.name === "ProviderError") {
    return /^.*?: \d{3}\b/u.exec(firstLine)?.[0] ?? firstLine;
  }
  return firstLine;
}

function codeOf(error: Error, depth = 0): string {
  for (const key of ["code", "kind", "statusCode"]) {
    const value: unknown = Reflect.get(error, key);
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
  }
  return error.cause instanceof Error && depth < 3
    ? codeOf(error.cause, depth + 1)
    : "";
}

function framesOf(stack: string) {
  return stack
    .split("\n")
    .filter((line) => line.trimStart().startsWith("at "))
    .join("\n");
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu;
const MIXED_ID = /\b(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{8,}\b/gu;
const QUOTED = /"(?<inner>[^"]*)"|'[^']*'/gu;
const IDENTIFIER = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/u;

function normalize(text: string) {
  return text
    .replaceAll(QUOTED, (quoted, inner: string | undefined) =>
      inner !== undefined && IDENTIFIER.test(inner) ? quoted : "<str>"
    )
    .replaceAll(UUID, "<id>")
    .replaceAll(MIXED_ID, "<id>")
    .replaceAll(/\d+/gu, "<n>");
}

const OWN_FRAME =
  /^\s*at (?:async |new )?(?:(?<fn>[^\s(]+) \()?[^()]*\/src\/(?<file>[^:()]+)/u;

function ownFrame(stack: string) {
  for (const line of stack.split("\n")) {
    const match = line.includes("node_modules") ? null : OWN_FRAME.exec(line);
    if (match) {
      return `${match.groups?.fn ?? "<anonymous>"} ${match.groups?.file ?? ""}`;
    }
  }
  return "";
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
