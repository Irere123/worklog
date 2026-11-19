import { z } from "zod";

import { call, ProviderError } from "#connectors/http";
import type {
  ConnectionView,
  Normalized,
  SyncRead,
  WorklogEvent,
} from "#connectors/types";
import type { AppContext } from "#context";

import { githubCall, headers, withToken } from "./app";
import type { GithubAuth } from "./app";
import { actorFor, normalizeGithubLike } from "./events";
import type { Issue, Payload, User } from "./events";

const OVERLAP_MS = 5 * 60_000;
const STAGES = ["pulls", "issues", "releases", "pushes"] as const;
type Stage = (typeof STAGES)[number];
type GraphStage = Exclude<Stage, "pushes">;

const PUSHES_PER_PAGE = 25;
const MAX_PUSHES = 100;
const NO_COMMIT = /^0+$/u;

const Actor = z
  .object({
    __typename: z.string().optional(),
    login: z.string(),
    databaseId: z.number().nullish(),
    name: z.string().nullish(),
  })
  .nullish();
type GqlActor = z.infer<typeof Actor>;

const Comment = z.object({
  databaseId: z.number(),
  body: z.string(),
  url: z.string(),
  createdAt: z.string(),
  author: Actor,
});

const Closer = z.object({
  nodes: z.array(z.object({ actor: Actor }).partial()),
});

export const PullNode = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  body: z.string().nullish(),
  isDraft: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  closedAt: z.string().nullish(),
  mergedAt: z.string().nullish(),
  author: Actor,
  mergedBy: Actor,
  reviewRequests: z.object({
    nodes: z.array(
      z.object({
        requestedReviewer: z
          .looseObject({ login: z.string().optional() })
          .nullish(),
      })
    ),
  }),
  reviews: z.object({
    nodes: z.array(
      z.object({
        databaseId: z.number(),
        state: z.string(),
        body: z.string().nullish(),
        url: z.string(),
        submittedAt: z.string().nullish(),
        author: Actor,
        /** Its inline comments on lines of the diff. */
        comments: z.object({ nodes: z.array(Comment) }).optional(),
      })
    ),
  }),
  comments: z.object({ nodes: z.array(Comment) }),
  timelineItems: Closer,
});

export const IssueNode = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  body: z.string().nullish(),
  createdAt: z.string(),
  updatedAt: z.string(),
  closedAt: z.string().nullish(),
  author: Actor,
  comments: z.object({ nodes: z.array(Comment) }),
  timelineItems: Closer,
});

export const PushNode = z.object({
  before: z.string(),
  after: z.string(),
  ref: z.string(),
  timestamp: z.string(),
  actor: z
    .object({ login: z.string(), id: z.number(), type: z.string().optional() })
    .nullish(),
  total_commits: z.number(),
  commits: z.array(z.object({ id: z.string(), message: z.string() })),
});

export const ReleaseNode = z.object({
  databaseId: z.number(),
  tagName: z.string(),
  name: z.string().nullish(),
  url: z.string(),
  description: z.string().nullish(),
  isDraft: z.boolean(),
  isPrerelease: z.boolean(),
  publishedAt: z.string().nullish(),
  author: Actor,
});

const SyncPayload = z.object({
  repo: z.object({
    id: z.number(),
    full_name: z.string(),
    default_branch: z.string().optional(),
  }),
  since: z.string(),
  stage: z.enum(STAGES),
  nodes: z.array(z.unknown()),
});

const USER = `__typename login databaseId name`;
const ACTOR = `__typename login ... on User { databaseId name } ... on Bot { databaseId }`;
const COMMENTS = `comments(last: 30) { nodes { databaseId body url createdAt author { ${ACTOR} } } }`;
const CLOSER = `timelineItems(last: 1, itemTypes: [CLOSED_EVENT]) { nodes { ... on ClosedEvent { actor { ${ACTOR} } } } }`;

