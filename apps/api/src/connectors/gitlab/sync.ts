import { z } from "zod";

import type {
  ConnectionView,
  Normalized,
  SyncRead,
  SyncSpec,
} from "#connectors/types";
import type { AppContext } from "#context";

import { gitlabRequest, projectPath, projectsOf } from "./api";
import { gitlabTime, normalizeGitlab } from "./events";
import type { GitlabInput } from "./events";

const OVERLAP_MS = 5 * 60_000;
const PER_PAGE = 100;
const DAY_MS = 86_400_000;
const STAGES = ["merge_requests", "issues", "releases", "pushes"] as const;
type Stage = (typeof STAGES)[number];

const User = z.object({
  id: z.number().optional(),
  username: z.string(),
  name: z.string().optional(),
});

const MergeRequest = z.object({
  iid: z.number(),
  title: z.string(),
  description: z.string().nullish(),
  web_url: z.string(),
  state: z.string(),
  draft: z.boolean().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  merged_at: z.string().nullish(),
  closed_at: z.string().nullish(),
  author: User,
  merged_by: User.nullish(),
  closed_by: User.nullish(),
  reviewers: z.array(User).optional(),
});

const Issue = z.object({
  iid: z.number(),
  title: z.string(),
  description: z.string().nullish(),
  web_url: z.string(),
  confidential: z.boolean().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  closed_at: z.string().nullish(),
  author: User,
  closed_by: User.nullish(),
});

const Release = z.object({
  tag_name: z.string(),
  name: z.string().nullish(),
  description: z.string().nullish(),
  created_at: z.string().nullish(),
  released_at: z.string().nullish(),
  upcoming_release: z.boolean().optional(),
  author: User.nullish(),
  _links: z.object({ self: z.string().optional() }).optional(),
});

const PushEvent = z.object({
  created_at: z.string(),
  author: User.nullish(),
  push_data: z.object({
    commit_count: z.number(),
    action: z.string(),
    ref_type: z.string(),
    commit_from: z.string().nullish(),
    commit_to: z.string().nullish(),
    ref: z.string(),
    commit_title: z.string().nullish(),
  }),
});

const ProjectInfo = z.object({
  id: z.number(),
  path_with_namespace: z.string(),
  web_url: z.string().optional(),
  default_branch: z.string().nullish(),
});

const Cursor = z.object({
  next: z.string().optional(),
  run: z
    .object({
      since: z.string(),
      started: z.string(),
      stage: z.enum(STAGES),
      page: z.number(),
      projectId: z.number().optional(),
      webUrl: z.string().optional(),
      defaultBranch: z.string().optional(),
    })
    .optional(),
});

const Page = z.object({
  project: z.object({
    id: z.number().optional(),
    path_with_namespace: z.string(),
    web_url: z.string().optional(),
    default_branch: z.string().optional(),
  }),
  since: z.string(),
  stage: z.enum(STAGES),
  items: z.array(z.unknown()),
});

const REPO_STREAM = /^repo:(?<path>\S+\/\S+)$/u;

const PATHS: Record<Stage, (since: string, page: number) => string> = {
  merge_requests: (since, page) =>
    `/merge_requests?state=all&updated_after=${encodeURIComponent(since)}&order_by=updated_at&sort=asc&per_page=${PER_PAGE}&page=${page}`,
  issues: (since, page) =>
    `/issues?scope=all&updated_after=${encodeURIComponent(since)}&order_by=updated_at&sort=asc&per_page=${PER_PAGE}&page=${page}`,
  releases: (_since, page) => `/releases?per_page=${PER_PAGE}&page=${page}`,
  pushes: (since, page) =>
    `/events?action=pushed&after=${new Date(Date.parse(since) - DAY_MS).toISOString().slice(0, 10)}&sort=asc&per_page=${PER_PAGE}&page=${page}`,
};

async function readProject(
  ctx: AppContext,
  conn: ConnectionView,
  path: string,
  raw: Record<string, unknown>,
  window: { since: Date }
) {
  const cursor = Cursor.parse(raw);
  const run = cursor.run ?? {
    since: cursor.next ?? window.since.toISOString(),
    started: ctx.now().toISOString(),
    stage: "merge_requests" as Stage,
    page: 1,
    ...(await projectOf(ctx, conn, path)),
  };
  const items = z
    .array(z.unknown())
    .parse(
      await gitlabRequest(
        ctx,
        conn,
        run.stage.replace("_", " "),
        `${projectPath(path)}${PATHS[run.stage](run.since, run.page)}`
      )
    );
  const page = {
    eventType: "sync.gitlab",
    partition: run.projectId === undefined ? path : String(run.projectId),
    payload: {
      project: {
        id: run.projectId,
        path_with_namespace: path,
        web_url: run.webUrl,
        default_branch: run.defaultBranch,
      },
      since: run.since,
      stage: run.stage,
      items,
    },
  };
  if (items.length === PER_PAGE && run.stage !== "releases") {
    return {
      page,
      cursor: { ...cursor, run: { ...run, page: run.page + 1 } },
      done: false,
    } satisfies SyncRead;
  }
  const nextStage = STAGES[STAGES.indexOf(run.stage) + 1];
  if (nextStage) {
    return {
      page,
      cursor: { ...cursor, run: { ...run, stage: nextStage, page: 1 } },
      done: false,
    } satisfies SyncRead;
  }
  const next = new Date(
    new Date(run.started).getTime() - OVERLAP_MS
  ).toISOString();
  return { page, cursor: { next }, done: true } satisfies SyncRead;
}

