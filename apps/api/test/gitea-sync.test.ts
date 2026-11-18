import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { hmacHex, routedFetch, testEnv } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});
beforeEach(() => {
  env.reset();
});

const API = "https://git.example.com/api/v1/repos/acme/api";
const hoursAgo = (h: number) =>
  new Date(Date.now() - h * 3_600_000).toISOString();
const emma = { id: 11, login: "emma", full_name: "" };
const sam = { id: 12, login: "sam", full_name: "Sam" };

describe("Gitea and Forgejo backfill", () => {
  test("a token reads recent history with the ids webhooks give it", async () => {
    const owner = await env.workspace();
    const fetch = routedFetch([
      [
        `GET ${API}/issues/comments`,
        (r) =>
          r.headers.get("authorization") === "token bot-token"
            ? [
                {
                  id: 501,
                  body: "Repro'd on staging",
                  html_url:
                    "https://git.example.com/acme/api/issues/3#issuecomment-501",
                  user: sam,
                  created_at: hoursAgo(5),
                  issue_url: `${API}/issues/3`,
                },
              ]
            : new Response("no", { status: 401 }),
      ],
      [
        `GET ${API}/issues/3`,
        () => ({
          number: 3,
          title: "Invoices retry forever",
          html_url: "https://git.example.com/acme/api/issues/3",
          user: emma,
          created_at: hoursAgo(30),
          updated_at: hoursAgo(5),
        }),
      ],
      [
        `GET ${API}/issues`,
        () => [
          {
            number: 3,
            title: "Invoices retry forever",
            html_url: "https://git.example.com/acme/api/issues/3",
            user: emma,
            created_at: hoursAgo(30),
            updated_at: hoursAgo(5),
          },
          {
            number: 4,
            title: "Cap retries",
            html_url: "https://git.example.com/acme/api/pulls/4",
            user: sam,
            created_at: hoursAgo(20),
            updated_at: hoursAgo(2),
            closed_at: hoursAgo(2),
            pull_request: { merged: true, merged_at: hoursAgo(2) },
          },
        ],
      ],
      [
        `GET ${API}/releases`,
        () => [
          {
            id: 9,
            tag_name: "v2.0.0",
            name: "",
            html_url: "https://git.example.com/acme/api/releases/v2.0.0",
            body: "Retries capped",
            draft: false,
            prerelease: false,
            published_at: hoursAgo(1),
            author: sam,
          },
        ],
      ],
      [
        `GET ${API}/activities/feeds`,
        () => [
          {
            op_type: "commit_repo",
            ref_name: "refs/heads/retries",
            created: hoursAgo(3),
            act_user: sam,
            content: JSON.stringify({
              Commits: [
                { Sha1: "b2", Message: "Cap at five" },
                { Sha1: "a1", Message: "Add jitter" },
              ],
              HeadCommit: { Sha1: "b2" },
              Len: 2,
            }),
          },
          { op_type: "create_issue", created: hoursAgo(4), act_user: emma },
        ],
      ],
      [
        `GET ${API}`,
        () => ({ id: 77, full_name: "acme/api", default_branch: "main" }),
      ],
    ]);
    env.ctx.fetch = fetch;
    const conn = (
      await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: {
          provider: "gitea",
          secrets: { webhookSecret: "hook", token: "bot-token" },
          settings: { baseUrl: "https://git.example.com", repos: ["acme/api"] },
        },
      })
    ).body;
    const { capabilities } = (
      await env.call("GET", "/v1/connectors", { token: owner.token })
    ).body.find((c: any) => c.id === "gitea");
    expect(capabilities).toMatchObject({ sync: true });

    await env.call("POST", `/v1/connections/${conn.id}/sync`, {
      token: owner.token,
    });
    await env.drain();
    const titles = (
      await env.call("GET", "/v1/activities?source=gitea", {
        token: owner.token,
      })
    ).body.map((a: any) => a.title);
    expect(
      titles.toSorted((a: string, b: string) => a.localeCompare(b))
    ).toEqual([
      "Left 1 comment on acme/api#3: Invoices retry forever",
      "Merged PR acme/api#4: Cap retries",
      "Opened issue acme/api#3: Invoices retry forever",
      "Opened PR acme/api#4: Cap retries",
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

    const raw = JSON.stringify({
      action: "created",
      repository: { id: 77, full_name: "acme/api" },
      sender: sam,
      issue: {
        number: 3,
        title: "Invoices retry forever",
        html_url: "https://git.example.com/acme/api/issues/3",
        user: emma,
      },
      comment: {
        id: 501,
        body: "Repro'd on staging",
        html_url: "c",
        user: sam,
        created_at: hoursAgo(5),
      },
    });
    await env.app.request(`/hooks/${conn.id}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gitea-event": "issue_comment",
        "x-gitea-delivery": "live-1",
        "x-gitea-signature": hmacHex("hook", raw),
      },
      body: raw,
    });
    await env.drain();
    const comments = (
      await env.call("GET", "/v1/activities?kind=comment.created", {
        token: owner.token,
      })
    ).body;
    expect(comments).toHaveLength(1);
  });

  test("reviews from Gitea's own review webhooks resolve the request and tell the author", async () => {
    const owner = await env.workspace();
    const reviewer = await env.teammate(owner.token, "Sam");
    const conn = (
      await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: {
          provider: "gitea",
          secrets: { webhookSecret: "hook" },
          settings: { baseUrl: "https://git.example.com" },
        },
      })
    ).body;
    await env.call("POST", "/v1/members/me/identities", {
      token: owner.token,
      body: { provider: "gitea:git.example.com", externalId: "11" },
    });
    await env.call("POST", `/v1/members/${reviewer.member.id}/identities`, {
      token: reviewer.token,
      body: { provider: "gitea:git.example.com", externalId: "12" },
    });
    const pull = (updated: string) => ({
      number: 4,
      title: "Cap retries",
      html_url: "https://git.example.com/acme/api/pulls/4",
      user: emma,
      updated_at: updated,
    });
    let n = 0;
    const send = async (event: string, payload: object) => {
      n += 1;
      const raw = JSON.stringify({
        repository: { id: 77, full_name: "acme/api" },
        ...payload,
      });
      await env.app.request(`/hooks/${conn.id}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-gitea-event": event,
          "x-gitea-delivery": `g${n}`,
          "x-gitea-signature": hmacHex("hook", raw),
        },
        body: raw,
      });
      await env.drain();
    };
    await send("pull_request", {
      action: "review_requested",
      sender: emma,
      requested_reviewer: sam,
      pull_request: pull(hoursAgo(2)),
    });
    expect(
      (await env.call("GET", "/v1/attention", { token: reviewer.token })).body
    ).toHaveLength(1);
    await send("pull_request_rejected", {
      action: "reviewed",
      sender: sam,
      pull_request: pull(hoursAgo(1)),
      review: { type: "pull_request_review_rejected", content: "Needs a cap" },
    });
    expect(
      (await env.call("GET", "/v1/attention", { token: reviewer.token })).body
    ).toHaveLength(0);
    const [told] = (
      await env.call("GET", "/v1/attention", { token: owner.token })
    ).body;
    expect(told).toMatchObject({ kind: "pr.review", priority: "high" });
    const [review] = (
      await env.call("GET", "/v1/activities?kind=review.submitted", {
        token: owner.token,
      })
    ).body;
    expect(review.title).toBe("Requested changes on acme/api#4: Cap retries");
  });

  test("with a token, Worklog makes the webhooks itself and turns disabled ones back on", async () => {
    const owner = await env.workspace();
    const created: any[] = [];
    const repaired: any[] = [];
    let existing: object[] = [];
    env.ctx.fetch = routedFetch([
      [
        "GET https://git.example.com/api/v1/repos/acme/api/hooks",
        () => existing,
      ],
      ["GET https://git.example.com/api/v1/repos/acme/web/hooks", () => []],
      [
        "POST https://git.example.com/api/v1/repos/",
        (r) => {
          created.push({ url: r.url, body: r.body });
          return { id: 1 };
        },
      ],
      [
        "PATCH https://git.example.com/api/v1/repos/acme/api/hooks/7",
        (r) => {
          repaired.push(r.body);
          return { id: 7 };
        },
      ],
    ]);
    const conn = (
      await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: {
          provider: "gitea",
          secrets: { token: "bot-token" },
          settings: {
            baseUrl: "https://git.example.com",
            repos: ["acme/api", "acme/web"],
          },
        },
      })
    ).body;
    expect(conn.id).toBeDefined();
    await env.drain();
    expect(created.map((c) => c.url)).toEqual([
      "https://git.example.com/api/v1/repos/acme/api/hooks",
      "https://git.example.com/api/v1/repos/acme/web/hooks",
    ]);
    const hook = created[0].body;
    expect(hook).toMatchObject({
      type: "gitea",
      active: true,
      config: {
        url: `https://worklog.test/hooks/${conn.id}`,
        content_type: "json",
      },
    });
    expect(hook.events).toContain("pull_request_review_approved");

    const raw = JSON.stringify({
      action: "opened",
      repository: { id: 77, full_name: "acme/api" },
      sender: emma,
      issue: {
        number: 9,
        title: "Webhooks made by Worklog",
        html_url: "https://git.example.com/acme/api/issues/9",
        user: emma,
      },
    });
    const res = await env.app.request(`/hooks/${conn.id}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gitea-event": "issues",
        "x-gitea-delivery": "managed-1",
        "x-gitea-signature": hmacHex(hook.config.secret, raw),
      },
      body: raw,
    });
    expect(res.status).toBe(200);

    existing = [
      {
        id: 7,
        active: false,
        config: { url: `https://worklog.test/hooks/${conn.id}` },
      },
    ];
    await env.call("PATCH", `/v1/connections/${conn.id}`, {
      token: owner.token,
      body: {
        settings: { baseUrl: "https://git.example.com", repos: ["acme/api"] },
      },
    });
    await env.drain();
    expect(repaired[0]).toMatchObject({ active: true });
    const health = (
      await env.call("GET", `/v1/connections/${conn.id}/health`, {
        token: owner.token,
      })
    ).body;
    expect(health.sync).toContainEqual(
      expect.objectContaining({ stream: "hook:acme/api", state: "idle" })
    );
  });
});
