import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { routedFetch, testEnv } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});
beforeEach(() => {
  env.reset();
});

const project = {
  id: 77,
  path_with_namespace: "acme/api",
  web_url: "https://gitlab.com/acme/api",
  default_branch: "main",
};
const emma = { id: 21, username: "emma.gl", name: "Emma" };
const sam = { id: 22, username: "sam_gl", name: "Sam" };
const hoursAgo = (h: number) =>
  new Date(Date.now() - h * 3_600_000).toISOString();

async function gitlab(settings: Record<string, unknown> = {}) {
  const owner = await env.workspace();
  const teammate = await env.teammate(owner.token, "Sam");
  const board = (
    await env.call("POST", "/v1/boards", {
      token: owner.token,
      body: { name: "Eng" },
    })
  ).body;
  const conn = (
    await env.call("POST", "/v1/connections", {
      token: owner.token,
      body: {
        provider: "gitlab",
        secrets: { webhookSecret: "s3cret" },
        settings: { boardId: board.id, ...settings },
      },
    })
  ).body;
  await env.call("POST", "/v1/members/me/identities", {
    token: owner.token,
    body: { provider: "gitlab:gitlab.com", externalId: "21" },
  });
  await env.call("POST", `/v1/members/${teammate.member.id}/identities`, {
    token: teammate.token,
    body: { provider: "gitlab:gitlab.com", externalId: "22" },
  });
  let n = 0;
  const send = async (
    payload: object,
    opts: { token?: string; delivery?: string } = {}
  ) => {
    n += 1;
    const res = await env.app.request(`/hooks/${conn.id}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gitlab-token": opts.token ?? "s3cret",
        "idempotency-key": opts.delivery ?? `gl-${n}`,
      },
      body: JSON.stringify({ project, ...payload }),
    });
    await env.drain();
    return res;
  };
  const titles = async (query = "") =>
    (
      await env.call("GET", `/v1/activities?source=gitlab${query}`, {
        token: owner.token,
      })
    ).body.map((a: any) => a.title);
  return { owner, teammate, board, conn, send, titles };
}

const mr = (action: string, extra: Record<string, unknown> = {}) => ({
  object_kind: "merge_request",
  user: emma,
  object_attributes: {
    iid: 7,
    title: "Retry payments",
    description: "Closes #7, see WL-3",
    url: "https://gitlab.com/acme/api/-/merge_requests/7",
    state: "opened",
    action,
    author_id: 21,
    created_at: "2026-10-28 09:00:00 UTC",
    updated_at: "2026-10-28 09:30:00 UTC",
    ...extra,
  },
});

const issue = (action: string, extra: object = {}) => ({
  object_kind: "issue",
  user: emma,
  object_attributes: {
    iid: 7,
    title: "Payments fail on retry",
    url: "https://gitlab.com/acme/api/-/issues/7",
    action,
    created_at: "2026-10-28T08:00:00Z",
    updated_at: "2026-10-28T08:00:00Z",
    ...extra,
  },
});

const push = (after: string, message: string) => ({
  object_kind: "push",
  ref: "refs/heads/retries",
  before: "a0",
  after,
  user_id: 21,
  user_username: "emma.gl",
  user_name: "Emma",
  total_commits_count: 1,
  commits: [{ id: after, message, timestamp: "2026-10-28T09:00:00Z" }],
});

describe("GitLab webhooks", () => {
  test("rejects a wrong secret token", async () => {
    const { send } = await gitlab();
    const res = await send(mr("open"), { token: "wrong" });
    expect(res.status).toBe(401);
  });

  test("issues become cards; confidential ones stay in GitLab", async () => {
    const { owner, send } = await gitlab();
    await send(issue("open"));
    await send({
      ...issue("open"),
      event_type: "confidential_issue",
      object_attributes: {
        ...issue("open").object_attributes,
        iid: 8,
        title: "Security hole",
        confidential: true,
      },
    });
    let cards = (await env.call("GET", "/v1/cards", { token: owner.token }))
      .body;
    expect(cards.map((c: any) => c.title)).toEqual(["Payments fail on retry"]);
    expect(cards[0]).toMatchObject({ stage: "triage", source: "gitlab" });

    await send(issue("close", { closed_at: "2026-10-28T10:00:00Z" }));
    cards = (await env.call("GET", "/v1/cards", { token: owner.token })).body;
    expect(cards[0].stage).toBe("done");
  });

  test("a review request reaches the reviewer; approving resolves it and tells the author", async () => {
    const { owner, teammate, send, titles } = await gitlab();
    await send({ ...mr("open"), reviewers: [sam] });
    let samItems = (
      await env.call("GET", "/v1/attention", { token: teammate.token })
    ).body;
    expect(samItems[0]).toMatchObject({
      kind: "review.requested",
      priority: "high",
    });

    await send({ ...mr("approval"), user: sam });
    await send({ ...mr("approved"), user: sam });
    samItems = (
      await env.call("GET", "/v1/attention", { token: teammate.token })
    ).body;
    expect(
      samItems.find((a: any) => a.kind === "review.requested")
    ).toBeUndefined();
    const emmaItems = (
      await env.call("GET", "/v1/attention", { token: owner.token })
    ).body;
    expect(emmaItems[0]).toMatchObject({ kind: "pr.review" });
    expect(await titles("&kind=review.submitted")).toEqual([
      "Approved acme/api!7: Retry payments",
    ]);
  });

  test("reviewers added later, drafts marked ready, merges: each mapped once, and MR !7 is not issue #7", async () => {
    const { teammate, send, titles } = await gitlab();
    await send(mr("open", { draft: true }));
    await send({
      ...mr("update", { draft: false }),
      changes: { draft: { previous: true, current: false } },
    });
    await send({
      ...mr("update"),
      changes: { reviewers: { previous: [], current: [sam] } },
    });
    await send({
      object_kind: "note",
      user: sam,
      object_attributes: {
        id: 900,
        note: "Looks good, @emma.gl — one nit",
        noteable_type: "MergeRequest",
        url: "https://gitlab.com/acme/api/-/merge_requests/7#note_900",
        created_at: "2026-10-28T09:40:00Z",
      },
      merge_request: { iid: 7, title: "Retry payments", url: "u" },
    });
    await send({
      object_kind: "note",
      user: sam,
      object_attributes: {
        id: 901,
        note: "changed the description",
        system: true,
        noteable_type: "MergeRequest",
      },
      merge_request: { iid: 7, title: "Retry payments" },
    });
    await send({
      object_kind: "note",
      user: sam,
      object_attributes: {
        id: 902,
        note: "internal only",
        internal: true,
        noteable_type: "MergeRequest",
      },
      merge_request: { iid: 7, title: "Retry payments" },
    });
    await send(mr("merge"));

    expect(
      (await titles()).toSorted((a: string, b: string) => a.localeCompare(b))
    ).toEqual([
      "Asked @sam_gl to review acme/api!7: Retry payments",
      "Left 1 comment on acme/api!7: Retry payments",
      "Merged MR acme/api!7: Retry payments",
      "Opened MR acme/api!7: Retry payments",
    ]);
    const samItems = (
      await env.call("GET", "/v1/attention", { token: teammate.token })
    ).body;
    expect(
      samItems.find((a: any) => a.kind === "review.requested")
    ).toBeUndefined();
    const activities = (
      await env.call("GET", "/v1/activities?source=gitlab", {
        token: teammate.token,
      })
    ).body;
    const merged = activities.find((a: any) => a.kind === "pr.merged");
    expect(merged.threadKey).toBe("gitlab:gitlab.com:acme/api!7");
  });

  test("pushes are recorded, bursts merge, and deleted branches are not", async () => {
    const { send, titles } = await gitlab();
    await send(push("b1", "Add jitter"));
    await send(push("c2", "Cap at five"));
    await send({
      ...push("0000000000000000000000000000000000000000", "gone"),
      commits: [],
    });
    expect(await titles("&kind=code.pushed")).toEqual([
      "Pushed 2 commits to acme/api:retries",
    ]);
  });

  test("a redelivery is processed once", async () => {
    const { send, titles } = await gitlab();
    await send(mr("open"), { delivery: "same" });
    await send(mr("open"), { delivery: "same" });
    await send(mr("open"), { delivery: "retry-without-the-key" });
    expect(await titles()).toEqual(["Opened MR acme/api!7: Retry payments"]);
  });
});

describe("GitLab with a token", () => {
  const API = "https://gitlab.example.com/api/v4/projects/acme%2Fapi";

  test("Worklog makes the webhooks itself and turns ones GitLab disabled back on", async () => {
    const owner = await env.workspace();
    const created: any[] = [];
    const repaired: any[] = [];
    let existing: object[] = [];
    env.ctx.fetch = routedFetch([
      [`GET ${API}/hooks`, () => existing],
      [
        "GET https://gitlab.example.com/api/v4/projects/acme%2Fweb/hooks",
        () => [],
      ],
      [
        "POST https://gitlab.example.com/api/v4/projects/",
        (r) => {
          created.push({
            url: r.url,
            body: r.body,
            token: r.headers.get("private-token"),
          });
          return { id: 1 };
        },
      ],
      [
        `PUT ${API}/hooks/5`,
        (r) => {
          repaired.push(r.body);
          return { id: 5 };
        },
      ],
    ]);
    const conn = (
      await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: {
          provider: "gitlab",
          secrets: { token: "glpat-bot" },
          settings: {
            baseUrl: "https://gitlab.example.com",
            repos: ["acme/api", "acme/web"],
          },
        },
      })
    ).body;
    await env.drain();
    expect(created.map((c) => c.url)).toEqual([
      `${API}/hooks`,
      "https://gitlab.example.com/api/v4/projects/acme%2Fweb/hooks",
    ]);
    expect(created[0].token).toBe("glpat-bot");
    const hook = created[0].body;
    expect(hook).toMatchObject({
      url: `https://worklog.test/hooks/${conn.id}`,
      merge_requests_events: true,
      note_events: true,
      confidential_issues_events: false,
    });

    const res = await env.app.request(`/hooks/${conn.id}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gitlab-token": hook.token,
      },
      body: JSON.stringify({
        ...mr("open"),
        project: { ...project, path_with_namespace: "acme/api" },
      }),
    });
    expect(res.status).toBe(200);

    existing = [
      {
        id: 5,
        url: `https://worklog.test/hooks/${conn.id}`,
        alert_status: "disabled",
      },
    ];
    await env.call("PATCH", `/v1/connections/${conn.id}`, {
      token: owner.token,
      body: {
        settings: {
          baseUrl: "https://gitlab.example.com",
          repos: ["acme/api"],
        },
      },
    });
    await env.drain();
    expect(repaired[0]).toMatchObject({ push_events: true, token: hook.token });
  });

  test("history comes with the ids its webhooks give it, in the project's lane", async () => {
    const owner = await env.workspace();
    env.ctx.fetch = routedFetch([
      [
        `GET ${API}/merge_requests`,
        (r) =>
          r.headers.get("private-token") === "glpat-bot"
            ? [
                {
                  iid: 4,
                  title: "Cap retries",
                  web_url:
                    "https://gitlab.example.com/acme/api/-/merge_requests/4",
                  state: "merged",
                  created_at: hoursAgo(20),
                  updated_at: hoursAgo(2),
                  merged_at: hoursAgo(2),
                  author: sam,
                  merged_by: emma,
                  reviewers: [],
                },
              ]
            : new Response("no", { status: 401 }),
      ],
      [
        `GET ${API}/issues`,
        () => [
          {
            iid: 4,
            title: "Invoices retry forever",
            web_url: "https://gitlab.example.com/acme/api/-/issues/4",
            created_at: hoursAgo(30),
            updated_at: hoursAgo(5),
            author: emma,
          },
          {
            iid: 5,
            title: "Secret",
            web_url: "x",
            confidential: true,
            created_at: hoursAgo(3),
            updated_at: hoursAgo(3),
            author: emma,
          },
        ],
      ],
      [
        `GET ${API}/releases`,
        () => [
          {
            tag_name: "v2.0.0",
            name: "v2.0.0",
            description: "Retries capped",
            released_at: hoursAgo(1),
            created_at: hoursAgo(1),
            author: sam,
            _links: {
              self: "https://gitlab.example.com/acme/api/-/releases/v2.0.0",
            },
          },
        ],
      ],
      [
        `GET ${API}/events`,
        () => [
          {
            created_at: hoursAgo(3),
            author: sam,
            push_data: {
              commit_count: 2,
              action: "pushed",
              ref_type: "branch",
              commit_from: "a1",
              commit_to: "b2",
              ref: "retries",
              commit_title: "Cap at five",
            },
          },
          {
            created_at: hoursAgo(3),
            author: sam,
            push_data: {
              commit_count: 0,
              action: "pushed",
              ref_type: "tag",
              commit_to: "c3",
              ref: "v2.0.0",
            },
          },
        ],
      ],
      [
        `GET ${API}`,
        () => ({
          id: 77,
          path_with_namespace: "acme/api",
          web_url: "https://gitlab.example.com/acme/api",
          default_branch: "main",
        }),
      ],
    ]);
    const conn = (
      await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: {
          provider: "gitlab",
          secrets: { webhookSecret: "hook", token: "glpat-bot" },
          settings: {
            baseUrl: "https://gitlab.example.com",
            repos: ["acme/api"],
          },
        },
      })
    ).body;
    await env.call("POST", `/v1/connections/${conn.id}/sync`, {
      token: owner.token,
    });
    await env.drain();
    const titles = async () =>
      (
        await env.call("GET", "/v1/activities?source=gitlab", {
          token: owner.token,
        })
      ).body
        .map((a: any) => a.title)
        .toSorted((a: string, b: string) => a.localeCompare(b));
    expect(await titles()).toEqual([
      "Merged MR acme/api!4: Cap retries",
      "Opened issue acme/api#4: Invoices retry forever",
      "Opened MR acme/api!4: Cap retries",
      "Pushed 2 commits to acme/api:retries",
      "Released acme/api v2.0.0",
    ]);
    const deliveries = (
      await env.call("GET", `/v1/connections/${conn.id}/deliveries`, {
        token: owner.token,
      })
    ).body;
    expect(new Set(deliveries.map((d: any) => d.partitionKey))).toEqual(
      new Set(["77"])
    );

    await env.app.request(`/hooks/${conn.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-gitlab-token": "hook" },
      body: JSON.stringify({
        object_kind: "merge_request",
        user: emma,
        project: { ...project, path_with_namespace: "acme/api" },
        object_attributes: {
          iid: 4,
          title: "Cap retries",
          url: "u",
          action: "merge",
          updated_at: hoursAgo(2),
        },
      }),
    });
    await env.drain();
    expect(await titles()).toHaveLength(5);
  });

  test("the projects to choose from are the ones the token can add webhooks to", async () => {
    const owner = await env.workspace();
    env.ctx.fetch = routedFetch([
      [
        "GET https://gitlab.com/api/v4/projects?membership=true&min_access_level=40",
        () => [
          { path_with_namespace: "acme/api", visibility: "private" },
          { path_with_namespace: "acme/docs", visibility: "public" },
        ],
      ],
    ]);
    const conn = (
      await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: {
          provider: "gitlab",
          secrets: { webhookSecret: "hook", token: "glpat-bot" },
        },
      })
    ).body;
    const sources = (
      await env.call("GET", `/v1/connections/${conn.id}/sources`, {
        token: owner.token,
      })
    ).body;
    expect(sources).toMatchObject([
      { id: "acme/api", private: true },
      { id: "acme/docs", private: false },
    ]);
  });
});
