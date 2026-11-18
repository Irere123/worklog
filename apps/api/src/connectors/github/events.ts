import { z } from "zod";

import type {
  ExternalActor,
  Normalized,
  Signal,
  WorklogEvent,
} from "#connectors/types";

const optional = <T extends z.ZodType>(schema: T) =>
  schema.optional().catch(undefined);
const listOf = <T extends z.ZodType>(item: T) =>
  z.array(z.unknown()).transform((items) =>
    items.flatMap((i) => {
      const parsed = item.safeParse(i);
      return parsed.success ? [parsed.data] : [];
    })
  );
const when = z.string().refine((s) => !Number.isNaN(Date.parse(s)));

const UserSchema = z.object({
  login: z.string().min(1),
  id: optional(z.number().nullable()),
  type: optional(z.string()),
  name: optional(z.string()),
  avatar_url: optional(z.string()),
});
const RepoSchema = z.object({
  id: optional(z.number()),
  full_name: z.string().min(1),
  html_url: optional(z.string()),
  default_branch: optional(z.string()),
});
const IssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  html_url: z.string(),
  body: optional(z.string().nullable()),
  user: optional(UserSchema),
  draft: optional(z.boolean()),
  merged: optional(z.boolean()),
  pull_request: z.unknown().optional(),
  requested_reviewers: optional(listOf(UserSchema)),
  created_at: optional(when),
  updated_at: optional(when),
  closed_at: optional(when.nullable()),
  merged_at: optional(when.nullable()),
});
const PayloadSchema = z
  .object({
    action: optional(z.string()),
    sender: optional(UserSchema),
    repository: optional(RepoSchema),
    issue: optional(IssueSchema),
    pull_request: optional(IssueSchema),
    review: optional(
      z.object({
        id: z.union([z.number(), z.string()]),
        state: z.string(),
        body: optional(z.string().nullable()),
        html_url: z.string(),
        user: optional(UserSchema),
        submitted_at: optional(when),
      })
    ),
    comment: optional(
      z.object({
        id: z.number(),
        body: z.string(),
        html_url: z.string(),
        user: optional(UserSchema),
        created_at: optional(when),
      })
    ),
    requested_reviewer: optional(UserSchema),
    assignee: optional(UserSchema),
    release: optional(
      z.object({
        id: z.number(),
        tag_name: z.string(),
        name: optional(z.string().nullable()),
        html_url: z.string(),
        body: optional(z.string().nullable()),
        draft: optional(z.boolean()),
        prerelease: optional(z.boolean()),
        published_at: optional(when.nullable()),
      })
    ),
    ref: optional(z.string()),
    after: optional(z.string()),
    deleted: optional(z.boolean()),
    forced: optional(z.boolean()),
    compare: optional(z.string()),
    commits: optional(
      listOf(
        z.object({
          id: z.string(),
          message: z.string(),
          distinct: optional(z.boolean()),
        })
      )
    ),
    total_commits: optional(z.number()),
    head_commit: optional(z.object({ timestamp: optional(when) }).nullable()),
  })
  .catch({});

export function parsePayload(payload: unknown) {
  return PayloadSchema.parse(payload);
}

export type User = z.infer<typeof UserSchema>;
export type Repo = z.infer<typeof RepoSchema>;
export type Issue = z.infer<typeof IssueSchema>;
export type Payload = z.infer<typeof PayloadSchema>;

