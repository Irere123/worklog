import { z } from "zod";

import { call } from "#connectors/http";
import type { ConnectionView, HookResult, HooksSpec } from "#connectors/types";
import type { AppContext } from "#context";

const EVENTS = [
  "push",
  "issues",
  "issue_assign",
  "issue_comment",
  "pull_request",
  "pull_request_assign",
  "pull_request_comment",
  "pull_request_review_approved",
  "pull_request_review_rejected",
  "pull_request_review_comment",
  "pull_request_review_request",
  "release",
];

const Hook = z.object({
  id: z.number(),
  active: z.boolean().optional(),
  config: z.object({ url: z.string().optional() }).partial().optional(),
});

const reposOf = (conn: ConnectionView) =>
  Array.isArray(conn.settings.repos)
    ? conn.settings.repos.filter((r): r is string => typeof r === "string")
    : [];

const apiOf = (conn: ConnectionView) => {
  const { baseUrl } = conn.settings;
  return typeof baseUrl === "string"
    ? `${baseUrl.replace(/\/$/u, "")}/api/v1`
    : null;
};

async function request(
  ctx: AppContext,
  conn: ConnectionView,
  what: string,
  path: string,
  init: { method?: string; body?: unknown } = {}
) {
  const res = await call(ctx, `Gitea ${what}`, `${apiOf(conn)}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `token ${conn.secrets.token}`,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body: unknown = await res.json();
  return body;
}

const config = (hook: { url: string; secret: string }) => ({
  type: "gitea",
  active: true,
  events: EVENTS,
  branch_filter: "*",
  config: { url: hook.url, content_type: "json", secret: hook.secret },
});

async function ensureOne(
  ctx: AppContext,
  conn: ConnectionView,
  repo: string,
  hook: { url: string; secret: string }
): Promise<HookResult> {
  try {
    const hooks = z
      .array(Hook)
      .parse(await request(ctx, conn, "hooks", `/repos/${repo}/hooks`));
    const ours = hooks.find((h) => h.config?.url === hook.url);
    if (!ours) {
      await request(ctx, conn, "create hook", `/repos/${repo}/hooks`, {
        method: "POST",
        body: config(hook),
      });
      return { target: repo, state: "created" };
    }
    if (ours.active === false) {
      await request(
        ctx,
        conn,
        "repair hook",
        `/repos/${repo}/hooks/${ours.id}`,
        {
          method: "PATCH",
          body: config(hook),
        }
      );
      return { target: repo, state: "repaired" };
    }
    return { target: repo, state: "ok" };
  } catch (error) {
    return {
      target: repo,
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** One hook per chosen repo, created where missing and turned back on where disabled. */
export const giteaHooks: HooksSpec = {
  available: (conn) => Boolean(conn.secrets.token && apiOf(conn)),
  async ensure(ctx, conn, hook) {
    const results: HookResult[] = [];
    for (const repo of reposOf(conn)) {
      results.push(await ensureOne(ctx, conn, repo, hook));
    }
    return results;
  },
};
