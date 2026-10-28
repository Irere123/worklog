import { describe, expect, test } from "bun:test";

import { getConnector } from "#connectors";
import type { ConnectionView, WorklogEvent } from "#connectors/types";

// Payloads are only signature-verified, never schema-validated, and a normalizer that throws or
// returns an event Postgres can't store fails its whole delivery on every attempt. So: real-looking
// payloads, broken at random, must still come out as storable events or a reason to ignore them.

const now = new Date("2026-10-27T12:00:00Z");
const user = { login: "emma-gh", id: 101, type: "User" };
const repository = { id: 501, full_name: "acme/api", default_branch: "main" };
const pr = {
  number: 7,
  title: "Retry payments",
  html_url: "https://github.com/acme/api/pull/7",
  user,
  draft: false,
  merged: true,
  body: "Fixes #12",
  created_at: "2026-10-27T10:00:00Z",
  updated_at: "2026-10-27T11:00:00Z",
  closed_at: "2026-10-27T11:00:00Z",
  merged_at: "2026-10-27T11:00:00Z",
  head: { ref: "retry" },
  base: { ref: "main" },
  requested_reviewers: [{ login: "sam-gh", id: 202 }],
};
const issue = {
  number: 12,
  title: "Payments fail on retry",
  html_url: "https://github.com/acme/api/issues/12",
  user,
  state: "open",
  labels: [{ name: "bug" }],
  assignees: [{ login: "sam-gh", id: 202 }],
};
const githubSeeds: [string, unknown][] = [
  [
    "push",
    {
      repository,
      sender: user,
      ref: "refs/heads/retry",
      before: "a".repeat(40),
      after: "b".repeat(40),
      forced: false,
      commits: [
        { id: "1", message: "Add jitter\n\nbody", timestamp: pr.created_at },
        { id: "2", message: "Cap at 5", distinct: true },
      ],
      head_commit: { timestamp: pr.updated_at },
    },
  ],
  [
    "pull_request",
    { action: "opened", repository, sender: user, pull_request: pr },
  ],
  [
    "pull_request",
    { action: "closed", repository, sender: user, pull_request: pr },
  ],
  [
    "pull_request",
    {
      action: "review_requested",
      repository,
      sender: user,
      pull_request: pr,
      requested_reviewer: { login: "sam-gh", id: 202 },
    },
  ],
  [
    "pull_request_review",
    {
      action: "submitted",
      repository,
      sender: user,
      pull_request: pr,
      review: {
        id: 88,
        state: "changes_requested",
        body: "Needs a test @sam-gh",
        html_url: "r",
        user: { login: "sam-gh", id: 202 },
        submitted_at: pr.updated_at,
      },
    },
  ],
  [
    "pull_request_review_comment",
    {
      action: "created",
      repository,
      sender: user,
      pull_request: pr,
      comment: {
        id: 9,
        body: "nit",
        html_url: "c",
        user,
        created_at: pr.created_at,
      },
    },
  ],
  [
    "issue_comment",
    {
      action: "created",
      repository,
      sender: user,
      issue: { ...issue, pull_request: {} },
      comment: {
        id: 7001,
        body: "Looks good @sam-gh, ship it",
        html_url: "c",
        user,
        created_at: pr.created_at,
      },
    },
  ],
  ["issues", { action: "opened", repository, sender: user, issue }],
  // GitHub allows a missing author; the issue still happened.
  [
    "issues",
    {
      action: "opened",
      repository,
      sender: user,
      issue: { ...issue, user: null },
    },
  ],
  ["issues", { action: "closed", repository, sender: user, issue }],
  [
    "issues",
    {
      action: "assigned",
      repository,
      sender: user,
      issue,
      assignee: { login: "sam-gh", id: 202 },
    },
  ],
  [
    "release",
    {
      action: "published",
      repository,
      sender: user,
      release: {
        id: 3,
        tag_name: "v1.2.0",
        name: "1.2",
        html_url: "rel",
        published_at: pr.updated_at,
        author: user,
      },
    },
  ],
  [
    "sync.github",
    {
      repo: repository,
      since: "2026-10-20T00:00:00Z",
      stage: "pulls",
      nodes: [
        {
          number: 7,
          title: "Retry payments",
          url: "https://github.com/acme/api/pull/7",
          isDraft: false,
          state: "MERGED",
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          mergedAt: pr.merged_at,
          closedAt: pr.closed_at,
          author: { __typename: "User", login: "emma-gh", databaseId: 101 },
          mergedBy: { __typename: "User", login: "emma-gh", databaseId: 101 },
          reviewRequests: { nodes: [] },
          comments: { nodes: [] },
          timelineItems: { nodes: [] },
          reviews: {
            nodes: [
              {
                databaseId: 88,
                state: "APPROVED",
                body: "",
                url: "r",
                submittedAt: pr.updated_at,
                author: {
                  __typename: "User",
                  login: "sam-gh",
                  databaseId: 202,
                },
              },
            ],
          },
        },
      ],
    },
  ],
];