const QUERIES: Record<GraphStage, string> = {
  pulls: `query($owner: String!, $name: String!, $after: String) {
    repository(owner: $owner, name: $name) {
      databaseId
      items: pullRequests(first: 20, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number title url body isDraft createdAt updatedAt closedAt mergedAt
          author { ${ACTOR} } mergedBy { ${ACTOR} }
          reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { ${USER} } } } }
          reviews(last: 30) { nodes { databaseId state body url submittedAt author { ${ACTOR} }
            comments(first: 20) { nodes { databaseId body url createdAt author { ${ACTOR} } } } } }
          ${COMMENTS}
          ${CLOSER}
        }
      }
    }
  }`,
  issues: `query($owner: String!, $name: String!, $after: String, $since: DateTime) {
    repository(owner: $owner, name: $name) {
      databaseId
      items: issues(first: 30, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }, filterBy: { since: $since }) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number title url body createdAt updatedAt closedAt
          author { ${ACTOR} }
          ${COMMENTS}
          ${CLOSER}
        }
      }
    }
  }`,
  releases: `query($owner: String!, $name: String!, $after: String) {
    repository(owner: $owner, name: $name) {
      databaseId
      items: releases(first: 20, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
        pageInfo { hasNextPage endCursor }
        nodes { databaseId tagName name url description isDraft isPrerelease publishedAt author { ${USER} } }
      }
    }
  }`,
};

const Response = z.object({
  data: z
    .object({
      repository: z
        .object({
          databaseId: z.number(),
          items: z.object({
            pageInfo: z.object({
              hasNextPage: z.boolean(),
              endCursor: z.string().nullish(),
            }),
            nodes: z.array(z.looseObject({ updatedAt: z.string().optional() })),
          }),
        })
        .nullable(),
    })
    .nullish(),
  errors: z
    .array(z.object({ type: z.string().optional(), message: z.string() }))
    .optional(),
});

const Cursor = z.object({
  next: z.string().optional(),
  run: z
    .object({
      since: z.string(),
      started: z.string(),
      stage: z.enum(STAGES),
      after: z.string().nullish(),
      repoId: z.number().optional(),
      offset: z.number().optional(),
    })
    .optional(),
});

const graphqlUrl = (api: string) =>
  api.endsWith("/api/v3") ? `${api.slice(0, -3)}graphql` : `${api}/graphql`;

async function query(
  ctx: AppContext,
  auth: GithubAuth,
  stage: GraphStage,
  variables: Record<string, unknown>
) {
  const res = await withToken(
    auth,
    async (token) =>
      await call(ctx, `GitHub ${stage}`, graphqlUrl(auth.api), {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({ query: QUERIES[stage], variables }),
      })
  );
  const body = Response.parse(await res.json());
  const [error] = body.errors ?? [];
  if (error) {
    const limited = error.type === "RATE_LIMITED";
    throw new ProviderError(
      `GitHub ${stage}: ${error.message}`,
      limited ? "rate_limited" : "failed",
      limited ? new Date(ctx.now().getTime() + 60_000) : null
    );
  }
  const repository = body.data?.repository;
  if (!repository) {
    throw new ProviderError(`GitHub ${stage}: repository not found`, "failed");
  }
  return repository;
}

/**
 * One stream per repository, read newest first in three stages. A run reads back to where the
 * last one started (or the backfill window), so whatever webhooks missed in between comes in.
 */
export async function readRepo(
  ctx: AppContext,
  auth: GithubAuth,
  fullName: string,
  raw: Record<string, unknown>,
  window: { since: Date }
) {
  const cursor = Cursor.parse(raw);
  const run = cursor.run ?? {
    since: cursor.next ?? window.since.toISOString(),
    started: ctx.now().toISOString(),
    stage: "pulls" as Stage,
    after: null,
  };
  if (run.stage === "pushes") {
    return await readPushes(ctx, auth, fullName, run);
  }
  const [owner = "", name = ""] = fullName.split("/");
  const repo = await query(ctx, auth, run.stage, {
    owner,
    name,
    after: run.after ?? null,
    ...(run.stage === "issues" ? { since: run.since } : {}),
  });
  const { nodes, pageInfo } = repo.items;
  const since = Date.parse(run.since);
  const fresh = nodes.filter(
    (n) => !n.updatedAt || Date.parse(n.updatedAt) >= since
  );
  const exhausted =
    !pageInfo.hasNextPage ||
    fresh.length < nodes.length ||
    run.stage === "releases";
  const page = {
    eventType: "sync.github",
    partition: String(repo.databaseId),
    payload: {
      repo: { id: repo.databaseId, full_name: fullName },
      since: run.since,
      stage: run.stage,
      nodes: fresh,
    },
  };
  const known = { ...run, repoId: repo.databaseId };
  if (!exhausted) {
    return {
      page,
      cursor: { ...cursor, run: { ...known, after: pageInfo.endCursor } },
      done: false,
    } satisfies SyncRead;
  }
  const nextStage = STAGES[STAGES.indexOf(run.stage) + 1];
  return {
    page,
    cursor: {
      ...cursor,
      run: { ...known, stage: nextStage ?? "pushes", after: null, offset: 0 },
    },
    done: false,
  } satisfies SyncRead;
}

