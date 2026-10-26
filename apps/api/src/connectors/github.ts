import { createHash } from "node:crypto";

import type {
  ConnectionView,
  Connector,
  ExternalActor,
  Normalized,
  Signal,
  WorklogEvent,
} from "../ingest/types";
import { hmacHex, safeEqual } from "../lib/crypto";

/**
 * GitHub, and GitHub-compatible forges (Gitea, Forgejo — self-hosted). One normalizer, explicit noise
 * rules: only events that mean work moved or someone is waiting become activity.
 *
 * Kept: PR opened / ready / merged / closed / reopened; reviews (approve, changes requested, commented
 * with a body); review & issue comments (merged per person per thread); issues opened / closed /
 * reopened; pushes (merged per branch per person, minus merge commits already covered by a PR); releases.
 * Signals: review requests, assignments, @mentions, review results, resolutions.
 * Dropped (with a reason): drafts, PR syncs/edits/labels, tag & delete pushes, stars, forks, CI statuses…
 */

type User = { login: string; id?: number | null; type?: string; name?: string };
type Repo = { full_name: string; html_url?: string; default_branch?: string };
type Issue = {
  number: number;
  title: string;
  html_url: string;
  body?: string | null;
  user: User;
  draft?: boolean;
  merged?: boolean;
  pull_request?: unknown;
  requested_reviewers?: User[];
  updated_at?: string;
  closed_at?: string | null;
  merged_at?: string | null;
};
type Payload = {
  action?: string;
  sender?: User;
  repository?: Repo;
  issue?: Issue;
  pull_request?: Issue;
  review?: {
    id: number;
    state: string;
    body?: string | null;
    html_url: string;
    user: User;
    submitted_at?: string;
  };
  comment?: {
    id: number;
    body: string;
    html_url: string;
    user: User;
    created_at?: string;
  };
  requested_reviewer?: User;
  assignee?: User;
  release?: {
    id: number;
    tag_name: string;
    name?: string | null;
    html_url: string;
    body?: string | null;
    draft?: boolean;
    prerelease?: boolean;
  };
  ref?: string;
  after?: string;
  deleted?: boolean;
  forced?: boolean;
  compare?: string;
  commits?: { id: string; message: string; distinct?: boolean }[];
  /** Gitea/Forgejo: commit lists are capped, this is the real count. */
  total_commits?: number;
  head_commit?: { timestamp?: string } | null;
};

