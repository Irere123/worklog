import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import { sql } from "drizzle-orm";

import { normalizeGithubLike } from "../src/connectors/github";
import { normalizeSlackMessage } from "../src/connectors/slack";
import { webhookConnector } from "../src/connectors/webhook";
import { hmacHex } from "../src/lib/crypto";
import { testEnv } from "./harness";
import type { TestEnv } from "./harness";

const now = new Date("2026-10-26T09:00:00Z");
const repo = { full_name: "acme/api", default_branch: "main" };
const emma = { login: "emma-gh", id: 101 };

function gh(type: string, payload: object, settings = {}) {
  return normalizeGithubLike(
    "github",
    type,
    { repository: repo, sender: emma, ...payload },
    now,
    settings
  );
}

describe("GitHub normalizer", () => {
  test("pushes: new commits count; merges, force-pushes, tags and deletions don't", () => {
    const push = gh("push", {
      ref: "refs/heads/wl-12-retry",
      after: "a1",
      commits: [
        { id: "1", message: "Add backoff" },
        { id: "2", message: "Tests" },
      ],
    });
    expect(push.events[0]).toMatchObject({
      kind: "code.pushed",
      title: "Pushed 2 commits to acme/api:wl-12-retry",
      cardRefs: { numbers: [12] },
    });
    expect(push.events[0]!.coalesce).toMatchObject({
      units: 2,
      windowMinutes: 60,
    });

    expect(
      gh("push", {
        ref: "refs/heads/main",
        after: "b",
        commits: [{ id: "3", message: "Merge pull request #7 from x/y" }],
      }).ignored
    ).toContain("merge commits");
    expect(
      gh("push", {
        ref: "refs/heads/main",
        after: "c",
        commits: [{ id: "4", message: "Retry payments (#7)" }],
      }).ignored
    ).toContain("merge commits");
    expect(
      gh("push", {
        ref: "refs/heads/x",
        forced: true,
        after: "d",
        commits: [{ id: "5", message: "wip" }],
      }).ignored
    ).toContain("force push");
    expect(
      gh("push", { ref: "refs/tags/v1", after: "e", commits: [] }).ignored
    ).toBe("tag push");
    expect(gh("push", { ref: "refs/heads/x", deleted: true }).ignored).toBe(
      "branch deleted"
    );
    expect(
      gh("push", {
        ref: "refs/heads/x",
        after: "f",
        commits: [{ id: "6", message: "dup", distinct: false }],
      }).ignored
    ).toBe("no new commits");
  });

  test("pull requests: drafts and churn are ignored; opening asks reviewers; ids are stable across redeliveries", () => {
    const pr = {
      number: 7,
      title: "Retry payments",
      html_url: "https://github.com/acme/api/pull/7",
      body: "Fixes #3. cc @sam-gh",
      user: emma,
      updated_at: "2026-10-26T08:00:00Z",
    };
    expect(
      gh("pull_request", {
        action: "opened",
        pull_request: { ...pr, draft: true },
      }).ignored
    ).toBe("draft pull request");
    expect(
      gh("pull_request", { action: "synchronize", pull_request: pr }).ignored
    ).toContain("not a work signal");
    expect(
      gh("pull_request", { action: "labeled", pull_request: pr }).ignored
    ).toContain("not a work signal");

    const opened = gh("pull_request", {
      action: "opened",
      pull_request: { ...pr, requested_reviewers: [{ login: "ana", id: 7 }] },
    });
    expect(opened.events[0]).toMatchObject({
      kind: "pr.opened",
      thread: "github:acme/api#7",
      cardRefs: { externalKeys: ["github:acme/api#3"] },
    });
    expect(opened.events[0]!.signals!.map((s) => s.type)).toEqual([
      "review_requested",
      "mentioned",
    ]);
    const again = gh("pull_request", {
      action: "opened",
      pull_request: { ...pr, requested_reviewers: [] },
    });
    expect(again.events[0]!.id).toBe(opened.events[0]!.id);
    expect(opened.events[0]!.occurredAt.toISOString()).toBe(
      "2026-10-26T08:00:00.000Z"
    );
  });

  test("reviews: empty comments are noise; verdicts reach the author and close the reviewer's request", () => {
    const pull_request = {
      number: 7,
      title: "Retry",
      html_url: "u",
      user: { login: "sam-gh", id: 202 },
    };
    expect(
      gh("pull_request_review", {
        action: "submitted",
        pull_request,
        review: {
          id: 1,
          state: "commented",
          body: "",
          html_url: "r",
          user: emma,
        },
      }).ignored
    ).toContain("empty review");
    const verdict = gh("pull_request_review", {
      action: "submitted",
      pull_request,
      review: {
        id: 2,
        state: "CHANGES_REQUESTED",
        body: "Cap the backoff",
        html_url: "r",
        user: emma,
      },
    });
    expect(verdict.events[0]!.signals).toEqual([
      {
        type: "review_result",
        who: { id: "202", handle: "sam-gh", name: null, bot: false },
        state: "changes_requested",
      },
      {
        type: "resolve",
        who: { id: "101", handle: "emma-gh", name: null, bot: false },
        what: "review_requested",
      },
    ]);
  });

  test("bots are flagged by account type and [bot] suffix", () => {
    const e = normalizeGithubLike(
      "github",
      "pull_request",
      {
        repository: repo,
        sender: { login: "dependabot[bot]", id: 49_699_333, type: "Bot" },
        action: "opened",
        pull_request: {
          number: 9,
          title: "Bump x",
          html_url: "u",
          user: { login: "dependabot[bot]" },
        },
      },
      now,
      {}
    );
    expect(e.events[0]!.actor!.bot).toBe(true);
  });

  test("repository allowlist", () => {
    expect(
      gh(
        "push",
        {
          ref: "refs/heads/x",
          after: "z",
          commits: [{ id: "1", message: "m" }],
        },
        { repos: ["acme/web"] }
      ).ignored
    ).toContain("isn't tracked");
  });
});

