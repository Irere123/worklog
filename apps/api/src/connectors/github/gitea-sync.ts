import { z } from "zod";

import { call, ProviderError } from "#connectors/http";
import type {
  ConnectionView,
  Normalized,
  SyncRead,
  SyncSpec,
} from "#connectors/types";
import type { AppContext } from "#context";

import { normalizeGithubLike } from "./events";
import type { Issue, Payload, User } from "./events";

const OVERLAP_MS = 5 * 60_000;
const LIMIT = 50;
const STAGES = ["issues", "comments", "releases", "pushes"] as const;
type Stage = (typeof STAGES)[number];

const GiteaUser = z.object({
  id: z.number().optional(),
  login: z.string(),
  full_name: z.string().optional(),
});

const GiteaIssue = z.object({
  number: z.number(),
  title: z.string(),
  html_url: z.string(),
  body: z.string().nullish(),
  user: GiteaUser,
  created_at: z.string(),
  updated_at: z.string(),
  closed_at: z.string().nullish(),
  pull_request: z
    .object({
      merged: z.boolean().optional(),
      merged_at: z.string().nullish(),
      draft: z.boolean().optional(),
    })
    .nullish(),
});

const GiteaComment = z.object({
  id: z.number(),
  body: z.string(),
  html_url: z.string(),
  user: GiteaUser,
  created_at: z.string(),
  issue_url: z.string().optional(),
});