const CLOSES =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(?<number>\d+)/giu;
const WL_REF = /\bWL-(?<number>\d+)\b/giu;
const MENTION = /(?:^|[^\w`/])@(?<login>[a-z0-9](?:[a-z0-9-]{0,38}))/giu;
const MERGE_COMMIT = /^Merge (?:pull request|branch) |\(#\d+\)\s*$/u;

const actorFor = (u: User): ExternalActor => ({
  id:
    u.id === undefined || u.id === null
      ? `handle:${u.login.toLowerCase()}`
      : String(u.id),
  handle: u.login,
  name: u.name ?? null,
  bot: u.type === "Bot" || /\[bot\]$/iu.test(u.login),
});

const actorOf = (u?: User | null): ExternalActor | null =>
  u ? actorFor(u) : null;

/** A mentioned login, as an actor reference (resolved by login since mentions carry no id). */
const byLogin = (login: string): ExternalActor => ({
  id: `handle:${login.toLowerCase()}`,
  handle: login,
});

/** Every value a named group captured across the text's matches. */
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
    .map((l): Signal => ({
      type: "mentioned",
      who: byLogin(l),
      excerpt: (text ?? "").slice(0, 280),
    }));

const wlRefs = (...texts: (string | null | undefined)[]) => [
  ...new Set(texts.flatMap((t) => captures(t, WL_REF, "number").map(Number))),
];
const closesKeys = (ns: string, repo: string, body?: string | null) =>
  captures(body, CLOSES, "number").map((n) => `${ns}:${repo}#${n}`);

const firstLine = (message: string) => message.split("\n", 1)[0] ?? "";

const ignore = (reason: string): Normalized => ({
  events: [],
  ignored: reason,
});

/** One delivery being normalized, with the helpers every handler needs. */
type Delivery = {
  /** Key prefix: "github" or "gitea:git.example.com". */
  ns: string;
  repo: string;
  eventType: string;
  p: Payload;
  receivedAt: Date;
  actor: ExternalActor | null;
  /** The source's timestamp, or when the delivery arrived. */
  at: (iso?: string | null) => Date;
  /** The source's timestamp as an id part, or the arrival time. */
  stamp: (iso?: string | null) => string;
  /** "acme/api#7", for titles. */
  ref: (n: number) => string;
  /** "github:acme/api#7", for threads, objects and card links. */
  key: (n: number) => string;
  event: (e: Omit<WorklogEvent, "actor" | "container">) => WorklogEvent;
};

/** What a PR or issue event shares across its actions. */
type Common = Pick<WorklogEvent, "thread" | "object" | "url" | "cardRefs">;

/** What each event becomes. Anything not listed here is dropped as "not a work signal". */
const EVENTS = new Map<string, (d: Delivery) => Normalized>([
  ["push", onPush],
  ["pull_request", onPullRequest],
  ["pull_request_review", onReview],
  ["pull_request_review_comment", onComment],
  ["issue_comment", onComment],
  ["issues", onIssue],
  ["release", onRelease],
]);

/** Pull request actions that mean work moved or someone is waiting. Syncs, edits and labels aren't. */
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

/** Normalizer shared by GitHub and GitHub-compatible forges. `ns` prefixes keys: "github" or "gitea:git.example.com". */
export function normalizeGithubLike(
  ns: string,
  eventType: string,
  p: Payload,
  receivedAt: Date,
  settings: { repos?: unknown }
): Normalized {
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

// ---------------------------------------------------------------------------
// Pushes
// ---------------------------------------------------------------------------

function onPush({ ns, repo, p, actor, at, event }: Delivery): Normalized {
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
  };
}

// ---------------------------------------------------------------------------
// Pull requests
// ---------------------------------------------------------------------------

function onPullRequest(d: Delivery): Normalized {
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
): Normalized {
  if (pr.draft === true) {
    return ignore("draft pull request");
  }
  const verb = p.action === "reopened" ? "Reopened" : "Opened";
  return {
    events: [
      event({
        ...common,
        id: `pr:${key(pr.number)}:${p.action}:${stamp(pr.updated_at)}`,
        kind: "pr.opened",
        occurredAt: at(pr.updated_at),
        title: `${verb} PR ${ref(pr.number)}: ${pr.title}`,
        body: pr.body?.slice(0, 600) ?? null,
        signals: [
          ...(pr.requested_reviewers ?? []).map((u): Signal => ({
            type: "review_requested",
            who: actorFor(u),
          })),
          ...mentionsIn(pr.body, p.sender?.login),
        ],
      }),
    ],
  };
}

function onPrClosed(
  { at, ref, key, event }: Delivery,
  pr: Issue,
  common: Common
): Normalized {
  const merged = pr.merged === true;
  return {
    events: [
      event({
        ...common,
        id: `pr:${key(pr.number)}:closed:${pr.closed_at ?? ""}`,
        kind: merged ? "pr.merged" : "pr.closed",
        occurredAt: at(pr.merged_at ?? pr.closed_at),
        title: `${merged ? "Merged" : "Closed"} PR ${ref(pr.number)}: ${pr.title}`,
        // Nobody needs to review a closed PR any more.
        signals: [{ type: "resolve", what: "review_requested" }],
      }),
    ],
  };
}

function onReviewRequested(
  { p, at, stamp, ref, key, event }: Delivery,
  pr: Issue,
  common: Common
): Normalized {
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
  };
}

function onReviewRequestRemoved(
  { p, at, stamp, ref, key, event }: Delivery,
  pr: Issue,
  common: Common
): Normalized {
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
  };
}

function onPrAssigned(
  { p, at, stamp, ref, key, event }: Delivery,
  pr: Issue,
  common: Common
): Normalized {
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
  };
}

// ---------------------------------------------------------------------------
// Reviews and comments
// ---------------------------------------------------------------------------

function onReview({ ns, p, actor, at, ref, key, event }: Delivery): Normalized {
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
  };
}

function onComment({
  ns,
  eventType,
  p,
  actor,
  at,
  ref,
  key,
  event,
}: Delivery): Normalized {
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
  };
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

function onIssue(d: Delivery): Normalized {
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
): Normalized {
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
  };
}

function onIssueClosed(
  { at, stamp, ref, key, event }: Delivery,
  issue: Issue,
  common: Common
): Normalized {
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
  };
}

function onIssueReopened(
  { at, stamp, ref, key, event }: Delivery,
  issue: Issue,
  common: Common
): Normalized {
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
  };
}

function onIssueAssigned(
  { p, at, stamp, ref, key, event }: Delivery,
  issue: Issue,
  common: Common
): Normalized {
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
  };
}

// ---------------------------------------------------------------------------
// Releases
// ---------------------------------------------------------------------------

