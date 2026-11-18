import { z } from "zod";

import { call, ProviderError } from "#connectors/http";
import type { AppContext } from "#context";

const API = "https://slack.com/api";

const Result = z.looseObject({
  ok: z.boolean(),
  error: z.string().optional(),
});

const REVOKED = new Set([
  "invalid_auth",
  "not_authed",
  "token_revoked",
  "token_expired",
  "account_inactive",
  "team_access_not_granted",
]);

function check(method: string, body: z.infer<typeof Result>, now: Date) {
  if (body.ok) {
    return;
  }
  const error = body.error ?? "unknown_error";
  if (REVOKED.has(error)) {
    throw new ProviderError(`Slack ${method}: ${error}`, "revoked");
  }
  if (error === "ratelimited") {
    throw new ProviderError(
      `Slack ${method}: rate limited`,
      "rate_limited",
      new Date(now.getTime() + 60_000)
    );
  }
  throw new ProviderError(`Slack ${method}: ${error}`, "failed");
}

/** A Web API method with the bot token. Reads go as GET with a query string. */
export async function slackApi(
  ctx: AppContext,
  token: string,
  method: string,
  params: Record<string, string | number | boolean | undefined> = {},
  opts: {
    json?: Record<string, unknown>;
    /** Errors that are an answer, not a failure: the body comes back with `ok: false`. */
    soft?: string[];
  } = {}
) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) {
      query.set(k, String(v));
    }
  }
  const url = `${API}/${method}${opts.json ? "" : `?${query.toString()}`}`;
  const res = await call(ctx, `Slack ${method}`, url, {
    method: opts.json ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts.json ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.json ? JSON.stringify(opts.json) : undefined,
  });
  const body = Result.parse(await res.json());
  if (!body.ok && body.error && opts.soft?.includes(body.error) === true) {
    return body;
  }
  check(method, body, ctx.now());
  return body;
}

/** OAuth calls authenticate with the app's client credentials, form-encoded. */
export async function slackOAuth(
  ctx: AppContext,
  method: string,
  form: Record<string, string>
) {
  const res = await call(ctx, `Slack ${method}`, `${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const body = Result.parse(await res.json());
  check(method, body, ctx.now());
  return body;
}

export function botTokenOf(secrets: Record<string, string>) {
  const token = secrets.botToken;
  if (!token) {
    throw new ProviderError(
      "This Slack connection has no bot token",
      "revoked"
    );
  }
  return token;
}
