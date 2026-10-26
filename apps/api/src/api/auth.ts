import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppContext } from "../context";
import type { ApiScope } from "../db/schema";
import { authenticate, membershipsOf, type Member, type SignedInUser } from "../members/service";
import type { Env } from "./router";

const deny = (c: Context, status: 401 | 403, code: string, message: string) => c.json({ error: { code, message } }, status);

/** Which key scope a request needs: reads, reporting work, or everything else. */
function requiredScope(method: string, path: string): ApiScope {
  if (method === "GET" || method === "HEAD") return "read";
  if (method === "POST" && (path === "/v1/activities" || path === "/v1/logs" || /^\/v1\/connections\/[^/]+\/events$/.test(path))) return "ingest";
  return "write";
}

/**
 * One front door for every client:
 *  - `Authorization: Bearer wl_…` → an API key (agents, bots, scripts, integrations), acting as one member;
 *  - a Better Auth session — cookie (web) or `Authorization: Bearer <session token>` (mobile) — acting as
 *    the signed-in person in the workspace chosen by `x-worklog-workspace` (or `?workspace=`), defaulting
 *    to their first workspace.
 */
async function identify(ctx: AppContext, c: Context<Env>) {
  const header = c.req.header("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined;
  // EventSource can't send headers, so the stream alone accepts ?token=.
  const key = bearer?.startsWith("wl_") ? bearer : c.req.path === "/v1/events" ? c.req.query("token") : undefined;
  if (key) {
    const found = await authenticate(ctx, key);
    if (!found) return { error: deny(c, 401, "unauthorized", "Invalid or expired API key") };
    const needed = requiredScope(c.req.method, c.req.path);
    const ok = found.scopes.includes(needed) || (needed === "ingest" && found.scopes.includes("write"));
    if (!ok) return { error: deny(c, 403, "insufficient_scope", `This API key needs the "${needed}" scope`) };
    return { member: found.member, user: null };
  }

  const session = await ctx.auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return { error: deny(c, 401, "unauthorized", "Sign in, or send an API key") };
  const user: SignedInUser = session.user;
  const memberships = await membershipsOf(ctx, user.id);
  const wanted = c.req.header("x-worklog-workspace") ?? c.req.query("workspace");
  const chosen = wanted ? memberships.find((m) => m.workspace.id === wanted || m.workspace.slug === wanted) : memberships[0];
  if (wanted && !chosen) return { error: deny(c, 403, "forbidden", "You're not a member of that workspace") };
  return { member: chosen?.member ?? null, user };
}

/** Routes that work before you belong to a workspace (see your session, create one). */
const IDENTITY_ONLY = new Set(["GET /v1/session", "POST /v1/workspaces"]);
const PUBLIC = new Set(["POST /v1/setup", "GET /v1/auth/config"]);

export function authMiddleware(ctx: AppContext) {
  return createMiddleware<Env>(async (c, next: Next) => {
    const route = `${c.req.method} ${c.req.path}`;
    if (PUBLIC.has(route)) return next();
    const who = await identify(ctx, c);
    if ("error" in who && who.error) return who.error;
    const { member, user } = who as { member: Member | null; user: SignedInUser | null };
    c.set("user", user);
    if (member) c.set("member", member);
    if (!member && !IDENTITY_ONLY.has(route)) {
      return deny(c, 403, "no_workspace", "You don't belong to a workspace yet: create one (POST /v1/workspaces) or ask to be invited");
    }
    await next();
  });
}
