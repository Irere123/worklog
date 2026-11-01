import createClient from "openapi-fetch";

import type { components, paths } from "./schema";

export type Schemas = components["schemas"];

const KEY = "worklog.apiKey";
const WORKSPACE = "worklog.workspace";

// Browsers sign in with a session cookie; an API key from setup or settings is the fallback for
// servers without email, and for testing as an agent.
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
    error?: { code?: string; message?: string };
  };
  throw new ApiError(
    result.response.status,
    body.error?.code ?? "error",
    body.error?.message ?? result.response.statusText
  );
}

// openapi-fetch leaves data unset only for an empty body (a 204), which the API never sends.
function succeeded<T>(result: Result<T>): result is Result<T> & { data: T } {
  return result.error === undefined && result.response.ok;
}