const Activity = z.array(
  z.object({
    before: z.string(),
    after: z.string(),
    ref: z.string(),
    timestamp: z.string(),
    activity_type: z.string(),
    actor: z
      .object({
        login: z.string(),
        id: z.number(),
        type: z.string().optional(),
      })
      .nullish(),
  })
);
const Compare = z.object({
  total_commits: z.number(),
  commits: z.array(
    z.object({ sha: z.string(), commit: z.object({ message: z.string() }) })
  ),
});
const OneCommit = z.object({
  sha: z.string(),
  commit: z.object({ message: z.string() }),
});
const RepoInfo = z.object({ default_branch: z.string() });

type Run = NonNullable<z.infer<typeof Cursor>["run"]>;

async function readPushes(
  ctx: AppContext,
  auth: GithubAuth,
  fullName: string,
  run: Run
) {
  const get = async (what: string, path: string) => {
    const res = await githubCall(ctx, auth, what, path);
    const body: unknown = await res.json();
    return body;
  };
  const since = Date.parse(run.since);
  const pushes = Activity.parse(
    await get(
      "GitHub repository activity",
      `/repos/${fullName}/activity?activity_type=push&per_page=100`
    )
  )
    .filter(
      (a) => a.activity_type === "push" && Date.parse(a.timestamp) >= since
    )
    .slice(0, MAX_PUSHES);
  const offset = run.offset ?? 0;
  const { default_branch: defaultBranch } = RepoInfo.parse(
    await get("GitHub repository", `/repos/${fullName}`)
  );
  const nodes = [];
  for (const push of pushes.slice(offset, offset + PUSHES_PER_PAGE)) {
    nodes.push({ ...push, ...(await commitsOf(get, fullName, push)) });
  }
  const page = {
    eventType: "sync.github",
    partition: String(run.repoId ?? fullName),
    payload: {
      repo: {
        id: run.repoId ?? 0,
        full_name: fullName,
        default_branch: defaultBranch,
      },
      since: run.since,
      stage: "pushes" as const,
      nodes,
    },
  };
  if (offset + PUSHES_PER_PAGE < pushes.length) {
    return {
      page,
      cursor: { run: { ...run, offset: offset + PUSHES_PER_PAGE } },
      done: false,
    } satisfies SyncRead;
  }
  const next = new Date(
    new Date(run.started).getTime() - OVERLAP_MS
  ).toISOString();
  return { page, cursor: { next }, done: true } satisfies SyncRead;
}

async function commitsOf(
  get: (what: string, path: string) => Promise<unknown>,
  fullName: string,
  push: { before: string; after: string }
) {
  if (NO_COMMIT.test(push.before)) {
    const one = OneCommit.parse(
      await get("GitHub commit", `/repos/${fullName}/commits/${push.after}`)
    );
    return {
      total_commits: 1,
      commits: [{ id: one.sha, message: one.commit.message }],
    };
  }
  const compare = Compare.parse(
    await get(
      "GitHub compare",
      `/repos/${fullName}/compare/${push.before}...${push.after}`
    )
  );
  return {
    total_commits: compare.total_commits,
    commits: compare.commits
      .slice(-20)
      .map((c) => ({ id: c.sha, message: c.commit.message })),
  };
}

const Repos = z.object({
  repositories: z.array(z.object({ full_name: z.string() })),
});

const MAX_REPO_PAGES = 30;