async function projectOf(ctx: AppContext, conn: ConnectionView, path: string) {
  const info = ProjectInfo.parse(
    await gitlabRequest(ctx, conn, "project", projectPath(path))
  );
  return {
    projectId: info.id,
    webUrl: info.web_url,
    defaultBranch: info.default_branch ?? undefined,
  };
}

type Delivery = { type: string; payload: GitlabInput };

function mergeRequestDeliveries(raw: unknown) {
  const parsed = MergeRequest.safeParse(raw);
  if (!parsed.success) {
    return [];
  }
  const mr = parsed.data;
  const attributes = {
    iid: mr.iid,
    title: mr.title,
    description: mr.description ?? undefined,
    url: mr.web_url,
    state: mr.state,
    draft: mr.draft === true,
    created_at: mr.created_at,
    updated_at: mr.created_at,
  };
  const deliveries: Delivery[] = [
    {
      type: "merge_request",
      payload: {
        user: mr.author,
        reviewers: mr.reviewers ?? [],
        object_attributes: { ...attributes, action: "open" },
      },
    },
  ];
  if (mr.merged_at) {
    deliveries.push({
      type: "merge_request",
      payload: {
        user: mr.merged_by ?? mr.author,
        object_attributes: {
          ...attributes,
          draft: false,
          action: "merge",
          updated_at: mr.merged_at,
        },
      },
    });
  } else if (mr.state === "closed" && mr.closed_at) {
    deliveries.push({
      type: "merge_request",
      payload: {
        user: mr.closed_by ?? mr.author,
        object_attributes: {
          ...attributes,
          draft: false,
          action: "close",
          updated_at: mr.closed_at,
        },
      },
    });
  }
  return deliveries;
}

function issueDeliveries(raw: unknown) {
  const parsed = Issue.safeParse(raw);
  if (!parsed.success || parsed.data.confidential === true) {
    return [];
  }
  const i = parsed.data;
  const attributes = {
    iid: i.iid,
    title: i.title,
    description: i.description ?? undefined,
    url: i.web_url,
    created_at: i.created_at,
    updated_at: i.created_at,
  };
  const deliveries: Delivery[] = [
    {
      type: "issue",
      payload: {
        user: i.author,
        object_attributes: { ...attributes, action: "open" },
      },
    },
    ...(i.closed_at
      ? [
          {
            type: "issue",
            payload: {
              user: i.closed_by ?? i.author,
              object_attributes: {
                ...attributes,
                action: "close",
                closed_at: i.closed_at,
                updated_at: i.closed_at,
              },
            },
          },
        ]
      : []),
  ];
  return deliveries;
}

function releaseDelivery(raw: unknown) {
  const parsed = Release.safeParse(raw);
  if (!parsed.success || parsed.data.upcoming_release === true) {
    return [];
  }
  const r = parsed.data;
  return [
    {
      type: "release",
      payload: {
        action: "create",
        tag: r.tag_name,
        name: r.name ?? undefined,
        description: r.description ?? undefined,
        url: r._links?.self,
        released_at: r.released_at ?? undefined,
        created_at: r.created_at ?? undefined,
        user: r.author ?? undefined,
      },
    } satisfies Delivery,
  ];
}

function pushDelivery(raw: unknown) {
  const parsed = PushEvent.safeParse(raw);
  if (!parsed.success) {
    return [];
  }
  const { push_data: push, author, created_at: at } = parsed.data;
  if (
    push.ref_type !== "branch" ||
    push.action === "removed" ||
    !push.commit_to
  ) {
    return [];
  }
  return [
    {
      type: "push",
      payload: {
        ref: `refs/heads/${push.ref}`,
        before: push.commit_from ?? undefined,
        after: push.commit_to,
        user: author ?? undefined,
        total_commits_count: push.commit_count,
        commits: [
          {
            id: push.commit_to,
            message: push.commit_title ?? "",
            timestamp: at,
          },
        ],
      },
    } satisfies Delivery,
  ];
}

const DELIVERIES: Record<Stage, (raw: unknown) => Delivery[]> = {
  merge_requests: mergeRequestDeliveries,
  issues: issueDeliveries,
  releases: releaseDelivery,
  pushes: pushDelivery,
};

/** Pure: the page holds GitLab's answer, mapped like the webhooks it would have sent. */
export function normalizeGitlabPage(
  ns: string,
  payload: unknown,
  receivedAt: Date,
  settings: Record<string, unknown>
) {
  const page = Page.safeParse(payload);
  if (!page.success) {
    return { events: [], ignored: "malformed sync page" } satisfies Normalized;
  }
  const { project, since, stage, items } = page.data;
  const from = gitlabTime(since) ?? new Date(0);
  const normalized = items
    .flatMap((item) => DELIVERIES[stage](item))
    .map(
      (d) =>
        normalizeGitlab(
          ns,
          d.type,
          { ...d.payload, project },
          receivedAt,
          settings
        ).events
    );
  const events = normalized.flat().filter((e) => e.occurredAt >= from);
  return {
    events,
    ignored:
      events.length === 0
        ? `nothing new in ${project.path_with_namespace} ${stage}`
        : undefined,
    skipped: normalized.filter((e) => e.length === 0).length,
  } satisfies Normalized;
}

export const gitlabSync: SyncSpec = {
  available: (conn) => Boolean(conn.secrets.token),
  streams: async (_ctx, conn) =>
    await Promise.resolve(projectsOf(conn).map((p) => `repo:${p}`)),
  async read(ctx, conn, _app, stream, cursor, window) {
    const path = REPO_STREAM.exec(stream)?.groups?.path;
    if (!path) {
      return { page: null, cursor: {}, done: true };
    }
    return await readProject(ctx, conn, path, cursor, window);
  },
};
