import { z } from "zod";

import type {
  ExternalActor,
  Normalized,
  Signal,
  WorklogEvent,
} from "#connectors/types";

const optional = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((v) => v ?? undefined);

const UserSchema = z.object({
  id: optional(z.number()),
  username: z.string(),
  name: optional(z.string()),
  avatar_url: optional(z.string()),
});

const ProjectSchema = z.object({
  id: optional(z.number()),
  path_with_namespace: z.string(),
  web_url: optional(z.string()),
  default_branch: optional(z.string()),
});

const ChangeSchema = z.object({
  previous: optional(z.array(UserSchema)),
  current: optional(z.array(UserSchema)),
});

const AttributesSchema = z
  .object({
    id: optional(z.number()),
    iid: optional(z.number()),
    title: optional(z.string()),
    description: optional(z.string()),
    note: optional(z.string()),
    noteable_type: optional(z.string()),
    url: optional(z.string()),
    state: optional(z.string()),
    action: optional(z.string()),
    draft: optional(z.boolean()),
    work_in_progress: optional(z.boolean()),
    confidential: optional(z.boolean()),
    internal: optional(z.boolean()),
    system: optional(z.boolean()),
    author_id: optional(z.number()),
    created_at: optional(z.string()),
    updated_at: optional(z.string()),
    closed_at: optional(z.string()),
  })
  .loose();

const ItemSchema = z
  .object({
    iid: z.number(),
    title: z.string(),
    url: optional(z.string()),
    author_id: optional(z.number()),
    confidential: optional(z.boolean()),
  })
  .loose();

const PayloadSchema = z
  .object({
    object_kind: optional(z.string()),
    event_type: optional(z.string()),
    user: optional(UserSchema),
    project: optional(ProjectSchema),
    object_attributes: optional(AttributesSchema),
    reviewers: optional(z.array(UserSchema)),
    assignees: optional(z.array(UserSchema)),
    changes: optional(
      z
        .object({
          reviewers: optional(ChangeSchema),
          assignees: optional(ChangeSchema),
          draft: optional(
            z.object({
              previous: optional(z.boolean()),
              current: optional(z.boolean()),
            })
          ),
        })
        .loose()
    ),
    merge_request: optional(ItemSchema),
    issue: optional(ItemSchema),
    ref: optional(z.string()),
    before: optional(z.string()),
    after: optional(z.string()),
    user_id: optional(z.number()),
    user_username: optional(z.string()),
    user_name: optional(z.string()),
    user_avatar: optional(z.string()),
    total_commits_count: optional(z.number()),
    commits: optional(
      z.array(
        z.object({
          id: z.string(),
          message: z.string(),
          timestamp: optional(z.string()),
        })
      )
    ),
    action: optional(z.string()),
    tag: optional(z.string()),
    name: optional(z.string()),
    description: optional(z.string()),
    url: optional(z.string()),
    released_at: optional(z.string()),
    created_at: optional(z.string()),
  })
  .loose();

export type GitlabPayload = z.infer<typeof PayloadSchema>;
/** A payload as GitLab sends it, or as a sync page rebuilds one. */
export type GitlabInput = z.input<typeof PayloadSchema>;
export type GitlabUser = z.infer<typeof UserSchema>;

export function parseGitlab(payload: unknown): GitlabPayload {
  const parsed = PayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : PayloadSchema.parse({});
}

