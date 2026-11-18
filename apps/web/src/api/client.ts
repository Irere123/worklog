import createClient from "openapi-fetch";

import { takeBootResponse } from "#lib/boot";

import type { components, paths } from "./schema";

export type Schemas = components["schemas"];

const KEY = "worklog.apiKey";
const WORKSPACE = "worklog.workspace";

export const auth = {
  key: () => localStorage.getItem(KEY),
  setKey(key: string | null) {
    if (key) {
      localStorage.setItem(KEY, key);
    } else {
      localStorage.removeItem(KEY);
    }
  },
  workspace: () => localStorage.getItem(WORKSPACE),
  setWorkspace(id: string) {
    localStorage.setItem(WORKSPACE, id);
  },
};

export function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const key = auth.key();
  if (key) {
    headers.authorization = `Bearer ${key}`;
  }
  const workspace = auth.workspace();
  if (workspace) {
    headers["x-worklog-workspace"] = workspace;
  }
  return headers;
}

export const api = createClient<paths>({ baseUrl: "", credentials: "include" });

api.use({
  onRequest({ request }) {
    for (const [name, value] of Object.entries(authHeaders())) {
      request.headers.set(name, value);
    }
    return request;
  },
});

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type Result<T> = { data?: T; error?: unknown; response: Response };

/** The body of a successful call, or an `ApiError` carrying the server's code and message. */
export async function unwrap<T>(call: Promise<Result<T>>): Promise<T> {
  const result = await call;
  if (succeeded(result)) {
    return result.data;
  }
  const body = (result.error ?? {}) as {
    error?: {
      code?: string;
      message?: string;
      issues?: { path?: (string | number)[]; message?: string }[];
    };
  };
  const [issue] = body.error?.issues ?? [];
  throw new ApiError(
    result.response.status,
    body.error?.code ?? "error",
    (issue ? readable(issue) : null) ??
      body.error?.message ??
      result.response.statusText
  );
}

function readable(issue: { path?: (string | number)[]; message?: string }) {
  const field = issue.path?.findLast((part) => typeof part === "string");
  if (!issue.message) {
    return null;
  }
  if (typeof field !== "string") {
    return issue.message;
  }
  const words = field.replaceAll(
    /(?<lower>[a-z])(?<upper>[A-Z])/gu,
    "$<lower> $<upper>"
  );
  return `${words.charAt(0).toUpperCase()}${words.slice(1).toLowerCase()}: ${issue.message}`;
}

/**
 * Like `unwrap`, but answered by the boot script's early request for `path` when it made one.
 */
export async function unwrapEarly<T>(
  path: string,
  call: () => Promise<Result<T>>
): Promise<T> {
  const early = await takeBootResponse(path);
  if (!early) {
    return await unwrap(call());
  }
  const body: unknown = await early.json().catch(() => null);
  return await unwrap(
    Promise.resolve(
      early.ok
        ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the early request is the same call the caller types
          { data: body as T, response: early }
        : { error: body ?? {}, response: early }
    )
  );
}

function succeeded<T>(result: Result<T>): result is Result<T> & { data: T } {
  return result.error === undefined && result.response.ok;
}