export async function installationRepos(ctx: AppContext, auth: GithubAuth) {
  const names: string[] = [];
  for (let page = 1; page <= MAX_REPO_PAGES; page += 1) {
    const res = await githubCall(
      ctx,
      auth,
      "GitHub installation repositories",
      `/installation/repositories?per_page=100&page=${page}`
    );
    const body = Repos.parse(await res.json());
    names.push(...body.repositories.map((r) => r.full_name));
    if (body.repositories.length < 100) {
      break;
    }
  }
  return names;
}

const userOf = (a: GqlActor) =>
  a
    ? ({
        login: a.login,
        id: a.databaseId ?? null,
        type: a.__typename === "Bot" ? "Bot" : "User",
        name: a.name ?? undefined,
      } satisfies User)
    : null;

const closerOf = (items: z.infer<typeof Closer>) =>
  userOf(items.nodes.at(-1)?.actor ?? null);

function pullDeliveries(node: z.infer<typeof PullNode>) {
  const author = userOf(node.author);
  const pr: Issue = {
    number: node.number,
    title: node.title,
    html_url: node.url,
    body: node.body ?? null,
    user: author ?? { login: "ghost" },
    draft: node.isDraft === true,
    created_at: node.createdAt,
    updated_at: node.updatedAt,
  };
  const out: { type: string; payload: Payload }[] = [];
  if (node.isDraft !== true) {
    out.push({
      type: "pull_request",
      payload: {
        action: "opened",
        pull_request: pr,
        sender: author ?? undefined,
      },
    });
  }
  if (node.closedAt) {
    out.push({
      type: "pull_request",
      payload: {
        action: "closed",
        pull_request: {
          ...pr,
          merged: Boolean(node.mergedAt),
          closed_at: node.closedAt,
          merged_at: node.mergedAt ?? null,
        },
        sender:
          userOf(node.mergedBy) ?? closerOf(node.timelineItems) ?? undefined,
      },
    });
  }
  for (const r of node.reviews.nodes) {
    const user = userOf(r.author);
    if (!user || r.state === "PENDING" || r.state === "DISMISSED") {
      continue;
    }
    out.push({
      type: "pull_request_review",
      payload: {
        action: "submitted",
        review: {
          id: r.databaseId,
          state: r.state,
          body: r.body ?? null,
          html_url: r.url,
          user,
          submitted_at: r.submittedAt ?? undefined,
        },
        pull_request: pr,
        sender: user,
      },
    });
  }
  out.push(
    ...commentDeliveries(node.comments.nodes, { ...pr, pull_request: {} })
  );
  for (const r of node.reviews.nodes) {
    out.push(...lineCommentDeliveries(r.comments?.nodes ?? [], pr));
  }
  return out;
}

function lineCommentDeliveries(comments: z.infer<typeof Comment>[], pr: Issue) {
  return comments.flatMap((c) => {
    const user = userOf(c.author);
    return user
      ? [
          {
            type: "pull_request_review_comment",
            payload: {
              action: "created",
              comment: {
                id: c.databaseId,
                body: c.body,
                html_url: c.url,
                user,
                created_at: c.createdAt,
              },
              pull_request: pr,
              sender: user,
            } satisfies Payload,
          },
        ]
      : [];
  });
}

function issueDeliveries(node: z.infer<typeof IssueNode>) {
  const author = userOf(node.author);
  const issue: Issue = {
    number: node.number,
    title: node.title,
    html_url: node.url,
    body: node.body ?? null,
    user: author ?? { login: "ghost" },
    created_at: node.createdAt,
    updated_at: node.createdAt,
  };
  const out: { type: string; payload: Payload }[] = [
    {
      type: "issues",
      payload: { action: "opened", issue, sender: author ?? undefined },
    },
  ];
  if (node.closedAt) {
    out.push({
      type: "issues",
      payload: {
        action: "closed",
        issue: {
          ...issue,
          closed_at: node.closedAt,
          updated_at: node.closedAt,
        },
        sender: closerOf(node.timelineItems) ?? undefined,
      },
    });
  }
  out.push(...commentDeliveries(node.comments.nodes, issue));
  return out;
}

function commentDeliveries(comments: z.infer<typeof Comment>[], issue: Issue) {
  return comments.flatMap((c) => {
    const user = userOf(c.author);
    return user
      ? [
          {
            type: "issue_comment",
            payload: {
              action: "created",
              comment: {
                id: c.databaseId,
                body: c.body,
                html_url: c.url,
                user,
                created_at: c.createdAt,
              },
              issue,
              sender: user,
            } satisfies Payload,
          },
        ]
      : [];
  });
}

