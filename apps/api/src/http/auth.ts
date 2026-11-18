import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";

import type { AppContext } from "#context";
import { listMemberships } from "#db/queries/members";
import type { Member } from "#db/queries/members";
import type { ApiScope } from "#db/schema";
import { authenticate } from "#work/members";
import type { SignedInUser } from "#work/members";

import type { Env } from "./router";

const deny = (c: Context, status: 401 | 403, code: string, message: string) =>
  c.json({ error: { code, message } }, status);

function requiredScope(method: string, path: string) {
  if (method === "GET" || method === "HEAD") {
    return "read" satisfies ApiScope;
  }
  if (
    method === "POST" &&
    (path === "/v1/activities" ||
      path === "/v1/logs" ||
      /^\/v1\/connections\/[^/]+\/events$/u.test(path))
  ) {
    return "ingest" satisfies ApiScope;
  }
  return "write" satisfies ApiScope;
}

const SESSION_ONLY = new Set(["GET /v1/agent-approval"]);

type Identity = { member: Member | null; user: SignedInUser | null };

async function identify(ctx: AppContext, c: Context<Env>, route: string) {
  const key = apiKeyOf(c);
  if (key && !SESSION_ONLY.has(route)) {
    const found = await authenticate(ctx, key);
    if (!found) {
      return deny(c, 401, "unauthorized", "Invalid or expired API key");
    }
    const needed = requiredScope(c.req.method, c.req.path);
    const ok =
      found.scopes.includes(needed) ||
      (needed === "ingest" && found.scopes.includes("write"));
    if (!ok) {
      return deny(
        c,
        403,
        "insufficient_scope",
        `This API key needs the "${needed}" scope`
      );
    }
    return { member: found.member, user: null } satisfies Identity;
  }

  const session = await ctx.auth.api.getSession({
    headers: key ? withoutKey(c.req.raw.headers) : c.req.raw.headers,
  });
  if (!session) {
    return deny(c, 401, "unauthorized", "Sign in, or send an API key");
  }
  const user: SignedInUser = session.user;
  const memberships = await listMemberships(ctx.db, { userId: user.id });
  const wanted =
    c.req.header("x-worklog-workspace") ?? c.req.query("workspace");
  const chosen = wanted
    ? memberships.find(
        (m) => m.workspace.id === wanted || m.workspace.slug === wanted
      )
    : memberships[0];
  if (wanted && !chosen) {
    return deny(c, 403, "forbidden", "You're not a member of that workspace");
  }
  return { member: chosen?.member ?? null, user } satisfies Identity;
}

function withoutKey(headers: Headers) {
  const rest = new Headers(headers);
  rest.delete("authorization");
  return rest;
}

function apiKeyOf(c: Context<Env>) {
  const header = c.req.header("authorization");
  const bearer =
    header !== undefined && header.toLowerCase().startsWith("bearer ")
      ? header.slice(7).trim()
      : undefined;
  if (bearer !== undefined && bearer.startsWith("wl_")) {
    return bearer;
  }
  return c.req.path === "/v1/events" ? c.req.query("token") : undefined;
}

const IDENTITY_ONLY = new Set([
  "GET /v1/session",
  "POST /v1/workspaces",
  "GET /v1/agent-approval",
]);
const PUBLIC = new Set(["POST /v1/setup", "GET /v1/auth/config"]);

export function authMiddleware(ctx: AppContext) {
  return createMiddleware<Env>(async (c, next: Next) => {
    const denied = await admit(ctx, c);
    if (denied) {
      c.res = denied;
    } else {
      await next();
    }
  });
}

async function admit(ctx: AppContext, c: Context<Env>) {
  const route = `${c.req.method} ${c.req.path}`;
  if (PUBLIC.has(route)) {
    return null;
  }
  const who = await identify(ctx, c, route);
  if (who instanceof Response) {
    return who;
  }
  c.set("user", who.user);
  if (who.member) {
    c.set("member", who.member);
  }
  if (!who.member && !IDENTITY_ONLY.has(route)) {
    return deny(
      c,
      403,
      "no_workspace",
      "You don't belong to a workspace yet: create one (POST /v1/workspaces) or ask to be invited"
    );
  }
  return null;
}
