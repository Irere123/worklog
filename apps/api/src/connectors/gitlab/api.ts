import { z } from "zod";

import { call } from "#connectors/http";
import type {
  ConnectionView,
  HookResult,
  HooksSpec,
  Source,
} from "#connectors/types";
import type { AppContext } from "#context";

const GITLAB_COM = "https://gitlab.com";

export function baseUrlOf(conn: ConnectionView) {
  const { baseUrl } = conn.settings;
  return (
    typeof baseUrl === "string" && baseUrl ? baseUrl : GITLAB_COM
  ).replace(/\/$/u, "");
}

export function hostOf(conn: ConnectionView) {
  try {
    return new URL(baseUrlOf(conn)).host;
  } catch {
    return conn.id;
  }
}

export const projectsOf = (conn: ConnectionView) =>
  Array.isArray(conn.settings.repos)
    ? conn.settings.repos.filter((r): r is string => typeof r === "string")
    : [];

export const projectPath = (path: string) =>
  `/projects/${encodeURIComponent(path)}`;

/** GitLab's REST API, as the connection's token: a personal, project or group access token. */
export async function gitlabRequest(
  ctx: AppContext,
  conn: ConnectionView,
  what: string,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<unknown> {
  const res = await call(
    ctx,
    `GitLab ${what}`,
    `${baseUrlOf(conn)}/api/v4${path}`,
    {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "PRIVATE-TOKEN": conn.secrets.token ?? "",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }
  );
  return await res.json();
}

const Hook = z.object({
  id: z.number(),
  url: z.string(),
  alert_status: z.string().nullish(),
});

const config = (hook: { url: string; secret: string }) => ({
  url: hook.url,
  token: hook.secret,
  push_events: true,
  merge_requests_events: true,
  note_events: true,
  issues_events: true,
  releases_events: true,
  tag_push_events: false,
  confidential_issues_events: false,
  confidential_note_events: false,
  pipeline_events: false,
  enable_ssl_verification: true,
});

async function ensureOne(
  ctx: AppContext,
  conn: ConnectionView,
  project: string,
  hook: { url: string; secret: string }
): Promise<HookResult> {
  const hooks = `${projectPath(project)}/hooks`;
  try {
    const existing = z
      .array(Hook)
      .parse(await gitlabRequest(ctx, conn, "hooks", hooks));
    const ours = existing.find((h) => h.url === hook.url);
    if (!ours) {
      await gitlabRequest(ctx, conn, "create hook", hooks, {
        method: "POST",
        body: config(hook),
      });
      return { target: project, state: "created" };
    }
    if (ours.alert_status && ours.alert_status !== "executable") {
      await gitlabRequest(ctx, conn, "repair hook", `${hooks}/${ours.id}`, {
        method: "PUT",
        body: config(hook),
      });
      return { target: project, state: "repaired" };
    }
    return { target: project, state: "ok" };
  } catch (error) {
    return {
      target: project,
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** One hook per chosen project, created where missing and turned back on where GitLab disabled it. */
export const gitlabHooks: HooksSpec = {
  available: (conn) => Boolean(conn.secrets.token),
  async ensure(ctx, conn, hook) {
    const results: HookResult[] = [];
    for (const project of projectsOf(conn)) {
      results.push(await ensureOne(ctx, conn, project, hook));
    }
    return results;
  },
};

const Project = z.object({
  path_with_namespace: z.string(),
  visibility: z.string().optional(),
});

const PER_PAGE = 100;
const MAX_PAGES = 10;

/**
 * The projects the token can add webhooks to (maintainer or owner): the ones a connection can
 * watch. Without a token, the projects its settings name.
 */
export async function listGitlabProjects(
  ctx: AppContext,
  conn: ConnectionView
): Promise<Source[]> {
  if (!conn.secrets.token) {
    return projectsOf(conn).map((name) => ({ id: name, name }));
  }
  const sources: Source[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = z
      .array(Project)
      .parse(
        await gitlabRequest(
          ctx,
          conn,
          "projects",
          `/projects?membership=true&min_access_level=40&simple=true&archived=false&order_by=path&sort=asc&per_page=${PER_PAGE}&page=${page}`
        )
      );
    sources.push(
      ...batch.map((p) => ({
        id: p.path_with_namespace,
        name: p.path_with_namespace,
        private: p.visibility !== "public",
      }))
    );
    if (batch.length < PER_PAGE) {
      break;
    }
  }
  return sources;
}