function pushDelivery(node: z.infer<typeof PushNode>) {
  return {
    type: "push",
    payload: {
      ref: node.ref,
      after: node.after,
      sender: node.actor
        ? { login: node.actor.login, id: node.actor.id, type: node.actor.type }
        : undefined,
      commits: node.commits.map((c) => ({ ...c, distinct: true })),
      total_commits: node.total_commits,
      head_commit: { timestamp: node.timestamp },
    } satisfies Payload,
  };
}

function releaseDelivery(node: z.infer<typeof ReleaseNode>) {
  return {
    type: "release",
    payload: {
      action: "published",
      release: {
        id: node.databaseId,
        tag_name: node.tagName,
        name: node.name ?? null,
        html_url: node.url,
        body: node.description ?? null,
        draft: node.isDraft,
        prerelease: node.isPrerelease,
        published_at: node.publishedAt ?? null,
      },
      sender: userOf(node.author) ?? undefined,
    } satisfies Payload,
  };
}

function awaitingReview(
  ns: string,
  repo: string,
  node: z.infer<typeof PullNode>
) {
  if (node.closedAt || node.isDraft === true) {
    return [];
  }
  const key = `${ns}:${repo}#${node.number}`;
  const author = userOf(node.author);
  return node.reviewRequests.nodes.flatMap(({ requestedReviewer }) => {
    const parsed = Actor.safeParse(requestedReviewer);
    const reviewer = parsed.success ? userOf(parsed.data) : null;
    if (!reviewer) {
      return [];
    }
    const who = actorFor(reviewer);
    return [
      {
        id: `pr:${key}:awaiting:${who.id}`,
        kind: "review.requested",
        occurredAt: new Date(node.updatedAt),
        actor: author ? actorFor(author) : null,
        title: `Waiting on @${reviewer.login} to review ${repo}#${node.number}: ${node.title}`,
        thread: key,
        object: {
          type: "pull_request",
          key,
          title: `${repo}#${node.number} ${node.title}`,
          url: node.url,
        },
        url: node.url,
        hidden: true,
        signals: [{ type: "review_requested", who }],
      } satisfies WorklogEvent,
    ];
  });
}

/** Pure, like every normalize: the page holds GitHub's answer, not anything derived from it. */
export function normalizeSyncPage(
  ns: string,
  payload: unknown,
  receivedAt: Date,
  settings: Record<string, unknown>
) {
  const page = SyncPayload.safeParse(payload);
  if (!page.success) {
    return { events: [], ignored: "malformed sync page" } satisfies Normalized;
  }
  const { repo, since, stage, nodes } = page.data;
  const deliveries: { type: string; payload: Payload }[] = [];
  const extra: WorklogEvent[] = [];
  for (const raw of nodes) {
    if (stage === "pulls") {
      const node = PullNode.safeParse(raw);
      if (node.success) {
        deliveries.push(...pullDeliveries(node.data));
        extra.push(...awaitingReview(ns, repo.full_name, node.data));
      }
    } else if (stage === "pushes") {
      const node = PushNode.safeParse(raw);
      if (node.success) {
        deliveries.push(pushDelivery(node.data));
      }
    } else if (stage === "issues") {
      const node = IssueNode.safeParse(raw);
      if (node.success) {
        deliveries.push(...issueDeliveries(node.data));
      }
    } else {
      const node = ReleaseNode.safeParse(raw);
      if (node.success) {
        deliveries.push(releaseDelivery(node.data));
      }
    }
  }
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
  const events = [...normalized.flat(), ...extra].filter(
    (e) => e.occurredAt >= from || e.hidden === true
  );
  return {
    events,
    ignored:
      events.length === 0
        ? `nothing new in ${repo.full_name} ${stage}`
        : undefined,
    skipped: normalized.filter((e) => e.length === 0).length,
  } satisfies Normalized;
}

export function reposOf(conn: ConnectionView) {
  return Array.isArray(conn.settings.repos)
    ? conn.settings.repos.filter((r): r is string => typeof r === "string")
    : [];
}
