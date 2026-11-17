import type { AppContext } from "#context";

/**
 * Why a provider call failed, in the terms the pipeline acts on. revoked: the token no longer
 * works, so the connection is revoked and whoever installed it is told. rate_limited: try again
 * at `retryAt`. failed: anything else; the job retries with backoff.
 */
export class ProviderError extends Error {
  readonly kind: "revoked" | "rate_limited" | "failed";
  readonly retryAt: Date | null;
  /** The provider's HTTP status, when it answered with one. */
  readonly status: number | null;

  constructor(
    message: string,
    kind: ProviderError["kind"],
    retryAt: Date | null = null,
    status: number | null = null
  ) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.retryAt = retryAt;
    this.status = status;
  }
}

const MINUTE_MS = 60_000;

// GitHub signals its limits with 403 or 429 plus headers; others with 429 and Retry-After.
function retryAfter(res: Response, now: Date): Date | null {
  const after = res.headers.get("retry-after");
  if (after && /^\d+$/u.test(after)) {
    return new Date(now.getTime() + Number(after) * 1000);
  }
  const reset = res.headers.get("x-ratelimit-reset");
  if (
    res.headers.get("x-ratelimit-remaining") === "0" &&
    reset &&
    /^\d{1,12}$/u.test(reset)
  ) {
    return new Date(Number(reset) * 1000);
  }
  return res.status === 429 ? new Date(now.getTime() + MINUTE_MS) : null;
}

/** All a provider call needs, so a script without a database can make one too. */
export type Caller = Pick<AppContext, "fetch" | "now">;

/** A provider API call that throws `ProviderError` for anything but a 2xx. */
export async function call(
  ctx: Caller,
  what: string,
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const res = await ctx.fetch(url, init);
  if (res.ok) {
    return res;
  }
  const retryAt = retryAfter(res, ctx.now());
  if (retryAt) {
    throw new ProviderError(
      `${what}: rate limited`,
      "rate_limited",
      retryAt,
      res.status
    );
  }
  const text = await res.text();
  const detail = text.slice(0, 200);
  if (res.status === 401) {
    throw new ProviderError(
      `${what}: ${res.status} ${detail}`,
      "revoked",
      null,
      res.status
    );
  }
  throw new ProviderError(
    `${what}: ${res.status} ${detail}`,
    "failed",
    null,
    res.status
  );
}

export async function callJson(
  ctx: Caller,
  what: string,
  url: string,
  init: RequestInit = {}
): Promise<unknown> {
  const res = await call(ctx, what, url, init);
  return await res.json();
}