const slackEvent = (event: Record<string, unknown>) => ({
  type: "event_callback",
  team_id: "T1",
  event_id: "Ev1",
  event: { channel: "C1", channel_type: "channel", ...event },
});
const slackSeeds: [string, unknown][] = [
  [
    "message",
    slackEvent({
      type: "message",
      user: "U1",
      text: "Shipped the onboarding flow to staging <@U2>",
      ts: "1793150798.000100",
    }),
  ],
  [
    "message",
    slackEvent({
      type: "message",
      user: "U1",
      text: "Rolled the migration back",
      ts: "1793150799.000100",
      thread_ts: "1793150798.000100",
    }),
  ],
  [
    "message",
    slackEvent({
      type: "message",
      subtype: "message_changed",
      message: {
        user: "U1",
        text: "Shipped it, really",
        ts: "1793150798.000100",
      },
      ts: "1793150900.000100",
    }),
  ],
  [
    "message",
    slackEvent({
      type: "message",
      subtype: "message_deleted",
      deleted_ts: "1793150798.000100",
      ts: "1793150901.000100",
    }),
  ],
  [
    "sync.history",
    {
      channel: "C1",
      private: false,
      messages: [
        {
          type: "message",
          user: "U1",
          text: "Shipped the flow",
          ts: "1793150798.000100",
        },
        { type: "message", user: "U1", text: "ok", ts: "1793150799.000100" },
      ],
    },
  ],
];

const discordMessage = {
  id: "11",
  channel_id: "22",
  guild_id: "33",
  author: { id: "44", username: "emma" },
  content: "Shipped the retry queue to production, <@55> can you watch it?",
  timestamp: "2026-10-27T11:00:00Z",
  mentions: [{ id: "55", username: "sam" }],
  message_reference: { message_id: "10" },
};
const discordSeeds: [string, unknown][] = [
  ["MESSAGE_CREATE", discordMessage],
  [
    "MESSAGE_UPDATE",
    { ...discordMessage, edited_timestamp: "2026-10-27T11:05:00Z" },
  ],
  ["MESSAGE_DELETE", { id: "11", channel_id: "22", guild_id: "33" }],
];

const giteaSeeds: [string, unknown][] = [
  ...githubSeeds.filter(([type]) => type !== "sync.github"),
  [
    "pull_request_approved",
    {
      action: "reviewed",
      repository,
      sender: user,
      pull_request: pr,
      review: { type: "pull_request_review_approved", content: "LGTM" },
    },
  ],
  [
    "sync.gitea",
    {
      repo: repository,
      since: "2026-10-20T00:00:00Z",
      stage: "issues",
      items: [
        { ...issue, created_at: pr.created_at, updated_at: pr.updated_at },
      ],
    },
  ],
];

// A self-hosted GitLab through the no-code connector: its rules read whatever paths they name.
const gitlab = {
  verify: { type: "token", header: "X-Gitlab-Token" },
  identityNamespace: "gitlab:git.example.com",
  rules: [
    {
      when: {
        eventType: "Merge Request Hook",
        equals: { "object_attributes.action": "merge" },
      },
      emit: {
        kind: "pr.merged",
        id: "mr:{{project.path_with_namespace}}!{{object_attributes.iid}}:merged",
        title:
          "Merged MR {{project.path_with_namespace}}!{{object_attributes.iid}}: {{object_attributes.title}}",
        url: "{{object_attributes.url}}",
        occurredAt: "{{object_attributes.merged_at}}",
        thread:
          "gitlab:{{project.path_with_namespace}}!{{object_attributes.iid}}",
        actor: {
          id: "{{user.id}}",
          handle: "{{user.username}}",
          name: "{{user.name}}",
        },
        mention: "{{reviewer}}",
      },
    },
  ],
};
const webhookSeeds: [string, unknown][] = [
  [
    "Merge Request Hook",
    {
      object_kind: "merge_request",
      user: { id: 42, username: "emma", name: "Emma" },
      project: { path_with_namespace: "platform/billing" },
      object_attributes: {
        iid: 12,
        title: "Invoice retries",
        action: "merge",
        merged_at: "2026-10-27T11:00:00Z",
        url: "https://git.example.com/platform/billing/-/merge_requests/12",
      },
      reviewer: "sam",
    },
  ],
];

const JUNK: unknown[] = [
  null,
  0,
  -1,
  1.5,
  Number.MAX_SAFE_INTEGER,
  "",
  "x",
  "not a date",
  "2026-13-45T99:99:99Z",
  "99999999999999999999",
  true,
  [],
  {},
  [null],
  { login: null, id: null },
  "a".repeat(20_000),
];

