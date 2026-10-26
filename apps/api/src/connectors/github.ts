import { createHash } from "node:crypto";
import type { ConnectionView, Connector, ExternalActor, Normalized, Signal, WorklogEvent } from "../ingest/types";
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

type User = { login: string; id?: number; type?: string; name?: string };
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
  review?: { id: number; state: string; body?: string | null; html_url: string; user: User; submitted_at?: string };
  comment?: { id: number; body: string; html_url: string; user: User; created_at?: string };
  requested_reviewer?: User;
  assignee?: User;
  release?: { id: number; tag_name: string; name?: string | null; html_url: string; body?: string | null; draft?: boolean; prerelease?: boolean };
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

const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
const WL_REF = /\bWL-(\d+)\b/gi;
const MENTION = /(?:^|[^\w`/])@([a-z0-9](?:[a-z0-9-]{0,38}))/gi;
const MERGE_COMMIT = /^Merge (pull request|branch) |\(#\d+\)\s*$/;

const actorOf = (u?: User | null): ExternalActor | null =>
  u ? { id: u.id != null ? String(u.id) : `handle:${u.login.toLowerCase()}`, handle: u.login, name: u.name ?? null, bot: u.type === "Bot" || /\[bot\]$/i.test(u.login) } : null;

/** A mentioned login, as an actor reference (resolved by login since mentions carry no id). */
const byLogin = (login: string): ExternalActor => ({ id: `handle:${login.toLowerCase()}`, handle: login });

const mentionsIn = (text: string | null | undefined, exclude?: string) =>
  [...new Set([...(text ?? "").matchAll(MENTION)].map((m) => m[1]!.toLowerCase()))]
    .filter((l) => l !== exclude?.toLowerCase())
    .map((l): Signal => ({ type: "mentioned", who: byLogin(l), excerpt: (text ?? "").slice(0, 280) }));

const wlRefs = (...texts: (string | null | undefined)[]) => [...new Set(texts.flatMap((t) => [...(t ?? "").matchAll(WL_REF)].map((m) => Number(m[1]))))];
const closesKeys = (ns: string, repo: string, body?: string | null) => [...(body ?? "").matchAll(CLOSES)].map((m) => `${ns}:${repo}#${m[1]}`);

/** Normalizer shared by GitHub and GitHub-compatible forges. `ns` prefixes keys: "github" or "gitea:git.example.com". */
export function normalizeGithubLike(ns: string, eventType: string, p: Payload, receivedAt: Date, settings: { repos?: unknown }): Normalized {
  const repo = p.repository?.full_name;
  if (!repo) return { events: [], ignored: `${eventType}: no repository` };
  const repos = Array.isArray(settings.repos) ? (settings.repos as string[]) : [];
  if (repos.length && !repos.includes(repo)) return { events: [], ignored: `repository ${repo} isn't tracked` };
  const actor = actorOf(p.sender);
  const container = { type: "repo", key: `${ns}:${repo}`, name: repo };
  const at = (iso?: string | null) => (iso ? new Date(iso) : receivedAt);
  const ref = (n: number) => `${repo}#${n}`;
  const key = (n: number) => `${ns}:${repo}#${n}`;
  const event = (e: Omit<WorklogEvent, "actor" | "container">): WorklogEvent => ({ actor, container, ...e });

  switch (eventType) {
    case "push": {
      if (p.deleted) return { events: [], ignored: "branch deleted" };
      if (!p.ref?.startsWith("refs/heads/")) return { events: [], ignored: "tag push" };
      if (p.forced) return { events: [], ignored: "force push (rewritten history isn't new work)" };
      const branch = p.ref.slice("refs/heads/".length);
      const commits = (p.commits ?? []).filter((c) => c.distinct !== false);
      if (!commits.length) return { events: [], ignored: "no new commits" };
      const total = Math.max(commits.length, p.total_commits ?? 0);
      const isDefault = branch === (p.repository?.default_branch ?? "main");
      if (isDefault && commits.every((c) => MERGE_COMMIT.test(c.message.split("\n")[0]!))) {
        return { events: [], ignored: "merge commits on the default branch (the PR merge already says it)" };
      }
      return {
        events: [
          event({
            id: `push:${repo}:${p.after}`,
            kind: "code.pushed",
            occurredAt: at(p.head_commit?.timestamp),
            title: `Pushed ${total} commit${total === 1 ? "" : "s"} to ${repo}:${branch}`,
            body: commits.slice(0, 8).map((c) => `• ${c.message.split("\n")[0]}`).join("\n"),
            url: p.compare,
            thread: `${ns}:${repo}:branch:${branch}`,
            object: { type: "branch", key: `${ns}:${repo}:branch:${branch}`, title: `${repo}:${branch}` },
            cardRefs: { numbers: wlRefs(branch, ...commits.map((c) => c.message)) },
            coalesce: { key: `push:${ns}:${repo}:${branch}:${actor?.id}`, windowMinutes: 60, units: total, template: `Pushed {n} commit{s} to ${repo}:${branch}` },
            importance: isDefault ? 0.4 : 0.3,
          }),
        ],
      };
    }

    case "pull_request": {
      const pr = p.pull_request!;
      const n = pr.number;
      const object = { type: "pull_request", key: key(n), title: `${ref(n)} ${pr.title}`, url: pr.html_url };
      const base = { thread: key(n), object, url: pr.html_url, cardRefs: { externalKeys: closesKeys(ns, repo, pr.body), numbers: wlRefs(pr.title, pr.body) } };
      switch (p.action) {
        case "opened":
        case "reopened":
        case "ready_for_review": {
          if (pr.draft) return { events: [], ignored: "draft pull request" };
          const verb = p.action === "reopened" ? "Reopened" : "Opened";
          return {
            events: [
              event({
                ...base,
                id: `pr:${key(n)}:${p.action}:${pr.updated_at ?? receivedAt.toISOString()}`,
                kind: "pr.opened",
                occurredAt: at(pr.updated_at),
                title: `${verb} PR ${ref(n)}: ${pr.title}`,
                body: pr.body?.slice(0, 600) ?? null,
                signals: [
                  ...(pr.requested_reviewers ?? []).map((u): Signal => ({ type: "review_requested", who: actorOf(u)! })),
                  ...mentionsIn(pr.body, p.sender?.login),
                ],
              }),
            ],
          };
        }
        case "closed": {
          const merged = Boolean(pr.merged);
          return {
            events: [
              event({
                ...base,
                id: `pr:${key(n)}:closed:${pr.closed_at ?? ""}`,
                kind: merged ? "pr.merged" : "pr.closed",
                occurredAt: at(pr.merged_at ?? pr.closed_at),
                title: `${merged ? "Merged" : "Closed"} PR ${ref(n)}: ${pr.title}`,
                // Nobody needs to review a closed PR any more.
                signals: [{ type: "resolve", what: "review_requested" }],
              }),
            ],
          };
        }
        case "review_requested":
          if (!p.requested_reviewer) return { events: [], ignored: "review requested from a team" };
          return {
            events: [
              event({
                ...base,
                id: `pr:${key(n)}:review_requested:${p.requested_reviewer.id ?? p.requested_reviewer.login}:${pr.updated_at ?? receivedAt.toISOString()}`,
                kind: "review.requested",
                occurredAt: at(pr.updated_at),
                title: `Asked @${p.requested_reviewer.login} to review ${ref(n)}: ${pr.title}`,
                signals: [{ type: "review_requested", who: actorOf(p.requested_reviewer)! }],
              }),
            ],
          };
        case "review_request_removed":
          if (!p.requested_reviewer) return { events: [], ignored: "team review request removed" };
          return {
            events: [
              event({
                ...base,
                id: `pr:${key(n)}:rr-removed:${p.requested_reviewer.id ?? p.requested_reviewer.login}:${pr.updated_at ?? receivedAt.toISOString()}`,
                kind: "review.unrequested",
                occurredAt: at(pr.updated_at),
                title: `Review request removed on ${ref(n)}`,
                hidden: true,
                signals: [{ type: "resolve", who: actorOf(p.requested_reviewer)!, what: "review_requested" }],
              }),
            ],
          };
        case "assigned":
          if (!p.assignee) return { events: [], ignored: "no assignee" };
          return {
            events: [
              event({
                ...base,
                id: `pr:${key(n)}:assigned:${p.assignee.id ?? p.assignee.login}:${pr.updated_at ?? receivedAt.toISOString()}`,
                kind: "pr.assigned",
                occurredAt: at(pr.updated_at),
                title: `Assigned ${ref(n)} to @${p.assignee.login}`,
                hidden: true,
                signals: [{ type: "assigned", who: actorOf(p.assignee)! }],
              }),
            ],
          };
        default:
          return { events: [], ignored: `pull_request.${p.action} (not a work signal)` };
      }
    }

    case "pull_request_review": {
      if (p.action !== "submitted" || !p.review || !p.pull_request) return { events: [], ignored: `pull_request_review.${p.action}` };
      const pr = p.pull_request;
      const n = pr.number;
      const state = p.review.state.toLowerCase();
      const body = p.review.body?.trim() ?? "";
      if (state === "commented" && !body) return { events: [], ignored: "empty review (its inline comments arrive separately)" };
      const verb = state === "approved" ? "Approved" : state === "changes_requested" ? "Requested changes on" : "Reviewed";
      const author = actorOf(pr.user);
      const reviewState: "approved" | "changes_requested" | "commented" =
        state === "approved" || state === "changes_requested" ? state : "commented";
      const signals: Signal[] = [...mentionsIn(body, p.sender?.login)];
      if (author && author.id !== actor?.id) signals.push({ type: "review_result", who: author, state: reviewState });
      if (actor) signals.push({ type: "resolve", who: actor, what: "review_requested" });
      return {
        events: [
          event({
            id: `review:${ns}:${p.review.id}`,
            kind: "review.submitted",
            occurredAt: at(p.review.submitted_at),
            title: `${verb} ${ref(n)}: ${pr.title}`,
            body: body.slice(0, 600) || null,
            url: p.review.html_url,
            thread: key(n),
            object: { type: "pull_request", key: key(n), title: `${ref(n)} ${pr.title}`, url: pr.html_url },
            importance: state === "commented" ? 0.35 : undefined,
            data: { state },
            signals,
          }),
        ],
      };
    }

    case "pull_request_review_comment":
    case "issue_comment": {
      if (p.action !== "created" || !p.comment) return { events: [], ignored: `${eventType}.${p.action}` };
      const item = (p.issue ?? p.pull_request)!;
      const n = item.number;
      const isPr = eventType === "pull_request_review_comment" || Boolean(p.issue?.pull_request);
      return {
        events: [
          event({
            id: `comment:${ns}:${p.comment.id}`,
            kind: "comment.created",
            occurredAt: at(p.comment.created_at),
            title: `Commented on ${ref(n)}: ${item.title}`,
            body: p.comment.body.slice(0, 500),
            url: p.comment.html_url,
            thread: key(n),
            object: { type: isPr ? "pull_request" : "issue", key: key(n), title: `${ref(n)} ${item.title}`, url: item.html_url },
            cardRefs: { externalKeys: [key(n)], numbers: wlRefs(p.comment.body) },
            coalesce: { key: `comments:${key(n)}:${actor?.id}`, windowMinutes: 30, units: 1, template: `Left {n} comment{s} on ${ref(n)}: ${item.title}` },
            signals: mentionsIn(p.comment.body, p.sender?.login),
          }),
        ],
      };
    }

    case "issues": {
      const issue = p.issue!;
      const n = issue.number;
      const object = { type: "issue", key: key(n), title: `${ref(n)} ${issue.title}`, url: issue.html_url };
      const base = { thread: key(n), object, url: issue.html_url, cardRefs: { externalKeys: [key(n)] } };
      switch (p.action) {
        case "opened":
          return {
            events: [
              event({
                ...base,
                id: `issue:${key(n)}:opened`,
                kind: "issue.opened",
                occurredAt: at(issue.updated_at),
                title: `Opened issue ${ref(n)}: ${issue.title}`,
                body: issue.body?.slice(0, 600) ?? null,
                board: [{ type: "upsert_card", externalKey: key(n), title: issue.title, body: issue.body ?? null, url: issue.html_url }],
                signals: mentionsIn(issue.body, p.sender?.login),
              }),
            ],
          };
        case "closed":
          return {
            events: [
              event({
                ...base,
                id: `issue:${key(n)}:closed:${issue.closed_at ?? issue.updated_at ?? receivedAt.toISOString()}`,
                kind: "issue.closed",
                occurredAt: at(issue.closed_at ?? issue.updated_at),
                title: `Closed issue ${ref(n)}: ${issue.title}`,
                board: [{ type: "close_card", externalKey: key(n) }],
                signals: [{ type: "resolve", what: "assigned" }],
              }),
            ],
          };
        case "reopened":
          return {
            events: [
              event({
                ...base,
                id: `issue:${key(n)}:reopened:${issue.updated_at ?? receivedAt.toISOString()}`,
                kind: "issue.reopened",
                occurredAt: at(issue.updated_at),
                title: `Reopened issue ${ref(n)}: ${issue.title}`,
                board: [{ type: "reopen_card", externalKey: key(n) }],
              }),
            ],
          };
        case "assigned":
          if (!p.assignee) return { events: [], ignored: "no assignee" };
          return {
            events: [
              event({
                ...base,
                id: `issue:${key(n)}:assigned:${p.assignee.id ?? p.assignee.login}:${issue.updated_at ?? receivedAt.toISOString()}`,
                kind: "issue.assigned",
                occurredAt: at(issue.updated_at),
                title: `Assigned ${ref(n)} to @${p.assignee.login}`,
                hidden: true,
                board: [{ type: "assign_card", externalKey: key(n), who: actorOf(p.assignee)! }],
                signals: [{ type: "assigned", who: actorOf(p.assignee)! }],
              }),
            ],
          };
        default:
          return { events: [], ignored: `issues.${p.action} (not a work signal)` };
      }
    }

    case "release": {
      const r = p.release;
      if (p.action !== "published" || !r || r.draft) return { events: [], ignored: `release.${p.action}` };
      return {
        events: [
          event({
            id: `release:${ns}:${r.id}`,
            kind: "release.published",
            occurredAt: receivedAt,
            title: `Released ${repo} ${r.name || r.tag_name}${r.prerelease ? " (pre-release)" : ""}`,
            body: r.body?.slice(0, 800) ?? null,
            url: r.html_url,
            thread: `${ns}:${repo}:releases`,
            importance: r.prerelease ? 0.6 : undefined,
          }),
        ],
      };
    }

    default:
      return { events: [], ignored: `${eventType} (not a work signal)` };
  }
}

const SETTINGS_DOC = [
  { key: "boardId", description: "Board where new issues land as cards in Maybe? (optional)" },
  { key: "repos", description: 'Only these repositories, e.g. ["acme/api"] (optional; default all)' },
  { key: "bots", description: '"quiet" (default: keep only bot PRs/releases), "drop", or "keep"' },
  { key: "ignoreKinds", description: 'Event kinds to never record, e.g. ["code.pushed"]' },
];

const digest = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

export const githubConnector: Connector = {
  id: "github",
  name: "GitHub",
  description: "Pull requests, reviews, issues, comments, pushes and releases. Review requests, assignments and @mentions become attention items.",
  secrets: [{ key: "webhookSecret", required: true, description: "The webhook's secret (Settings → Webhooks)" }],
  settings: SETTINGS_DOC,
  endpoints: { webhook: "" },
  identityNamespace: () => "github",
  receive(req, conn) {
    const signature = req.headers.get("x-hub-signature-256") ?? undefined;
    if (!signature || !safeEqual(signature, `sha256=${hmacHex(conn.secrets.webhookSecret!, req.rawBody)}`)) {
      return { type: "reject", status: 401, error: "bad signature" };
    }
    const eventType = req.headers.get("x-github-event") ?? "unknown";
    if (eventType === "ping") return { type: "respond", body: { ok: true } };
    return { type: "event", eventType, deliveryId: req.headers.get("x-github-delivery") ?? digest(req.rawBody), payload: JSON.parse(req.rawBody) };
  },
  normalize: ({ eventType, payload, receivedAt }, conn) => normalizeGithubLike("github", eventType, payload as Payload, receivedAt, conn.settings),
};

function hostOf(conn: ConnectionView) {
  try {
    return new URL(String(conn.settings.baseUrl ?? "")).host;
  } catch {
    return conn.id;
  }
}

/** Self-hosted Gitea / Forgejo: same payloads, different headers, and its own identity namespace per server. */
export const giteaConnector: Connector = {
  id: "gitea",
  name: "Gitea / Forgejo (self-hosted)",
  description: "For self-hosted Gitea or Forgejo. GitHub-compatible webhooks, mapped with the same rules as GitHub.",
  secrets: [{ key: "webhookSecret", required: true, description: "The webhook's secret" }],
  settings: [{ key: "baseUrl", description: "Your server, e.g. https://git.example.com (namespaces identities and links)" }, ...SETTINGS_DOC],
  endpoints: { webhook: "" },
  identityNamespace: (conn) => `gitea:${hostOf(conn)}`,
  receive(req, conn) {
    const signature = req.headers.get("x-forgejo-signature") ?? req.headers.get("x-gitea-signature") ?? undefined;
    if (!signature || !safeEqual(signature, hmacHex(conn.secrets.webhookSecret!, req.rawBody))) return { type: "reject", status: 401, error: "bad signature" };
    const eventType = req.headers.get("x-forgejo-event") ?? req.headers.get("x-gitea-event") ?? "unknown";
    const deliveryId = req.headers.get("x-forgejo-delivery") ?? req.headers.get("x-gitea-delivery") ?? digest(req.rawBody);
    return { type: "event", eventType, deliveryId, payload: JSON.parse(req.rawBody) };
  },
  normalize: ({ eventType, payload, receivedAt }, conn) => normalizeGithubLike(`gitea:${hostOf(conn)}`, eventType, payload as Payload, receivedAt, conn.settings),
};