describe("Slack normalizer", () => {
  const settings = {
    channels: ["C0STANDUP"],
    channelNames: { C0STANDUP: "standup" },
  };
  const msg = (text: string, extra: object = {}) =>
    normalizeSlackMessage(
      {
        type: "message",
        user: "U0EMMA",
        text,
        channel: "C0STANDUP",
        channel_type: "channel",
        ts: "1793000000.000100",
        ...extra,
      },
      "Ev1",
      settings,
      now
    );

  test("chatter is dropped, short news is kept, DMs are never ingested", () => {
    expect(msg("ok 👍").ignored).toBe("too short to be a work update");
    expect(msg("thanks!").ignored).toBe("too short to be a work update");
    expect(msg("deployed v2.3").events[0]).toMatchObject({
      kind: "message.posted",
      title: "Posted in #standup: deployed v2.3",
    });
    expect(
      msg("Finished the retry queue, starting on alerts", {
        channel_type: "im",
      }).ignored
    ).toBe("direct messages are never ingested");
  });

  test("outside opted-in channels only mentions get through (as signals, not stream items)", () => {
    const e = normalizeSlackMessage(
      {
        type: "message",
        user: "U0EMMA",
        text: "<@U0SAM> can you check the dashboard?",
        channel: "C0RANDOM",
        channel_type: "channel",
        ts: "1",
      },
      "Ev2",
      settings,
      now
    );
    expect(e.events[0]).toMatchObject({
      hidden: true,
      signals: [
        { type: "mentioned", who: { id: "U0SAM" }, priority: "normal" },
      ],
    });
  });

  test("thread replies merge per person; edits and deletions are applied; private channels stay private", () => {
    const reply = msg("I think the issue is the connection pool size", {
      thread_ts: "1793000000.000001",
    });
    expect(reply.events[0]!.coalesce).toMatchObject({
      template: "Replied {n} time{s} in a #standup thread",
    });
    const deleted = normalizeSlackMessage(
      {
        type: "message",
        subtype: "message_deleted",
        channel: "C0STANDUP",
        deleted_ts: "1793000000.000100",
        ts: "2",
      },
      "Ev3",
      settings,
      now
    );
    expect(deleted.events[0]).toMatchObject({
      op: "delete",
      id: "slack:C0STANDUP:1793000000.000100",
    });
    expect(
      msg("Rolling out the new billing flow today", { channel_type: "group" })
        .events[0]!.visibility
    ).toBe("private");
  });
});

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});
beforeEach(() => {
  env.reset();
});

async function github(settings: Record<string, unknown> = {}) {
  const owner = await env.workspace();
  const conn = (
    await env.call("POST", "/v1/connections", {
      token: owner.token,
      body: { provider: "github", secrets: { webhookSecret: "s" }, settings },
    })
  ).body;
  let n = 0;
  const send = async (event: string, payload: object) => {
    n += 1;
    const raw = JSON.stringify({ repository: repo, ...payload });
    const res = await env.app.request(
      new URL(conn.webhookUrls.webhook).pathname,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": event,
          "x-github-delivery": `d${n}-${Math.random()}`,
          "x-hub-signature-256": `sha256=${hmacHex("s", raw)}`,
        },
        body: raw,
      }
    );
    await env.drain();
    return res;
  };
  return { owner, conn, send };
}