const NO_COMMIT = /^0+$/u;
const CLOSES =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|implement(?:s|ed)?)\s+#(?<number>\d+)/giu;
const WL_REF = /\bWL-(?<number>\d+)\b/giu;
const MENTION =
  /(?:^|[^\w`/])@(?<login>[a-z0-9_](?:[a-z0-9_.-]*[a-z0-9_])?)/giu;
const GROUP_MENTIONS = new Set(["all", "here", "channel"]);
const MERGE_COMMIT = /^Merge branch '.+' into '.+'|See merge request \S+!\d+/u;
const BOT = /^(?:project|group)_\d+_bot|[-_]bot$/iu;

export const actorFor = (u: GitlabUser): ExternalActor => ({
  id: u.id === undefined ? `handle:${u.username.toLowerCase()}` : String(u.id),
  handle: u.username,
  name: u.name ?? null,
  bot: BOT.test(u.username),
  avatarUrl: u.avatar_url ?? null,
});

const byLogin = (login: string): ExternalActor => ({
  id: `handle:${login.toLowerCase()}`,
  handle: login,
});

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
    .filter((l) => l !== exclude?.toLowerCase() && !GROUP_MENTIONS.has(l))
    .map((l): Signal => ({
      type: "mentioned",
      who: byLogin(l),
      excerpt: (text ?? "").slice(0, 280),
    }));

const wlRefs = (...texts: (string | null | undefined)[]) => [
  ...new Set(texts.flatMap((t) => captures(t, WL_REF, "number").map(Number))),
];

const firstLine = (message: string) => message.split("\n", 1)[0] ?? "";

const ignore = (reason: string): Normalized => ({
  events: [],
  ignored: reason,
});

export function gitlabTime(value: string | undefined) {
  const iso = value?.replace(" UTC", "Z").replace(" ", "T") ?? "";
  const parsed = Number.isNaN(Date.parse(value ?? ""))
    ? Date.parse(iso)
    : Date.parse(value ?? "");
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

type Delivery = {
  ns: string;
  path: string;
  p: GitlabPayload;
  actor: ExternalActor | null;
  at: (value?: string) => Date;
  stamp: (value?: string) => string;
  mrRef: (iid: number) => string;
  issueRef: (iid: number) => string;
  mrKey: (iid: number) => string;
  issueKey: (iid: number) => string;
  event: (e: Omit<WorklogEvent, "actor" | "container">) => WorklogEvent;
};

const EVENTS = new Map<string, (d: Delivery) => Normalized>([
  ["push", onPush],
  ["merge_request", onMergeRequest],
  ["note", onNote],
  ["issue", onIssue],
  ["release", onRelease],
]);

/**
 * GitLab's webhooks (gitlab.com or self-managed), mapped to the same kinds, signals and board
 * effects as GitHub's, so the stream, attention and cards read the same whichever forge a team
 * uses. Merge requests key as `!5` and issues as `#5`: GitLab numbers them separately.
 */
export function normalizeGitlab(
  ns: string,
  eventType: string,
  payload: unknown,
  receivedAt: Date,
  settings: { repos?: unknown }
): Normalized {
  const p = parseGitlab(payload);
  const path = p.project?.path_with_namespace;
  if (!path) {
    return ignore(`${eventType}: no project`);
  }
  const repos = Array.isArray(settings.repos)
    ? settings.repos.filter((r: unknown): r is string => typeof r === "string")
    : [];
  if (repos.length && !repos.includes(path)) {
    return ignore(`project ${path} isn't tracked`);
  }
  const handler = EVENTS.get(eventType);
  if (!handler) {
    return ignore(`${eventType} (not a work signal)`);
  }
  const actor = actorOfPayload(p);
  const container = { type: "repo", key: `${ns}:${path}`, name: path };
  return handler({
    ns,
    path,
    p,
    actor,
    at: (value) => gitlabTime(value) ?? receivedAt,
    stamp: (value) => (gitlabTime(value) ?? receivedAt).toISOString(),
    mrRef: (iid) => `${path}!${iid}`,
    issueRef: (iid) => `${path}#${iid}`,
    mrKey: (iid) => `${ns}:${path}!${iid}`,
    issueKey: (iid) => `${ns}:${path}#${iid}`,
    event: (e) => ({ actor, container, ...e }),
  });
}

function actorOfPayload(p: GitlabPayload) {
  if (p.user) {
    return actorFor(p.user);
  }
  return p.user_username
    ? actorFor({
        id: p.user_id,
        username: p.user_username,
        name: p.user_name,
        avatar_url: p.user_avatar,
      })
    : null;
}

function onPush({ ns, path, p, actor, at, event }: Delivery): Normalized {
  const gitRef = p.ref ?? "";
  if (!gitRef.startsWith("refs/heads/")) {
    return ignore("not a branch");
  }
  if (!p.after || NO_COMMIT.test(p.after)) {
    return ignore("branch deleted");
  }
  const branch = gitRef.slice("refs/heads/".length);
  const commits = p.commits ?? [];
  if (!commits.length) {
    return ignore("no new commits");
  }
  const total = Math.max(commits.length, p.total_commits_count ?? 0);
  const isDefault = branch === (p.project?.default_branch ?? "main");
  if (isDefault && commits.every((c) => MERGE_COMMIT.test(c.message))) {
    return ignore(
      "merge commits on the default branch (the merge request already says it)"
    );
  }
  const compare =
    p.project?.web_url && p.before && !NO_COMMIT.test(p.before)
      ? `${p.project.web_url}/-/compare/${p.before}...${p.after}`
      : null;
  return {
    events: [
      event({
        id: `push:${path}:${p.after}`,
        kind: "code.pushed",
        occurredAt: at(commits.at(-1)?.timestamp),
        title: `Pushed ${total} commit${total === 1 ? "" : "s"} to ${path}:${branch}`,
        body: commits
          .slice(-8)
          .map((c) => `• ${firstLine(c.message)}`)
          .join("\n"),
        url: compare,
        thread: `${ns}:${path}:branch:${branch}`,
        object: {
          type: "branch",
          key: `${ns}:${path}:branch:${branch}`,
          title: `${path}:${branch}`,
        },
        cardRefs: {
          numbers: wlRefs(branch, ...commits.map((c) => c.message)),
        },
        coalesce: {
          key: `push:${ns}:${path}:${branch}:${actor?.id}`,
          windowMinutes: 60,
          units: total,
          template: `Pushed {n} commit{s} to ${path}:${branch}`,
        },
        importance: isDefault ? 0.4 : 0.3,
      }),
    ],
  };
}

const added = (change?: z.infer<typeof ChangeSchema>) => {
  const before = new Set((change?.previous ?? []).map((u) => u.username));
  return (change?.current ?? []).filter((u) => !before.has(u.username));
};

const removed = (change?: z.infer<typeof ChangeSchema>) =>
  added(
    change ? { previous: change.current, current: change.previous } : undefined
  );

function onMergeRequest(d: Delivery): Normalized {
  const { p, actor, at, stamp, mrRef, mrKey, issueKey, event } = d;
  const mr = p.object_attributes;
  if (mr?.iid === undefined || !mr.title) {
    return ignore("merge_request without a merge request");
  }
  const { iid, title } = mr;
  const draft = mr.draft === true || mr.work_in_progress === true;
  const common = {
    thread: mrKey(iid),
    object: {
      type: "pull_request",
      key: mrKey(iid),
      title: `${mrRef(iid)} ${title}`,
      url: mr.url ?? null,
    },
    url: mr.url ?? null,
    cardRefs: {
      externalKeys: captures(mr.description, CLOSES, "number").map((n) =>
        issueKey(Number(n))
      ),
      numbers: wlRefs(title, mr.description),
    },
  };
  const opened = (id: string, verb: string, when?: string): Normalized =>
    draft
      ? ignore("draft merge request")
      : {
          events: [
            event({
              ...common,
              id,
              kind: "pr.opened",
              occurredAt: at(when),
              title: `${verb} MR ${mrRef(iid)}: ${title}`,
              body: mr.description?.slice(0, 600) ?? null,
              signals: [
                ...(p.reviewers ?? []).map((u): Signal => ({
                  type: "review_requested",
                  who: actorFor(u),
                })),
                ...mentionsIn(mr.description, actor?.handle ?? undefined),
              ],
            }),
          ],
        };
  switch (mr.action ?? "") {
    case "open": {
      return opened(`mr:${mrKey(iid)}:opened`, "Opened", mr.created_at);
    }
    case "reopen": {
      return opened(
        `mr:${mrKey(iid)}:reopened:${stamp(mr.updated_at)}`,
        "Reopened",
        mr.updated_at
      );
    }
    case "merge":
    case "close": {
      const merged = mr.action === "merge";
      return {
        events: [
          event({
            ...common,
            id: `mr:${mrKey(iid)}:${merged ? "merged" : "closed"}`,
            kind: merged ? "pr.merged" : "pr.closed",
            occurredAt: at(mr.updated_at),
            title: `${merged ? "Merged" : "Closed"} MR ${mrRef(iid)}: ${title}`,
            signals: [{ type: "resolve", what: "review_requested" }],
          }),
        ],
      };
    }
    case "approval":
    case "approved": {
      return onApproval(d, iid, title, common);
    }
    case "update": {
      return onMergeRequestUpdate(d, iid, title, common, opened, draft);
    }
    default: {
      return ignore(`merge_request.${mr.action} (not a work signal)`);
    }
  }
}

function onApproval(
  { p, actor, at, stamp, mrRef, mrKey, event }: Delivery,
  iid: number,
  title: string,
  common: MrCommon
): Normalized {
  if (!actor) {
    return ignore("approval without an approver");
  }
  const mr = p.object_attributes;
  const signals: Signal[] = [
    { type: "resolve", who: actor, what: "review_requested" },
  ];
  if (mr?.author_id !== undefined && String(mr.author_id) !== actor.id) {
    signals.push({
      type: "review_result",
      who: { id: String(mr.author_id) },
      state: "approved",
    });
  }
  return {
    events: [
      event({
        id: `approval:${mrKey(iid)}:${actor.id}:${stamp(mr?.updated_at)}`,
        kind: "review.submitted",
        occurredAt: at(mr?.updated_at),
        title: `Approved ${mrRef(iid)}: ${title}`,
        url: mr?.url ?? null,
        thread: mrKey(iid),
        object: common.object,
        data: { state: "approved" },
        signals,
      }),
    ],
  };
}

type MrCommon = {
  thread: string;
  object: { type: string; key: string; title: string; url: string | null };
  url: string | null;
  cardRefs: { externalKeys: string[]; numbers: number[] };
};

function onMergeRequestUpdate(
  { p, at, stamp, mrRef, mrKey, event }: Delivery,
  iid: number,
  title: string,
  common: MrCommon,
  opened: (id: string, verb: string, when?: string) => Normalized,
  draft: boolean
): Normalized {
  const { changes } = p;
  const updated = p.object_attributes?.updated_at;
  if (changes?.draft?.previous === true && !draft) {
    return opened(`mr:${mrKey(iid)}:opened`, "Opened", updated);
  }
  const events: WorklogEvent[] = [
    ...added(changes?.reviewers).map((u) =>
      event({
        ...common,
        id: `mr:${mrKey(iid)}:review_requested:${actorFor(u).id}:${stamp(updated)}`,
        kind: "review.requested",
        occurredAt: at(updated),
        title: `Asked @${u.username} to review ${mrRef(iid)}: ${title}`,
        signals: [{ type: "review_requested", who: actorFor(u) }],
      })
    ),
    ...removed(changes?.reviewers).map((u) =>
      event({
        ...common,
        id: `mr:${mrKey(iid)}:rr-removed:${actorFor(u).id}:${stamp(updated)}`,
        kind: "review.unrequested",
        occurredAt: at(updated),
        title: `Review request removed on ${mrRef(iid)}`,
        hidden: true,
        signals: [
          { type: "resolve", who: actorFor(u), what: "review_requested" },
        ],
      })
    ),
    ...added(changes?.assignees).map((u) =>
      event({
        ...common,
        id: `mr:${mrKey(iid)}:assigned:${actorFor(u).id}:${stamp(updated)}`,
        kind: "pr.assigned",
        occurredAt: at(updated),
        title: `Assigned ${mrRef(iid)} to @${u.username}`,
        hidden: true,
        signals: [{ type: "assigned", who: actorFor(u) }],
      })
    ),
  ];
  return events.length
    ? { events }
    : ignore("merge_request.update (not a work signal)");
}

function isConfidentialNote(p: GitlabPayload) {
  const note = p.object_attributes;
  return (
    note?.internal === true ||
    note?.confidential === true ||
    p.event_type === "confidential_note" ||
    p.issue?.confidential === true
  );
}

function onNote({
  ns,
  p,
  actor,
  at,
  mrRef,
  issueRef,
  mrKey,
  issueKey,
  event,
}: Delivery): Normalized {
  const note = p.object_attributes;
  if (!note?.note || note.id === undefined) {
    return ignore("note without a comment");
  }
  if (note.system === true) {
    return ignore("system note");
  }
  if (isConfidentialNote(p)) {
    return ignore("confidential note");
  }
  const onMr = note.noteable_type === "MergeRequest";
  const item = onMr ? p.merge_request : p.issue;
  if (item === undefined || (!onMr && note.noteable_type !== "Issue")) {
    return ignore(
      `note on a ${note.noteable_type ?? "thing"} (not a work signal)`
    );
  }
  const key = onMr ? mrKey(item.iid) : issueKey(item.iid);
  const ref = onMr ? mrRef(item.iid) : issueRef(item.iid);
  return {
    events: [
      event({
        id: `note:${ns}:${note.id}`,
        kind: "comment.created",
        occurredAt: at(note.created_at),
        title: `Commented on ${ref}: ${item.title}`,
        body: note.note.slice(0, 500),
        url: note.url ?? null,
        thread: key,
        object: {
          type: onMr ? "pull_request" : "issue",
          key,
          title: `${ref} ${item.title}`,
          url: item.url ?? null,
        },
        cardRefs: { externalKeys: [key], numbers: wlRefs(note.note) },
        coalesce: {
          key: `comments:${key}:${actor?.id}`,
          windowMinutes: 30,
          units: 1,
          template: `Left {n} comment{s} on ${ref}: ${item.title}`,
        },
        signals: mentionsIn(note.note, actor?.handle ?? undefined),
      }),
    ],
  };
}

type IssueCommon = {
  thread: string;
  object: { type: string; key: string; title: string; url: string | null };
  url: string | null;
  cardRefs: { externalKeys: string[] };
};

function onIssueAssigned(
  { p, at, stamp, issueRef, event }: Delivery,
  iid: number,
  title: string,
  common: IssueCommon
): Normalized {
  const updated = p.object_attributes?.updated_at;
  const events = added(p.changes?.assignees).map((u) => {
    const who = actorFor(u);
    return event({
      ...common,
      id: `issue:${common.thread}:assigned:${who.id}:${stamp(updated)}`,
      kind: "issue.assigned",
      occurredAt: at(updated),
      title: `Assigned ${issueRef(iid)} to @${u.username}`,
      hidden: true,
      board: [{ type: "assign_card", externalKey: common.thread, who }],
      signals: [{ type: "assigned", who }],
    });
  });
  return events.length
    ? { events }
    : ignore(`issue.update on ${title} (not a work signal)`);
}

function onIssue(d: Delivery): Normalized {
  const { p, actor, at, stamp, issueRef, issueKey, event } = d;
  const issue = p.object_attributes;
  if (issue?.iid === undefined || !issue.title) {
    return ignore("issue without an issue");
  }
  if (issue.confidential === true || p.event_type === "confidential_issue") {
    return ignore("confidential issue");
  }
  const { iid, title } = issue;
  const key = issueKey(iid);
  const common = {
    thread: key,
    object: {
      type: "issue",
      key,
      title: `${issueRef(iid)} ${title}`,
      url: issue.url ?? null,
    },
    url: issue.url ?? null,
    cardRefs: { externalKeys: [key] },
  };
  switch (issue.action ?? "") {
    case "open": {
      return {
        events: [
          event({
            ...common,
            id: `issue:${key}:opened`,
            kind: "issue.opened",
            occurredAt: at(issue.created_at),
            title: `Opened issue ${issueRef(iid)}: ${title}`,
            body: issue.description?.slice(0, 600) ?? null,
            board: [
              {
                type: "upsert_card",
                externalKey: key,
                title,
                body: issue.description ?? null,
                url: issue.url ?? null,
              },
            ],
            signals: mentionsIn(issue.description, actor?.handle ?? undefined),
          }),
        ],
      };
    }
    case "close": {
      const when = issue.closed_at ?? issue.updated_at;
      return {
        events: [
          event({
            ...common,
            id: `issue:${key}:closed:${stamp(when)}`,
            kind: "issue.closed",
            occurredAt: at(when),
            title: `Closed issue ${issueRef(iid)}: ${title}`,
            board: [{ type: "close_card", externalKey: key }],
            signals: [{ type: "resolve", what: "assigned" }],
          }),
        ],
      };
    }
    case "reopen": {
      return {
        events: [
          event({
            ...common,
            id: `issue:${key}:reopened:${stamp(issue.updated_at)}`,
            kind: "issue.reopened",
            occurredAt: at(issue.updated_at),
            title: `Reopened issue ${issueRef(iid)}: ${title}`,
            board: [{ type: "reopen_card", externalKey: key }],
          }),
        ],
      };
    }
    case "update": {
      return onIssueAssigned(d, iid, title, common);
    }
    default: {
      return ignore(`issue.${issue.action} (not a work signal)`);
    }
  }
}

function onRelease({ ns, path, p, at, event }: Delivery): Normalized {
  if (p.action !== "create" || !p.tag) {
    return ignore(`release.${p.action}`);
  }
  return {
    events: [
      event({
        id: `release:${ns}:${path}:${p.tag}`,
        kind: "release.published",
        occurredAt: at(p.released_at ?? p.created_at),
        title: `Released ${path} ${p.name ?? p.tag}`,
        body: p.description?.slice(0, 800) ?? null,
        url: p.url ?? null,
        thread: `${ns}:${path}:releases`,
      }),
    ],
  };
}