function onRelease({ ns, repo, p, receivedAt, event }: Delivery): Normalized {
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
        occurredAt: receivedAt,
        title: `Released ${repo} ${(r.name ?? "") || r.tag_name}${prerelease ? " (pre-release)" : ""}`,
        body: r.body?.slice(0, 800) ?? null,
        url: r.html_url,
        thread: `${ns}:${repo}:releases`,
        importance: prerelease ? 0.6 : undefined,
      }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

const SETTINGS_DOC = [
  {
    key: "boardId",
    description: "Board where new issues land as cards in Maybe? (optional)",
  },
  {
    key: "repos",
    description:
      'Only these repositories, e.g. ["acme/api"] (optional; default all)',
  },
  {
    key: "bots",
    description:
      '"quiet" (default: keep only bot PRs/releases), "drop", or "keep"',
  },
  {
    key: "ignoreKinds",
    description: 'Event kinds to never record, e.g. ["code.pushed"]',
  },
];

const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex").slice(0, 32);

/**
 * The signature-verified body, read as GitHub documents it. Every top-level field is optional and
 * handlers check the ones they need, so a body that isn't an object simply has none.
 */
const asPayload = (payload: unknown): Payload =>
  typeof payload === "object" && payload !== null ? payload : {};

export const githubConnector: Connector = {
  id: "github",
  name: "GitHub",
  description:
    "Pull requests, reviews, issues, comments, pushes and releases. Review requests, assignments and @mentions become attention items.",
  secrets: [
    {
      key: "webhookSecret",
      required: true,
      description: "The webhook's secret (Settings → Webhooks)",
    },
  ],
  settings: SETTINGS_DOC,
  endpoints: { webhook: "" },
  identityNamespace: () => "github",
  receive(req, conn) {
    const secret = conn.secrets.webhookSecret;
    const signature = req.headers.get("x-hub-signature-256");
    if (
      !secret ||
      !signature ||
      !safeEqual(signature, `sha256=${hmacHex(secret, req.rawBody)}`)
    ) {
      return { type: "reject", status: 401, error: "bad signature" };
    }
    const eventType = req.headers.get("x-github-event") ?? "unknown";
    if (eventType === "ping") {
      return { type: "respond", body: { ok: true } };
    }
    return {
      type: "event",
      eventType,
      deliveryId: req.headers.get("x-github-delivery") ?? digest(req.rawBody),
      payload: JSON.parse(req.rawBody),
    };
  },
  normalize: ({ eventType, payload, receivedAt }, conn) =>
    normalizeGithubLike(
      "github",
      eventType,
      asPayload(payload),
      receivedAt,
      conn.settings
    ),
};

function hostOf(conn: ConnectionView) {
  const { baseUrl } = conn.settings;
  try {
    return new URL(typeof baseUrl === "string" ? baseUrl : "").host;
  } catch {
    return conn.id;
  }
}

/** Self-hosted Gitea / Forgejo: same payloads, different headers, and its own identity namespace per server. */
export const giteaConnector: Connector = {
  id: "gitea",
  name: "Gitea / Forgejo (self-hosted)",
  description:
    "For self-hosted Gitea or Forgejo. GitHub-compatible webhooks, mapped with the same rules as GitHub.",
  secrets: [
    {
      key: "webhookSecret",
      required: true,
      description: "The webhook's secret",
    },
  ],
  settings: [
    {
      key: "baseUrl",
      description:
        "Your server, e.g. https://git.example.com (namespaces identities and links)",
    },
    ...SETTINGS_DOC,
  ],
  endpoints: { webhook: "" },
  identityNamespace: (conn) => `gitea:${hostOf(conn)}`,
  receive(req, conn) {
    const secret = conn.secrets.webhookSecret;
    const signature =
      req.headers.get("x-forgejo-signature") ??
      req.headers.get("x-gitea-signature");
    if (
      !secret ||
      !signature ||
      !safeEqual(signature, hmacHex(secret, req.rawBody))
    ) {
      return { type: "reject", status: 401, error: "bad signature" };
    }
    const eventType =
      req.headers.get("x-forgejo-event") ??
      req.headers.get("x-gitea-event") ??
      "unknown";
    const deliveryId =
      req.headers.get("x-forgejo-delivery") ??
      req.headers.get("x-gitea-delivery") ??
      digest(req.rawBody);
    return {
      type: "event",
      eventType,
      deliveryId,
      payload: JSON.parse(req.rawBody),
    };
  },
  normalize: ({ eventType, payload, receivedAt }, conn) =>
    normalizeGithubLike(
      `gitea:${hostOf(conn)}`,
      eventType,
      asPayload(payload),
      receivedAt,
      conn.settings
    ),
};