describe("ingestion pipeline", () => {
  test("bursts merge: three pushes to a branch become one activity", async () => {
    const { owner, send } = await github();
    for (let i = 0; i < 3; i += 1) {
      await send("push", {
        ref: "refs/heads/feature",
        after: `sha${i}`,
        sender: emma,
        commits: [
          { id: `${i}a`, message: `step ${i}` },
          { id: `${i}b`, message: `more ${i}` },
        ],
      });
    }
    const pushes = (
      await env.call("GET", "/v1/activities?kind=code.pushed", {
        token: owner.token,
      })
    ).body;
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({
      title: "Pushed 6 commits to acme/api:feature",
      count: 3,
    });
  });

  test("unknown people are recorded, and linking them later re-attributes their history", async () => {
    const { owner, send } = await github();
    await send("pull_request", {
      action: "opened",
      sender: { login: "newhire", id: 999 },
      pull_request: {
        number: 1,
        title: "First PR",
        html_url: "u",
        user: { login: "newhire", id: 999 },
      },
    });
    const [unlinked] = (
      await env.call("GET", "/v1/identities?unlinked=true", {
        token: owner.token,
      })
    ).body;
    expect(unlinked).toMatchObject({
      provider: "github",
      externalId: "999",
      externalHandle: "newhire",
      memberId: null,
      eventCount: 1,
    });
    const [before] = (
      await env.call("GET", "/v1/activities?kind=pr.opened", {
        token: owner.token,
      })
    ).body;
    expect(before).toMatchObject({
      actorId: null,
      actorIdentityId: unlinked.id,
    });

    const newhire = await env.teammate(owner.token, "New Hire");
    const linked = await env.call("PATCH", `/v1/identities/${unlinked.id}`, {
      token: owner.token,
      body: { member: newhire.member.id },
    });
    expect(linked.body.reattributed).toBe(1);
    const [after] = (
      await env.call("GET", "/v1/activities?kind=pr.opened", {
        token: owner.token,
      })
    ).body;
    expect(after.actorId).toBe(newhire.member.id);
  });

  test("a reused GitHub login doesn't inherit someone else's identity", async () => {
    const { owner, send } = await github();
    await env.call("POST", "/v1/members/me/identities", {
      token: owner.token,
      body: { provider: "github", handle: "alice" },
    });
    await send("pull_request", {
      action: "opened",
      sender: { login: "alice", id: 1 },
      pull_request: {
        number: 1,
        title: "A",
        html_url: "u",
        user: { login: "alice", id: 1 },
      },
    });
    // Alice renames; a stranger takes the login "alice".
    await send("pull_request", {
      action: "opened",
      sender: { login: "alice", id: 2 },
      pull_request: {
        number: 2,
        title: "B",
        html_url: "u",
        user: { login: "alice", id: 2 },
      },
    });
    const prs = (
      await env.call("GET", "/v1/activities?kind=pr.opened", {
        token: owner.token,
      })
    ).body;
    expect(prs.find((p: any) => p.title.includes("#1")).actorId).toBe(
      owner.member.id
    );
    expect(prs.find((p: any) => p.title.includes("#2")).actorId).toBeNull();
  });

  test("bots stay quiet: their pushes are dropped, their PRs kept at low importance, with reasons in health", async () => {
    const { owner, conn, send } = await github();
    const bot = { login: "renovate[bot]", id: 29_139_614, type: "Bot" };
    await send("push", {
      ref: "refs/heads/renovate/x",
      after: "r1",
      sender: bot,
      commits: [{ id: "1", message: "chore(deps): bump" }],
    });
    await send("pull_request", {
      action: "opened",
      sender: bot,
      pull_request: { number: 5, title: "Bump deps", html_url: "u", user: bot },
    });
    const acts = (
      await env.call("GET", "/v1/activities?source=github", {
        token: owner.token,
      })
    ).body;
    expect(acts.map((a: any) => a.kind)).toEqual(["pr.opened"]);
    expect(acts[0].importance).toBeLessThan(0.3);

    const health = (
      await env.call("GET", `/v1/connections/${conn.id}/health`, {
        token: owner.token,
      })
    ).body;
    expect(health.topSkipReasons[0].reason).toContain("bot code.pushed");
    expect(health.deliveries).toMatchObject({ processed: 1, ignored: 1 });
  });

  test("an agent linked to a GitHub bot account is a teammate, not noise", async () => {
    const { owner, send } = await github();
    const agent = (
      await env.call("POST", "/v1/members", {
        token: owner.token,
        body: {
          kind: "agent",
          name: "Cursor agent",
          agentProvider: "cursor",
          ownerId: owner.member.id,
        },
      })
    ).body.member;
    await env.call("POST", `/v1/members/${agent.id}/identities`, {
      token: owner.token,
      body: { provider: "github", externalId: "777" },
    });
    await send("push", {
      ref: "refs/heads/cursor/fix",
      after: "c1",
      sender: { login: "cursor[bot]", id: 777, type: "Bot" },
      commits: [{ id: "1", message: "Fix flaky test" }],
    });
    const [push] = (
      await env.call("GET", "/v1/activities?kind=code.pushed", {
        token: owner.token,
      })
    ).body;
    expect(push.actorId).toBe(agent.id);
  });

  test("replay rebuilds activity from the raw inbox after settings change", async () => {
    const { owner, conn, send } = await github();
    await send("push", {
      ref: "refs/heads/x",
      after: "p1",
      sender: emma,
      commits: [{ id: "1", message: "m" }],
    });
    await send("pull_request", {
      action: "closed",
      sender: emma,
      pull_request: {
        number: 3,
        title: "Ship",
        html_url: "u",
        user: emma,
        merged: true,
        closed_at: "2026-10-26T08:30:00Z",
      },
    });
    expect(
      (
        await env.call("GET", "/v1/activities?source=github", {
          token: owner.token,
        })
      ).body
    ).toHaveLength(2);

    await env.call("PATCH", `/v1/connections/${conn.id}`, {
      token: owner.token,
      body: { settings: { ignoreKinds: ["code.pushed"] } },
    });
    const replay = await env.call("POST", `/v1/connections/${conn.id}/replay`, {
      token: owner.token,
      body: {},
    });
    expect(replay.status).toBe(202);
    await env.drain();
    const after = (
      await env.call("GET", "/v1/activities?source=github", {
        token: owner.token,
      })
    ).body;
    expect(after.map((a: any) => a.kind)).toEqual(["pr.merged"]);
    const deliveries = (
      await env.call("GET", `/v1/connections/${conn.id}/deliveries`, {
        token: owner.token,
      })
    ).body;
    expect(deliveries).toHaveLength(2);
  });

  test("Slack deletions remove what was recorded", async () => {
    const owner = await env.workspace();
    const conn = (
      await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: {
          provider: "slack",
          secrets: { signingSecret: "ss", botToken: "xoxb" },
          settings: { channels: ["C0STANDUP"] },
        },
      })
    ).body;
    const post = async (event: object, id: string) => {
      const raw = JSON.stringify({
        type: "event_callback",
        event_id: id,
        event,
      });
      const ts = Math.floor(Date.now() / 1000);
      await env.app.request(new URL(conn.webhookUrls.events).pathname, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-slack-request-timestamp": String(ts),
          "x-slack-signature": `v0=${hmacHex("ss", `v0:${ts}:${raw}`)}`,
        },
        body: raw,
      });
      await env.drain();
    };
    await post(
      {
        type: "message",
        user: "U0EMMA",
        text: "Shipped the onboarding flow to staging",
        channel: "C0STANDUP",
        channel_type: "channel",
        ts: "1793000000.000200",
      },
      "E1"
    );
    expect(
      (
        await env.call("GET", "/v1/activities?source=slack", {
          token: owner.token,
        })
      ).body
    ).toHaveLength(1);
    await post(
      {
        type: "message",
        subtype: "message_deleted",
        channel: "C0STANDUP",
        deleted_ts: "1793000000.000200",
        ts: "1793000001.0",
      },
      "E2"
    );
    expect(
      (
        await env.call("GET", "/v1/activities?source=slack", {
          token: owner.token,
        })
      ).body
    ).toHaveLength(0);
  });

  test("a delivery whose job can't be queued isn't kept, so the provider's retry goes through", async () => {
    const { owner, conn } = await github();
    const raw = JSON.stringify({
      repository: repo,
      ref: "refs/heads/feature",
      after: "sha-retry",
      sender: emma,
      commits: [{ id: "r1", message: "Retry payments" }],
    });
    const deliver = async () =>
      await env.app.request(new URL(conn.webhookUrls.webhook).pathname, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "push",
          "x-github-delivery": "retried-delivery",
          "x-hub-signature-256": `sha256=${hmacHex("s", raw)}`,
        },
        body: raw,
      });

    await env.ctx.db.execute(
      sql.raw(`
        create function test_queue_down() returns trigger language plpgsql
          as $$ begin raise exception 'queue down'; end $$;
        create trigger test_queue_down before insert on graphile_worker._private_jobs
          execute function test_queue_down();
      `)
    );
    try {
      expect((await deliver()).status).toBe(500);
    } finally {
      await env.ctx.db.execute(
        sql.raw(`
          drop trigger test_queue_down on graphile_worker._private_jobs;
          drop function test_queue_down();
        `)
      );
    }

    const retried = await deliver();
    expect(await retried.json()).toEqual({ ok: true });
    await env.drain();
    expect(
      (
        await env.call("GET", "/v1/activities?kind=code.pushed", {
          token: owner.token,
        })
      ).body
    ).toHaveLength(1);
  });
});