// Deterministic, so a failure can be replayed from its seed. In BigInt: the product overflows a
// double's precision, and then every draw comes out even.
function random(seed: number) {
  let state = BigInt(seed);
  return (n: number) => {
    state =
      (state * 6_364_136_223_846_793_005n + 1_442_695_040_888_963_407n) %
      18_446_744_073_709_551_616n;
    return Math.floor((Number(state / 4_294_967_296n) / 4_294_967_296) * n);
  };
}

type Node = Record<string, unknown> | unknown[];

function containers(value: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(value)) {
    out.push(value);
    for (const v of value) {
      containers(v, out);
    }
  } else if (typeof value === "object" && value !== null) {
    out.push(value as Record<string, unknown>);
    for (const v of Object.values(value)) {
      containers(v, out);
    }
  }
  return out;
}

function mutate(payload: unknown, pick: (n: number) => number) {
  const copy: unknown = structuredClone(payload);
  const times = 1 + pick(3);
  for (let i = 0; i < times; i += 1) {
    const nodes = containers(copy);
    const node = nodes[pick(nodes.length)];
    if (!node) {
      continue;
    }
    const junk: unknown = structuredClone(JUNK[pick(JUNK.length)]);
    if (Array.isArray(node)) {
      if (node.length > 0) {
        node[pick(node.length)] = junk;
      }
      continue;
    }
    const keys = Object.keys(node);
    const key = keys[pick(Math.max(keys.length, 1))];
    if (key === undefined) {
      continue;
    }
    if (pick(4) === 0) {
      Reflect.deleteProperty(node, key);
    } else {
      node[key] = junk;
    }
  }
  return copy;
}

const KIND = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/u;

function storable(event: WorklogEvent) {
  const problems: string[] = [];
  if (typeof event.id !== "string" || event.id.length === 0) {
    problems.push("id");
  }
  if (!KIND.test(event.kind)) {
    problems.push(`kind ${event.kind}`);
  }
  if (
    !(event.occurredAt instanceof Date) ||
    Number.isNaN(event.occurredAt.getTime())
  ) {
    problems.push("occurredAt");
  }
  if (typeof event.title !== "string") {
    problems.push("title");
  }
  return problems;
}

function fuzz(
  provider: string,
  seeds: [string, unknown][],
  settings: Record<string, unknown>
) {
  const connector = getConnector(provider);
  if (!connector) {
    throw new Error(`no ${provider} connector`);
  }
  const conn: ConnectionView = {
    id: "con_fuzz",
    workspaceId: "ws_fuzz",
    provider,
    externalId: null,
    settings,
    secrets: {},
  };
  const failures: string[] = [];
  // Unbroken, every seed is something worth recording: a parser that dropped everything would
  // pass the rest.
  for (const [eventType, payload] of seeds) {
    const out = connector.normalize(
      { eventType, payload, receivedAt: now },
      conn
    );
    if (out.events.length === 0) {
      failures.push(`unbroken ${eventType}: ${out.ignored ?? "no events"}`);
    }
  }
  for (let seed = 1; seed <= 5000; seed += 1) {
    const pick = random(seed);
    const [eventType, original] = seeds[pick(seeds.length)] ?? ["", null];
    const payload = mutate(original, pick);
    try {
      const out = connector.normalize(
        { eventType, payload, receivedAt: now },
        conn
      );
      if (!Array.isArray(out.events)) {
        failures.push(`seed ${seed} ${eventType}: no events array`);
      }
      for (const event of out.events) {
        const problems = storable(event);
        if (problems.length > 0) {
          failures.push(`seed ${seed} ${eventType}: ${problems.join(", ")}`);
        }
      }
    } catch (error) {
      failures.push(
        `seed ${seed} ${eventType}: threw ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return failures;
}

describe("normalizers survive whatever a provider sends", () => {
  test("GitHub", () => {
    expect(fuzz("github", githubSeeds, {}).slice(0, 10)).toEqual([]);
  });
  test("Gitea", () => {
    expect(
      fuzz("gitea", giteaSeeds, { baseUrl: "https://git.example.com" }).slice(
        0,
        10
      )
    ).toEqual([]);
  });
  test("Slack", () => {
    expect(
      fuzz("slack", slackSeeds, {
        channels: ["C1"],
        channelNames: { C1: "standup" },
      }).slice(0, 10)
    ).toEqual([]);
  });
  test("a no-code webhook mapping", () => {
    expect(fuzz("webhook", webhookSeeds, gitlab).slice(0, 10)).toEqual([]);
  });
  test("Discord", () => {
    expect(
      fuzz("discord", discordSeeds, { channels: ["22"] }).slice(0, 10)
    ).toEqual([]);
  });
});