const GiteaRelease = z.object({
  id: z.number(),
  tag_name: z.string(),
  name: z.string().nullish(),
  html_url: z.string(),
  body: z.string().nullish(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.string().nullish(),
  author: GiteaUser.nullish(),
});

const Repo = z.object({
  id: z.number(),
  default_branch: z.string().optional(),
});

const Cursor = z.object({
  next: z.string().optional(),
  run: z
    .object({
      since: z.string(),
      started: z.string(),
      stage: z.enum(STAGES),
      page: z.number(),
      repoId: z.number().optional(),
      defaultBranch: z.string().optional(),
    })
    .optional(),
});

const Page = z.object({
  repo: z.object({
    full_name: z.string(),
    default_branch: z.string().optional(),
  }),
  since: z.string(),
  stage: z.enum(STAGES),
  items: z.array(z.unknown()),
  titles: z
    .record(z.string(), z.object({ title: z.string(), pr: z.boolean() }))
    .optional(),
});

const userOf = (u: z.infer<typeof GiteaUser>): User => ({
  login: u.login,
  id: u.id ?? null,
  name: u.full_name === "" ? undefined : u.full_name,
});

const REPO_STREAM = /^repo:(?<name>[^/\s]+\/[^/\s]+)$/u;

function api(conn: ConnectionView) {
  const { baseUrl } = conn.settings;
  return typeof baseUrl === "string"
    ? `${baseUrl.replace(/\/$/u, "")}/api/v1`
    : null;
}

async function get(
  ctx: AppContext,
  conn: ConnectionView,
  what: string,
  path: string
): Promise<unknown> {
  const res = await call(ctx, `Gitea ${what}`, `${api(conn)}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `token ${conn.secrets.token}`,
    },
  });
  return await res.json();
}

const PATHS: Record<
  Stage,
  (repo: string, since: string, page: number) => string
> = {
  issues: (repo, since, page) =>
    `/repos/${repo}/issues?state=all&since=${encodeURIComponent(since)}&limit=${LIMIT}&page=${page}`,
  comments: (repo, since, page) =>
    `/repos/${repo}/issues/comments?since=${encodeURIComponent(since)}&limit=${LIMIT}&page=${page}`,
  releases: (repo, _since, page) =>
    `/repos/${repo}/releases?limit=${LIMIT}&page=${page}`,
  pushes: (repo, _since, page) =>
    `/repos/${repo}/activities/feeds?limit=${LIMIT}&page=${page}`,
};

async function readRepo(
  ctx: AppContext,
  conn: ConnectionView,
  repo: string,
  raw: Record<string, unknown>,
  window: { since: Date }
): Promise<SyncRead> {
  const cursor = Cursor.parse(raw);
  const run = cursor.run ?? {
    since: cursor.next ?? window.since.toISOString(),
    started: ctx.now().toISOString(),
    stage: "issues" as Stage,
    page: 1,
    ...(await repoOf(ctx, conn, repo)),
  };
  const items = await readItems(ctx, conn, repo, run);
  const titles =
    run.stage === "comments"
      ? await titlesFor(ctx, conn, repo, items)
      : undefined;
  const page = {
    eventType: "sync.gitea",
    partition: run.repoId === undefined ? repo : String(run.repoId),
    payload: {
      repo: { full_name: repo, default_branch: run.defaultBranch },
      since: run.since,
      stage: run.stage,
      items,
      titles,
    },
  };
  const more =
    run.stage === "pushes"
      ? items.length === LIMIT && !reachesBack(items, run.since)
      : items.length === LIMIT && run.stage !== "releases";
  if (more) {
    return {
      page,
      cursor: { ...cursor, run: { ...run, page: run.page + 1 } },
      done: false,
    };
  }
  const nextStage = STAGES[STAGES.indexOf(run.stage) + 1];
  if (nextStage) {
    return {
      page,
      cursor: { ...cursor, run: { ...run, stage: nextStage, page: 1 } },
      done: false,
    };
  }
  const next = new Date(
    new Date(run.started).getTime() - OVERLAP_MS
  ).toISOString();
  return { page, cursor: { next }, done: true };
}

const FeedItem = z.object({
  op_type: z.string(),
  ref_name: z.string().optional(),
  created: z.string(),
  content: z.string().optional(),
  act_user: GiteaUser.nullish(),
});

const PushContent = z.object({
  Commits: z
    .array(z.object({ Sha1: z.string(), Message: z.string() }))
    .optional(),
  HeadCommit: z.object({ Sha1: z.string() }).nullish(),
  Len: z.number().optional(),
});

async function repoOf(ctx: AppContext, conn: ConnectionView, repo: string) {
  const info = Repo.parse(await get(ctx, conn, "repository", `/repos/${repo}`));
  return { repoId: info.id, defaultBranch: info.default_branch };
}

async function readItems(
  ctx: AppContext,
  conn: ConnectionView,
  repo: string,
  run: NonNullable<z.infer<typeof Cursor>["run"]>
) {
  try {
    return z
      .array(z.unknown())
      .parse(
        await get(
          ctx,
          conn,
          run.stage,
          PATHS[run.stage](repo, run.since, run.page)
        )
      );
  } catch (error) {
    if (
      run.stage === "pushes" &&
      error instanceof ProviderError &&
      / 404 /u.test(error.message)
    ) {
      return [];
    }
    throw error;
  }
}

function reachesBack(items: unknown[], since: string) {
  const from = Date.parse(since);
  return items.some((item) => {
    const parsed = FeedItem.safeParse(item);
    return parsed.success && Date.parse(parsed.data.created) < from;
  });
}

const issueNumber = (url: string | undefined) => {
  const n = /\/(?:issues|pulls)\/(?<n>\d+)$/u.exec(url ?? "")?.groups?.n;
  return n === undefined ? null : Number(n);
};

async function titlesFor(
  ctx: AppContext,
  conn: ConnectionView,
  repo: string,
  items: unknown[]
) {
  const numbers = new Set<number>();
  for (const item of items) {
    const parsed = GiteaComment.safeParse(item);
    const n = parsed.success ? issueNumber(parsed.data.issue_url) : null;
    if (n !== null) {
      numbers.add(n);
    }
  }
  const titles: Record<string, { title: string; pr: boolean }> = {};
  for (const n of numbers) {
    const issue = GiteaIssue.safeParse(
      await get(ctx, conn, "issue", `/repos/${repo}/issues/${n}`)
    );
    if (issue.success) {
      titles[String(n)] = {
        title: issue.data.title,
        pr: Boolean(issue.data.pull_request),
      };
    }
  }
  return titles;
}

function issueDeliveries(raw: unknown): { type: string; payload: Payload }[] {
  const parsed = GiteaIssue.safeParse(raw);
  if (!parsed.success) {
    return [];
  }
  const i = parsed.data;
  const user = userOf(i.user);
  const item: Issue = {
    number: i.number,
    title: i.title,
    html_url: i.html_url,
    body: i.body ?? null,
    user,
    created_at: i.created_at,
    updated_at: i.created_at,
  };
  if (i.pull_request) {
    const pr = { ...item, draft: i.pull_request.draft === true };
    return [
      ...(pr.draft
        ? []
        : [
            {
              type: "pull_request",
              payload: { action: "opened", pull_request: pr, sender: user },
            },
          ]),
      ...(i.closed_at
        ? [
            {
              type: "pull_request",
              payload: {
                action: "closed",
                pull_request: {
                  ...pr,
                  merged: i.pull_request.merged === true,
                  closed_at: i.closed_at,
                  merged_at: i.pull_request.merged_at ?? null,
                },
              },
            },
          ]
        : []),
    ];
  }
  return [
    {
      type: "issues",
      payload: { action: "opened", issue: item, sender: user },
    },
    ...(i.closed_at
      ? [
          {
            type: "issues",
            payload: {
              action: "closed",
              issue: {
                ...item,
                closed_at: i.closed_at,
                updated_at: i.closed_at,
              },
            },
          },
        ]
      : []),
  ];
}

function commentDelivery(
  raw: unknown,
  titles: Record<string, { title: string; pr: boolean }>
) {
  const parsed = GiteaComment.safeParse(raw);
  const n = parsed.success ? issueNumber(parsed.data.issue_url) : null;
  if (!parsed.success || n === null) {
    return [];
  }
  const c = parsed.data;
  const known = titles[String(n)] ?? { title: `#${n}`, pr: false };
  const user = userOf(c.user);
  return [
    {
      type: "issue_comment",
      payload: {
        action: "created",
        comment: {
          id: c.id,
          body: c.body,
          html_url: c.html_url,
          user,
          created_at: c.created_at,
        },
        issue: {
          number: n,
          title: known.title,
          html_url: c.html_url.split("#")[0] ?? c.html_url,
          user,
          ...(known.pr ? { pull_request: {} } : {}),
        },
        sender: user,
      } satisfies Payload,
    },
  ];
}

function pushDelivery(raw: unknown) {
  const item = FeedItem.safeParse(raw);
  if (
    !item.success ||
    item.data.op_type !== "commit_repo" ||
    !item.data.content
  ) {
    return [];
  }
  let content: unknown;
  try {
    content = JSON.parse(item.data.content);
  } catch {
    return [];
  }
  const push = PushContent.safeParse(content);
  const commits = push.success ? (push.data.Commits ?? []) : [];
  const after = push.success
    ? (push.data.HeadCommit?.Sha1 ?? commits[0]?.Sha1)
    : undefined;
  const ref = item.data.ref_name ?? "";
  if (!after || commits.length === 0) {
    return [];
  }
  return [
    {
      type: "push",
      payload: {
        ref: ref.startsWith("refs/") ? ref : `refs/heads/${ref}`,
        after,
        sender: item.data.act_user ? userOf(item.data.act_user) : undefined,
        commits: commits.map((c) => ({
          id: c.Sha1,
          message: c.Message,
          distinct: true,
        })),
        total_commits: push.success
          ? (push.data.Len ?? commits.length)
          : commits.length,
        head_commit: { timestamp: item.data.created },
      } satisfies Payload,
    },
  ];
}

function releaseDelivery(raw: unknown) {
  const parsed = GiteaRelease.safeParse(raw);
  if (!parsed.success) {
    return [];
  }
  const r = parsed.data;
  return [
    {
      type: "release",
      payload: {
        action: "published",
        release: {
          id: r.id,
          tag_name: r.tag_name,
          name: r.name ?? null,
          html_url: r.html_url,
          body: r.body ?? null,
          draft: r.draft,
          prerelease: r.prerelease,
          published_at: r.published_at ?? null,
        },
        sender: r.author ? userOf(r.author) : undefined,
      } satisfies Payload,
    },
  ];
}

/** Pure: the page holds Gitea's answer, mapped like the webhooks it would have sent. */
export function normalizeGiteaPage(
  ns: string,
  payload: unknown,
  receivedAt: Date,
  settings: Record<string, unknown>
): Normalized {
  const page = Page.safeParse(payload);
  if (!page.success) {
    return { events: [], ignored: "malformed sync page" };
  }
  const { repo, since, stage, items, titles } = page.data;
  const deliveries = items.flatMap((item) => {
    if (stage === "issues") {
      return issueDeliveries(item);
    }
    if (stage === "pushes") {
      return pushDelivery(item);
    }
    return stage === "comments"
      ? commentDelivery(item, titles ?? {})
      : releaseDelivery(item);
  });
  const from = new Date(since);
  const normalized = deliveries.map(
    (d) =>
      normalizeGithubLike(
        ns,
        d.type,
        { ...d.payload, repository: repo },
        receivedAt,
        settings
      ).events
  );
  const events = normalized.flat().filter((e) => e.occurredAt >= from);
  return {
    events,
    ignored:
      events.length === 0
        ? `nothing new in ${repo.full_name} ${stage}`
        : undefined,
    skipped: normalized.filter((e) => e.length === 0).length,
  };
}

const reposOf = (conn: ConnectionView) =>
  Array.isArray(conn.settings.repos)
    ? conn.settings.repos.filter((r): r is string => typeof r === "string")
    : [];

export const giteaSync: SyncSpec = {
  available: (conn) => Boolean(conn.secrets.token && api(conn)),
  streams: async (_ctx, conn) =>
    await Promise.resolve(reposOf(conn).map((r) => `repo:${r}`)),
  async read(ctx, conn, _app, stream, cursor, window) {
    const repo = REPO_STREAM.exec(stream)?.groups?.name;
    if (!repo) {
      return { page: null, cursor: {}, done: true };
    }
    return await readRepo(ctx, conn, repo, cursor, window);
  },
};