describe("custom integrations", () => {
  test("a no-code webhook connection maps a self-hosted GitLab merge into the stream", async () => {
    const owner = await env.workspace();
    const sam = await env.teammate(owner.token, "Sam");
    const settings = {
      verify: { type: "token", header: "X-Gitlab-Token" },
      eventType: { header: "X-Gitlab-Event" },
      deliveryId: { header: "X-Gitlab-Event-UUID" },
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
    const conn = (
      await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: {
          provider: "webhook",
          name: "GitLab (self-hosted)",
          secrets: { secret: "glt" },
          settings,
        },
      })
    ).body;
    await env.call("POST", `/v1/members/${sam.member.id}/identities`, {
      token: sam.token,
      body: { provider: "gitlab:git.example.com", handle: "sam" },
    });
    const body = JSON.stringify({
      object_kind: "merge_request",
      user: { id: 42, username: "emma", name: "Emma" },
      project: { path_with_namespace: "platform/billing" },
      object_attributes: {
        iid: 12,
        title: "Invoice retries",
        action: "merge",
        url: "https://git.example.com/platform/billing/-/merge_requests/12",
      },
      reviewer: "sam",
    });
    const send = async (token: string) =>
      await env.app.request(`/hooks/${conn.id}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Gitlab-Token": token,
          "X-Gitlab-Event": "Merge Request Hook",
          "X-Gitlab-Event-UUID": "u1",
        },
        body,
      });
    expect((await send("wrong")).status).toBe(401);
    expect((await send("glt")).status).toBe(200);
    await env.drain();
    const [merged] = (
      await env.call("GET", "/v1/activities?source=webhook", {
        token: owner.token,
      })
    ).body;
    expect(merged).toMatchObject({
      kind: "pr.merged",
      title: "Merged MR platform/billing!12: Invoice retries",
      threadKey: "gitlab:platform/billing!12",
    });
    expect(
      (await env.call("GET", "/v1/attention", { token: sam.token })).body[0]
    ).toMatchObject({ kind: "mention" });
  });

  test("webhook connections can't claim the built-in GitHub/Slack/Discord identity namespaces", async () => {
    const owner = await env.workspace();
    const res = await env.call("POST", "/v1/connections", {
      token: owner.token,
      body: {
        provider: "webhook",
        secrets: { secret: "x" },
        settings: {
          verify: { type: "token", header: "X-T" },
          identityNamespace: "github",
          rules: [{ emit: { kind: "x.y", id: "1", title: "t" } }],
        },
      },
    });
    expect(res.status).toBe(400);
  });

  test("Standard Webhooks signatures are verified with a replay window", () => {
    const secret = `whsec_${Buffer.from("supersecretkey").toString("base64")}`;
    const body = JSON.stringify({ type: "deploy.finished" });
    const ts = String(Math.floor(now.getTime() / 1000));
    const sig = createHmac("sha256", Buffer.from("supersecretkey"))
      .update(`msg_1.${ts}.${body}`)
      .digest("base64");
    const conn = {
      id: "con_x",
      workspaceId: "ws",
      provider: "webhook",
      secrets: { secret },
      settings: {
        verify: { type: "standard-webhooks" },
        rules: [
          {
            emit: {
              kind: "deploy.finished",
              id: "{{type}}",
              title: "Deployed",
            },
          },
        ],
      },
    };
    const req = (s: string, t = ts) => ({
      channel: "",
      rawBody: body,
      receivedAt: now,
      headers: new Headers({
        "webhook-id": "msg_1",
        "webhook-timestamp": t,
        "webhook-signature": `v1,${s}`,
      }),
    });
    expect(
      (webhookConnector.receive(req(sig), conn) as { type: string }).type
    ).toBe("event");
    expect(
      (webhookConnector.receive(req("forged"), conn) as { type: string }).type
    ).toBe("reject");
    expect(
      (
        webhookConnector.receive(req(sig, String(Number(ts) - 3600)), conn) as {
          type: string;
        }
      ).type
    ).toBe("reject");
  });

  test("code integrations push canonical events with an ingest-only key", async () => {
    const owner = await env.workspace();
    const conn = (
      await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: {
          provider: "custom",
          name: "Jira sync",
          settings: { identityNamespace: "jira:acme" },
        },
      })
    ).body;
    const bot = (
      await env.call("POST", "/v1/members", {
        token: owner.token,
        body: { kind: "agent", name: "Jira sync", agentProvider: "jira-sync" },
      })
    ).body.member;
    const key = (
      await env.call("POST", `/v1/members/${bot.id}/tokens`, {
        token: owner.token,
        body: { name: "sync", scopes: ["ingest"] },
      })
    ).body.token;
    await env.call("POST", "/v1/members/me/identities", {
      token: owner.token,
      body: { provider: "jira:acme", externalId: "acc-1" },
    });

    const events = [
      {
        id: "PAY-12:done",
        kind: "ticket.closed",
        occurredAt: "2026-10-26T08:00:00Z",
        actor: { id: "acc-1" },
        title: "Closed PAY-12: Retry failed invoices",
      },
      {
        id: "bad",
        kind: "NOT A KIND",
        occurredAt: "nope",
        actor: null,
        title: "",
      },
    ];
    const pushed = await env.call("POST", `/v1/connections/${conn.id}/events`, {
      token: key,
      body: { events: [events[0]] },
      headers: { "idempotency-key": "batch-1" },
    });
    expect(pushed.status).toBe(202);
    const dup = await env.call("POST", `/v1/connections/${conn.id}/events`, {
      token: key,
      body: { events: [events[0]] },
      headers: { "idempotency-key": "batch-1" },
    });
    expect(dup.body.duplicate).toBe(true);
    expect(
      (
        await env.call("POST", `/v1/connections/${conn.id}/events`, {
          token: key,
          body: { events: [events[1]] },
        })
      ).status
    ).toBe(400);
    await env.drain();
    const [closed] = (
      await env.call("GET", "/v1/activities?source=custom", {
        token: owner.token,
      })
    ).body;
    expect(closed).toMatchObject({
      kind: "ticket.closed",
      actorId: owner.member.id,
    });
  });
});

describe("agents as teammates", () => {
  test("agents report progress; people are pinged only when an agent needs them", async () => {
    const owner = await env.workspace();
    const agent = (
      await env.call("POST", "/v1/members", {
        token: owner.token,
        body: {
          kind: "agent",
          name: "Cursor agent",
          agentProvider: "cursor",
          ownerId: owner.member.id,
          issueToken: true,
        },
      })
    ).body;
    const report = async (state: string, title: string) =>
      await env.call("POST", "/v1/activities", {
        token: agent.token.token,
        body: { kind: "agent.task", title, thread: "cursor:bc-1", state },
      });

    await report("working", "Fixing the flaky payments test");
    expect(
      (await env.call("GET", "/v1/attention", { token: owner.token })).body
    ).toHaveLength(0);

    const needs = await report(
      "needs_you",
      "Should I also bump the retry limit to 5?"
    );
    expect(needs.body).toMatchObject({
      onBehalfOfId: owner.member.id,
      agentState: "needs_you",
    });
    const [item] = (
      await env.call("GET", "/v1/attention", { token: owner.token })
    ).body;
    expect(item).toMatchObject({
      kind: "agent.needs_you",
      priority: "high",
      title: "Cursor agent needs you: Should I also bump the retry limit to 5?",
    });

    await report("finished", "Fixed the flaky test (PR #31)");
    const [after] = (
      await env.call("GET", "/v1/attention", { token: owner.token })
    ).body;
    expect(after).toMatchObject({
      kind: "agent.finished",
      priority: "low",
      title: "Cursor agent finished: Fixed the flaky test (PR #31)",
    });
  });
});