const CLOSES =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(?<number>\d+)/giu;
const WL_REF = /\bWL-(?<number>\d+)\b/giu;
const MENTION = /(?:^|[^\w`/])@(?<login>[a-z0-9](?:[a-z0-9-]{0,38}))/giu;
const MERGE_COMMIT = /^Merge (?:pull request|branch) |\(#\d+\)\s*$/u;

export const actorFor = (u: User) =>
  ({
    id:
      u.id === undefined || u.id === null
        ? `handle:${u.login.toLowerCase()}`
        : String(u.id),
    handle: u.login,
    name: u.name ?? null,
    bot: u.type === "Bot" || /\[bot\]$/iu.test(u.login),
    avatarUrl: u.avatar_url ?? null,
  }) satisfies ExternalActor;

const actorOf = (u?: User | null) => (u ? actorFor(u) : null);

const byLogin = (login: string) =>
  ({
    id: `handle:${login.toLowerCase()}`,
    handle: login,
  }) satisfies ExternalActor;

const captures = (
  text: string | null | undefined,
  pattern: RegExp,
  group: string
) =>
  [...(text ?? "").matchAll(pattern)].flatMap((m) => m.groups?.[group] ?? []);

const mentionsIn = (text: string | null | undefined, exclude?: string) =>
  [
    ...new Set(
      captures(text, MENTION, "login").map((login) => login.toLowerCase())
    ),
  ]
    .filter((l) => l !== exclude?.toLowerCase())
    .map(
      (l) =>
        ({
          type: "mentioned",
          who: byLogin(l),
          excerpt: (text ?? "").slice(0, 280),
        }) satisfies Signal
    );

const wlRefs = (...texts: (string | null | undefined)[]) => [
  ...new Set(texts.flatMap((t) => captures(t, WL_REF, "number").map(Number))),
];
const closesKeys = (ns: string, repo: string, body?: string | null) =>
  captures(body, CLOSES, "number").map((n) => `${ns}:${repo}#${n}`);

const firstLine = (message: string) => message.split("\n", 1)[0] ?? "";

const ignore = (reason: string) =>
  ({
    events: [],
    ignored: reason,
  }) satisfies Normalized;

type Delivery = {
  ns: string;
  repo: string;
  eventType: string;
  p: Payload;
  receivedAt: Date;
  actor: ExternalActor | null;
  at: (iso?: string | null) => Date;
  stamp: (iso?: string | null) => string;
  ref: (n: number) => string;
  key: (n: number) => string;
  event: (e: Omit<WorklogEvent, "actor" | "container">) => WorklogEvent;
};

type Common = Pick<WorklogEvent, "thread" | "object" | "url" | "cardRefs">;

const EVENTS = new Map<string, (d: Delivery) => Normalized>([
  ["push", onPush],
  ["pull_request", onPullRequest],
  ["pull_request_review", onReview],
  ["pull_request_review_comment", onComment],
  ["issue_comment", onComment],
  ["issues", onIssue],
  ["release", onRelease],
]);

const PR_ACTIONS = new Map<
  string,
  (d: Delivery, pr: Issue, common: Common) => Normalized
>([
  ["opened", onPrOpened],
  ["reopened", onPrOpened],
  ["ready_for_review", onPrOpened],
  ["closed", onPrClosed],
  ["review_requested", onReviewRequested],
  ["review_request_removed", onReviewRequestRemoved],
  ["assigned", onPrAssigned],
]);

const ISSUE_ACTIONS = new Map<
  string,
  (d: Delivery, issue: Issue, common: Common) => Normalized
>([
  ["opened", onIssueOpened],
  ["closed", onIssueClosed],
  ["reopened", onIssueReopened],
  ["assigned", onIssueAssigned],
]);

const REVIEW_VERBS = new Map([
  ["approved", "Approved"],
  ["changes_requested", "Requested changes on"],
]);

export function normalizeGithubLike(
  ns: string,
  eventType: string,
  payload: unknown,
  receivedAt: Date,
  settings: { repos?: unknown }
) {
  const p = parsePayload(payload);
  const repo = p.repository?.full_name;
  if (!repo) {
    return ignore(`${eventType}: no repository`);
  }
  const repos = Array.isArray(settings.repos)
    ? settings.repos.filter((r: unknown): r is string => typeof r === "string")
    : [];
  if (repos.length && !repos.includes(repo)) {
    return ignore(`repository ${repo} isn't tracked`);
  }
  const handler = EVENTS.get(eventType);
  if (!handler) {
    return ignore(`${eventType} (not a work signal)`);
  }
  const actor = actorOf(p.sender);
  const container = { type: "repo", key: `${ns}:${repo}`, name: repo };
  return handler({
    ns,
    repo,
    eventType,
    p,
    receivedAt,
    actor,
    at: (iso) => (iso ? new Date(iso) : receivedAt),
    stamp: (iso) => iso ?? receivedAt.toISOString(),
    ref: (n) => `${repo}#${n}`,
    key: (n) => `${ns}:${repo}#${n}`,
    event: (e) => ({ actor, container, ...e }),
  });
}

function onPush({ ns, repo, p, actor, at, event }: Delivery) {
  if (p.deleted === true) {
    return ignore("branch deleted");
  }
  const gitRef = p.ref ?? "";
  if (!gitRef.startsWith("refs/heads/")) {
    return ignore("tag push");
  }
  if (p.forced === true) {
    return ignore("force push (rewritten history isn't new work)");
  }
  const branch = gitRef.slice("refs/heads/".length);
  const commits = (p.commits ?? []).filter((c) => c.distinct !== false);
  if (!commits.length) {
    return ignore("no new commits");
  }
  const total = Math.max(commits.length, p.total_commits ?? 0);
  const isDefault = branch === (p.repository?.default_branch ?? "main");
  if (
    isDefault &&
    commits.every((c) => MERGE_COMMIT.test(firstLine(c.message)))
  ) {
    return ignore(
      "merge commits on the default branch (the PR merge already says it)"
    );
  }
  return {
    events: [
      event({
        id: `push:${repo}:${p.after}`,
        kind: "code.pushed",
        occurredAt: at(p.head_commit?.timestamp),
        title: `Pushed ${total} commit${total === 1 ? "" : "s"} to ${repo}:${branch}`,
        body: commits
          .slice(0, 8)
          .map((c) => `• ${firstLine(c.message)}`)
          .join("\n"),
        url: p.compare,
        thread: `${ns}:${repo}:branch:${branch}`,
        object: {
          type: "branch",
          key: `${ns}:${repo}:branch:${branch}`,
          title: `${repo}:${branch}`,
        },
        cardRefs: {
          numbers: wlRefs(branch, ...commits.map((c) => c.message)),
        },
        coalesce: {
          key: `push:${ns}:${repo}:${branch}:${actor?.id}`,
          windowMinutes: 60,
          units: total,
          template: `Pushed {n} commit{s} to ${repo}:${branch}`,
        },
        importance: isDefault ? 0.4 : 0.3,
      }),
    ],
  } satisfies Normalized;
}

function onPullRequest(d: Delivery) {
  const { ns, repo, p, ref, key } = d;
  const pr = p.pull_request;
  if (!pr) {
    return ignore("pull_request without a pull request");
  }
  const handler = PR_ACTIONS.get(p.action ?? "");
  if (!handler) {
    return ignore(`pull_request.${p.action} (not a work signal)`);
  }
  const n = pr.number;
  return handler(d, pr, {
    thread: key(n),
    object: {
      type: "pull_request",
      key: key(n),
      title: `${ref(n)} ${pr.title}`,
      url: pr.html_url,
    },
    url: pr.html_url,
    cardRefs: {
      externalKeys: closesKeys(ns, repo, pr.body),
      numbers: wlRefs(pr.title, pr.body),
    },
  });
}

function onPrOpened(
  { p, at, stamp, ref, key, event }: Delivery,
  pr: Issue,
  common: Common
) {
  if (pr.draft === true) {
    return ignore("draft pull request");
  }
  const reopened = p.action === "reopened";
  const id = reopened
    ? `pr:${key(pr.number)}:reopened:${stamp(pr.updated_at)}`
    : `pr:${key(pr.number)}:opened`;
  return {
    events: [
      event({
        ...common,
        id,
        kind: "pr.opened",
        occurredAt: at(
          p.action === "opened"
            ? (pr.created_at ?? pr.updated_at)
            : pr.updated_at
        ),
        title: `${reopened ? "Reopened" : "Opened"} PR ${ref(pr.number)}: ${pr.title}`,
        body: pr.body?.slice(0, 600) ?? null,
        signals: [
          ...(pr.requested_reviewers ?? []).map(
            (u) =>
              ({
                type: "review_requested",
                who: actorFor(u),
              }) satisfies Signal
          ),
          ...mentionsIn(pr.body, p.sender?.login),
        ],
      }),
    ],
  } satisfies Normalized;
}

function onPrClosed(
  { at, ref, key, event }: Delivery,
  pr: Issue,
  common: Common
) {
  const merged = pr.merged === true;
  return {
    events: [
      event({
        ...common,
        id: `pr:${key(pr.number)}:closed:${pr.closed_at ?? ""}`,
        kind: merged ? "pr.merged" : "pr.closed",
        occurredAt: at(pr.merged_at ?? pr.closed_at),
        title: `${merged ? "Merged" : "Closed"} PR ${ref(pr.number)}: ${pr.title}`,
        signals: [{ type: "resolve", what: "review_requested" }],
      }),
    ],
  } satisfies Normalized;
}

function onReviewRequested(
  { p, at, stamp, ref, key, event }: Delivery,
  pr: Issue,
  common: Common
) {
  const reviewer = p.requested_reviewer;
  if (!reviewer) {
    return ignore("review requested from a team");
  }
  return {
    events: [
      event({
        ...common,
        id: `pr:${key(pr.number)}:review_requested:${reviewer.id ?? reviewer.login}:${stamp(pr.updated_at)}`,
        kind: "review.requested",
        occurredAt: at(pr.updated_at),
        title: `Asked @${reviewer.login} to review ${ref(pr.number)}: ${pr.title}`,
        signals: [{ type: "review_requested", who: actorFor(reviewer) }],
      }),
    ],
  } satisfies Normalized;
}

function onReviewRequestRemoved(
  { p, at, stamp, ref, key, event }: Delivery,
  pr: Issue,
  common: Common
) {
  const reviewer = p.requested_reviewer;
  if (!reviewer) {
    return ignore("team review request removed");
  }
  return {
    events: [
      event({
        ...common,
        id: `pr:${key(pr.number)}:rr-removed:${reviewer.id ?? reviewer.login}:${stamp(pr.updated_at)}`,
        kind: "review.unrequested",
        occurredAt: at(pr.updated_at),
        title: `Review request removed on ${ref(pr.number)}`,
        hidden: true,
        signals: [
          {
            type: "resolve",
            who: actorFor(reviewer),
            what: "review_requested",
          },
        ],
      }),
    ],
  } satisfies Normalized;
}

function onPrAssigned(
  { p, at, stamp, ref, key, event }: Delivery,
  pr: Issue,
  common: Common
) {
  const { assignee } = p;
  if (!assignee) {
    return ignore("no assignee");
  }
  return {
    events: [
      event({
        ...common,
        id: `pr:${key(pr.number)}:assigned:${assignee.id ?? assignee.login}:${stamp(pr.updated_at)}`,
        kind: "pr.assigned",
        occurredAt: at(pr.updated_at),
        title: `Assigned ${ref(pr.number)} to @${assignee.login}`,
        hidden: true,
        signals: [{ type: "assigned", who: actorFor(assignee) }],
      }),
    ],
  } satisfies Normalized;
}

function onReview({ ns, p, actor, at, ref, key, event }: Delivery) {
  const { review, pull_request: pr } = p;
  if (p.action !== "submitted" || !review || !pr) {
    return ignore(`pull_request_review.${p.action}`);
  }
  const n = pr.number;
  const state = review.state.toLowerCase();
  const body = review.body?.trim() ?? "";
  if (state === "commented" && !body) {
    return ignore("empty review (its inline comments arrive separately)");
  }
  const author = actorOf(pr.user);
  const reviewState: "approved" | "changes_requested" | "commented" =
    state === "approved" || state === "changes_requested" ? state : "commented";
  const signals: Signal[] = [...mentionsIn(body, p.sender?.login)];
  if (author && author.id !== actor?.id) {
    signals.push({ type: "review_result", who: author, state: reviewState });
  }
  if (actor) {
    signals.push({ type: "resolve", who: actor, what: "review_requested" });
  }
  return {
    events: [
      event({
        id: `review:${ns}:${review.id}`,
        kind: "review.submitted",
        occurredAt: at(review.submitted_at),
        title: `${REVIEW_VERBS.get(state) ?? "Reviewed"} ${ref(n)}: ${pr.title}`,
        body: body.slice(0, 600) || null,
        url: review.html_url,
        thread: key(n),
        object: {
          type: "pull_request",
          key: key(n),
          title: `${ref(n)} ${pr.title}`,
          url: pr.html_url,
        },
        importance: state === "commented" ? 0.35 : undefined,
        data: { state },
        signals,
      }),
    ],
  } satisfies Normalized;
}

function onComment({ ns, eventType, p, actor, at, ref, key, event }: Delivery) {
  const { comment } = p;
  if (p.action !== "created" || !comment) {
    return ignore(`${eventType}.${p.action}`);
  }
  const item = p.issue ?? p.pull_request;
  if (!item) {
    return ignore(`${eventType} without an issue or pull request`);
  }
  const n = item.number;
  const isPr =
    eventType === "pull_request_review_comment" ||
    Boolean(p.issue?.pull_request);
  return {
    events: [
      event({
        id: `comment:${ns}:${comment.id}`,
        kind: "comment.created",
        occurredAt: at(comment.created_at),
        title: `Commented on ${ref(n)}: ${item.title}`,
        body: comment.body.slice(0, 500),
        url: comment.html_url,
        thread: key(n),
        object: {
          type: isPr ? "pull_request" : "issue",
          key: key(n),
          title: `${ref(n)} ${item.title}`,
          url: item.html_url,
        },
        cardRefs: {
          externalKeys: [key(n)],
          numbers: wlRefs(comment.body),
        },
        coalesce: {
          key: `comments:${key(n)}:${actor?.id}`,
          windowMinutes: 30,
          units: 1,
          template: `Left {n} comment{s} on ${ref(n)}: ${item.title}`,
        },
        signals: mentionsIn(comment.body, p.sender?.login),
      }),
    ],
  } satisfies Normalized;
}

function onIssue(d: Delivery) {
  const { p, ref, key } = d;
  const { issue } = p;
  if (!issue) {
    return ignore("issues without an issue");
  }
  const handler = ISSUE_ACTIONS.get(p.action ?? "");
  if (!handler) {
    return ignore(`issues.${p.action} (not a work signal)`);
  }
  const n = issue.number;
  return handler(d, issue, {
    thread: key(n),
    object: {
      type: "issue",
      key: key(n),
      title: `${ref(n)} ${issue.title}`,
      url: issue.html_url,
    },
    url: issue.html_url,
    cardRefs: { externalKeys: [key(n)] },
  });
}

function onIssueOpened(
  { p, at, ref, key, event }: Delivery,
  issue: Issue,
  common: Common
) {
  return {
    events: [
      event({
        ...common,
        id: `issue:${key(issue.number)}:opened`,
        kind: "issue.opened",
        occurredAt: at(issue.updated_at),
        title: `Opened issue ${ref(issue.number)}: ${issue.title}`,
        body: issue.body?.slice(0, 600) ?? null,
        board: [
          {
            type: "upsert_card",
            externalKey: key(issue.number),
            title: issue.title,
            body: issue.body ?? null,
            url: issue.html_url,
          },
        ],
        signals: mentionsIn(issue.body, p.sender?.login),
      }),
    ],
  } satisfies Normalized;
}

function onIssueClosed(
  { at, stamp, ref, key, event }: Delivery,
  issue: Issue,
  common: Common
) {
  return {
    events: [
      event({
        ...common,
        id: `issue:${key(issue.number)}:closed:${stamp(issue.closed_at ?? issue.updated_at)}`,
        kind: "issue.closed",
        occurredAt: at(issue.closed_at ?? issue.updated_at),
        title: `Closed issue ${ref(issue.number)}: ${issue.title}`,
        board: [{ type: "close_card", externalKey: key(issue.number) }],
        signals: [{ type: "resolve", what: "assigned" }],
      }),
    ],
  } satisfies Normalized;
}

function onIssueReopened(
  { at, stamp, ref, key, event }: Delivery,
  issue: Issue,
  common: Common
) {
  return {
    events: [
      event({
        ...common,
        id: `issue:${key(issue.number)}:reopened:${stamp(issue.updated_at)}`,
        kind: "issue.reopened",
        occurredAt: at(issue.updated_at),
        title: `Reopened issue ${ref(issue.number)}: ${issue.title}`,
        board: [{ type: "reopen_card", externalKey: key(issue.number) }],
      }),
    ],
  } satisfies Normalized;
}

function onIssueAssigned(
  { p, at, stamp, ref, key, event }: Delivery,
  issue: Issue,
  common: Common
) {
  const { assignee } = p;
  if (!assignee) {
    return ignore("no assignee");
  }
  const who = actorFor(assignee);
  return {
    events: [
      event({
        ...common,
        id: `issue:${key(issue.number)}:assigned:${assignee.id ?? assignee.login}:${stamp(issue.updated_at)}`,
        kind: "issue.assigned",
        occurredAt: at(issue.updated_at),
        title: `Assigned ${ref(issue.number)} to @${assignee.login}`,
        hidden: true,
        board: [{ type: "assign_card", externalKey: key(issue.number), who }],
        signals: [{ type: "assigned", who }],
      }),
    ],
  } satisfies Normalized;
}

function onRelease({ ns, repo, p, at, event }: Delivery) {
  const r = p.release;
  if (p.action !== "published" || !r || r.draft === true) {
    return ignore(`release.${p.action}`);
  }
  const prerelease = r.prerelease === true;
  return {
    events: [
      event({
        id: `release:${ns}:${r.id}`,
        kind: "release.published",
        occurredAt: at(r.published_at),
        title: `Released ${repo} ${(r.name ?? "") || r.tag_name}${prerelease ? " (pre-release)" : ""}`,
        body: r.body?.slice(0, 800) ?? null,
        url: r.html_url,
        thread: `${ns}:${repo}:releases`,
        importance: prerelease ? 0.6 : undefined,
      }),
    ],
  } satisfies Normalized;
}
