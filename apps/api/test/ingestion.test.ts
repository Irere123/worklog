import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

import { sql } from "drizzle-orm";

import { listConnectors } from "#connectors";
import { normalizeGithubLike } from "#connectors/github";
import { normalizeSyncPage } from "#connectors/github/sync";
import { isBuiltInNamespace } from "#connectors/namespaces";
import { normalizeSlackMessage } from "#connectors/slack";
import { normalizeHistory } from "#connectors/slack/events";
import { webhookConnector } from "#connectors/webhook";
import { pruneDeliveries } from "#ingest/retention";
import { hmacHex } from "#lib/crypto";
import { DAY_MS } from "#lib/time";

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

  const toBot = (text: string) =>
    normalizeSlackMessage(
      {
        type: "message",
        user: "U0EMMA",
        text,
        channel: "C0STANDUP",
        channel_type: "channel",
        ts: "1793000000.000100",
      },
      "Ev1",
      { ...settings, botUserId: "UBOT" },
      now
    );

  test("a message to the bot isn't a post, and whoever it's about isn't pinged", () => {
    expect(toBot("<@UBOT> log Shipped the retry queue").ignored).toBe(
      "addressed to Worklog"
    );
    // Asking Sam's assistant is how not to interrupt Sam.
    expect(
      toBot("<@UBOT> ask <@U0SAM> where is the retry logic?").events
    ).toEqual([]);
    // Another bot whose id starts the same way is someone else.
    expect(
      toBot("<@UBOTX> Shipped the retry queue to staging").ignored
    ).not.toBe("addressed to Worklog");
  });

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

// A pushed comment by u2 that mentions u1, under another handle and name than u1's own.
const mentionOfU1 = (id: string, at: string) => ({
  id,
  kind: "ticket.commented",
  occurredAt: at,
  actor: { id: "u2", handle: "ana" },
  title: `Commented ${id}`,
  mentions: [{ id: "u1", handle: "SAMMY", name: "wrong" }],
});

// A pushed ticket close by u1, known by its login "sam".
const closedByU1 = (id: string, at: string) => ({
  id,
  kind: "ticket.closed",
  occurredAt: at,
  actor: { id: "u1", handle: "sam" },
  title: `Closed ${id}`,
});

const daysAgo = (d: number, minutes = 0) =>
  new Date(Date.now() - d * 86_400_000 + minutes * 60_000).toISOString();

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
  test("a mention by login reaches someone already seen by their account id", async () => {
    const { owner, send } = await github();
    const sam = await env.teammate(owner.token, "Sam");
    await env.call("POST", `/v1/members/${sam.member.id}/identities`, {
      token: sam.token,
      body: { provider: "github", externalId: "202" },
    });
    const issue = {
      number: 4,
      title: "Retries",
      html_url: "https://github.com/acme/api/issues/4",
      user: emma,
      pull_request: {},
    };
    const comment = (id: number, user: object, body: string) => ({
      action: "created",
      sender: user,
      issue,
      comment: {
        id,
        body,
        html_url: "c",
        user,
        created_at: new Date().toISOString(),
      },
    });
    // Sam's account is seen (by id, with its login) before anyone mentions it.
    await send(
      "issue_comment",
      comment(1, { login: "Sam-GH", id: 202 }, "Taking a look at the retries")
    );
    await send(
      "issue_comment",
      comment(2, emma, "@sam-gh can you check the backoff?")
    );
    const items = (await env.call("GET", "/v1/attention", { token: sam.token }))
      .body;
    expect(items.map((i: any) => i.kind)).toEqual(["mention"]);
    const placeholders = await env.ctx.db.execute<{ n: number }>(sql`
      select count(*)::int as n from identities
      where workspace_id = ${owner.workspace.id} and external_id like 'handle:%'`);
    expect(placeholders.rows[0]?.n).toBe(0);
    // Being mentioned isn't being seen: Sam's account keeps its login as written, and its count.
    // (The same goes for a placeholder: see below.)
    const account = await env.ctx.db.execute<{ handle: string; n: number }>(sql`
      select external_handle as handle, event_count as n from identities
      where workspace_id = ${owner.workspace.id} and external_id = '202'`);
    expect(account.rows).toEqual([{ handle: "Sam-GH", n: 1 }]);
  });

  test("a mention of a login placeholder isn't a sighting of it", async () => {
    const { owner, send } = await github();
    const sam = await env.teammate(owner.token, "Sam");
    // Linked by login, before the account was ever seen.
    await env.call("POST", `/v1/members/${sam.member.id}/identities`, {
      token: sam.token,
      body: { provider: "github", handle: "Sam-GH" },
    });
    await send("issue_comment", {
      action: "created",
      sender: emma,
      issue: {
        number: 5,
        title: "Backoff",
        html_url: "https://github.com/acme/api/issues/5",
        user: emma,
        pull_request: {},
      },
      comment: {
        id: 51,
        body: "@sam-gh can you look at the backoff?",
        html_url: "c",
        user: emma,
        created_at: new Date().toISOString(),
      },
    });
    const items = (await env.call("GET", "/v1/attention", { token: sam.token }))
      .body;
    expect(items.map((i: any) => i.kind)).toEqual(["mention"]);
    const placeholder = await env.ctx.db.execute<{
      handle: string;
      n: number;
    }>(sql`
      select external_handle as handle, event_count as n from identities
      where workspace_id = ${owner.workspace.id} and external_id = 'handle:sam-gh'`);
    expect(placeholder.rows).toEqual([{ handle: "Sam-GH", n: 0 }]);
  });

  test("bursts read back newest first stay apart by days, and together within minutes", async () => {
    const { owner, send } = await github();
    // A backfill reads history newest first.
    const times = [daysAgo(1, 2), daysAgo(1), daysAgo(5), daysAgo(9)];
    for (const [i, at] of times.entries()) {
      await send("push", {
        ref: "refs/heads/main",
        after: `old${i}`,
        sender: emma,
        commits: [{ id: `o${i}`, message: `step ${i}` }],
        head_commit: { timestamp: at },
      });
    }
    const pushes = (
      await env.call("GET", "/v1/activities?kind=code.pushed", {
        token: owner.token,
      })
    ).body;
    expect(pushes.map((p: any) => p.title)).toEqual([
      "Pushed 2 commits to acme/api:main",
      "Pushed 1 commit to acme/api:main",
      "Pushed 1 commit to acme/api:main",
    ]);
    // The burst spans both pushes: from the older, though it came second.
    const [burst] = pushes;
    expect(burst.occurredAt).toBe(times[1]);
  });

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

  test("deliveries past retention are pruned, and replay keeps the activity they produced", async () => {
    const { owner, conn, send } = await github();
    const longAgo = new Date(Date.now() - 100 * DAY_MS);
    env.ctx.now = () => longAgo;
    await send("push", {
      ref: "refs/heads/x",
      after: "p1",
      sender: emma,
      commits: [{ id: "1", message: "m" }],
    });
    env.ctx.now = () => new Date();
    await send("pull_request", {
      action: "closed",
      sender: emma,
      pull_request: {
        number: 3,
        title: "Ship",
        html_url: "u",
        user: emma,
        merged: true,
        closed_at: new Date().toISOString(),
      },
    });

    // The ledger goes with the deliveries.
    await env.ctx.db.execute(sql`
      update ingested_events set created_at = now() - interval '100 days'
      where connection_id = ${conn.id} and external_id like 'push:%'`);
    await pruneDeliveries(env.ctx);
    const deliveries = (
      await env.call("GET", `/v1/connections/${conn.id}/deliveries`, {
        token: owner.token,
      })
    ).body;
    expect(deliveries.map((d: any) => d.eventType)).toEqual(["pull_request"]);
    const ledger = await env.ctx.db.execute<{ id: string }>(sql`
      select external_id as id from ingested_events where connection_id = ${conn.id}`);
    expect(ledger.rows.map((r) => r.id.split(":")[0])).toEqual(["pr"]);

    await env.call("POST", `/v1/connections/${conn.id}/replay`, {
      token: owner.token,
      body: {},
    });
    await env.drain();
    const kinds = (
      await env.call("GET", "/v1/activities?source=github", {
        token: owner.token,
      })
    ).body.map((a: any) => a.kind);
    expect(kinds.toSorted()).toEqual(["code.pushed", "pr.merged"]);
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

  test("generic connections can't claim a built-in connector's identity namespace", async () => {
    const owner = await env.workspace();
    for (const identityNamespace of [
      "github",
      "gitea:git.example.com",
      "slack",
      "discord",
    ]) {
      const webhook = await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: {
          provider: "webhook",
          secrets: { secret: "x" },
          settings: {
            verify: { type: "token", header: "X-T" },
            identityNamespace,
            rules: [{ emit: { kind: "x.y", id: "1", title: "t" } }],
          },
        },
      });
      expect(webhook.status).toBe(400);
      const custom = await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: { provider: "custom", settings: { identityNamespace } },
      });
      expect(custom.status).toBe(400);
    }
  });

  test("one that took a namespace before it was reserved can still change everything else", async () => {
    const owner = await env.workspace();
    const conn = (
      await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: {
          provider: "custom",
          settings: { identityNamespace: "jira:acme" },
        },
      })
    ).body;
    await env.ctx.db.execute(sql`
      update connections set settings = jsonb_set(settings, '{identityNamespace}', '"gitea:git.example.com"')
      where id = ${conn.id}`);
    const renamed = await env.call("PATCH", `/v1/connections/${conn.id}`, {
      token: owner.token,
      body: { name: "Jira (old)" },
    });
    expect(renamed.status).toBe(200);
    const moved = await env.call("PATCH", `/v1/connections/${conn.id}`, {
      token: owner.token,
      body: { settings: { identityNamespace: "slack" } },
    });
    expect(moved.status).toBe(400);
  });

  test("a namespace held from before it was reserved isn't used: its users aren't impersonated", async () => {
    const owner = await env.workspace();
    await env.call("POST", "/v1/members/me/identities", {
      token: owner.token,
      body: { provider: "github", externalId: "101" },
    });
    const conn = (
      await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: {
          provider: "custom",
          settings: { identityNamespace: "jira:acme" },
        },
      })
    ).body;
    await env.ctx.db.execute(sql`
      update connections set settings = jsonb_set(settings, '{identityNamespace}', '"github"')
      where id = ${conn.id}`);
    await env.call("POST", `/v1/connections/${conn.id}/events`, {
      token: owner.token,
      body: {
        events: [
          {
            id: "fake-1",
            kind: "pr.merged",
            occurredAt: new Date().toISOString(),
            actor: { id: "101" },
            title: "Merged something as Emma",
          },
        ],
      },
    });
    await env.drain();
    const [merged] = (
      await env.call("GET", "/v1/activities?kind=pr.merged", {
        token: owner.token,
      })
    ).body;
    expect(merged.actorId).toBeNull();
  });

  test("a connection can't take another's own namespace, and health says which one is used", async () => {
    const owner = await env.workspace();
    const other = (
      await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: { provider: "custom", name: "Jira" },
      })
    ).body;
    const taking = await env.call("POST", "/v1/connections", {
      token: owner.token,
      body: {
        provider: "custom",
        settings: { identityNamespace: `custom:${other.id}` },
      },
    });
    expect(taking.status).toBe(400);
    // One that held a reserved namespace from before uses its own, and says so.
    await env.ctx.db.execute(sql`
      update connections set settings = jsonb_set(settings, '{identityNamespace}', '"github"')
      where id = ${other.id}`);
    const health = (
      await env.call("GET", `/v1/connections/${other.id}/health`, {
        token: owner.token,
      })
    ).body;
    expect(health.identityNamespace).toBe(`custom:${other.id}`);
  });

  test("named and acting in one delivery, an account counts once, as it said, when it acted", async () => {
    const owner = await env.workspace();
    const conn = (
      await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: {
          provider: "custom",
          settings: { identityNamespace: "jira:acme" },
        },
      })
    ).body;
    await env.call("POST", `/v1/connections/${conn.id}/events`, {
      token: owner.token,
      body: {
        events: [
          mentionOfU1("c1", "2026-10-01T09:00:00Z"),
          {
            id: "d1",
            kind: "ticket.closed",
            occurredAt: "2026-10-20T09:00:00Z",
            actor: { id: "u1", handle: "sam.k", name: "Sam K" },
            title: "Closed PAY-1",
          },
          mentionOfU1("c2", "2026-10-02T09:00:00Z"),
        ],
      },
    });
    await env.drain();
    const [u1] = (
      await env.ctx.db.execute<{
        handle: string;
        name: string;
        n: number;
        last: Date;
      }>(sql`
        select external_handle as handle, display_name as name, event_count as n,
          last_seen_at as last
        from identities where workspace_id = ${owner.workspace.id} and external_id = 'u1'`)
    ).rows;
    expect(u1).toMatchObject({ handle: "sam.k", name: "Sam K", n: 1 });
    expect(new Date(u1?.last ?? 0).toISOString()).toBe(
      "2026-10-20T09:00:00.000Z"
    );
  });

  test("an action that leaves things out isn't filled in by a mention, and a burst of actions spans its times", async () => {
    const owner = await env.workspace();
    const conn = (
      await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: {
          provider: "custom",
          settings: { identityNamespace: "jira:beta" },
        },
      })
    ).body;
    await env.call("POST", `/v1/connections/${conn.id}/events`, {
      token: owner.token,
      body: {
        events: [
          {
            id: "d1",
            kind: "ticket.closed",
            occurredAt: "2026-10-05T09:00:00Z",
            actor: { id: "u1" },
            title: "Closed PAY-2",
          },
          {
            ...mentionOfU1("c1", "2026-10-03T09:00:00Z"),
            mentions: [{ id: "u1", handle: "SAMMY", name: "wrong", bot: true }],
          },
          {
            id: "d0",
            kind: "ticket.closed",
            occurredAt: "2026-10-02T09:00:00Z",
            actor: { id: "u1" },
            title: "Closed PAY-1",
          },
        ],
      },
    });
    await env.drain();
    const [u1] = (
      await env.ctx.db.execute<{
        handle: string | null;
        bot: boolean;
        first: Date;
        last: Date;
      }>(sql`
        select external_handle as handle, is_bot as bot, first_seen_at as first,
          last_seen_at as last
        from identities where workspace_id = ${owner.workspace.id} and external_id = 'u1'`)
    ).rows;
    expect(u1).toMatchObject({ handle: null, bot: false });
    expect(new Date(u1?.first ?? 0).toISOString()).toBe(
      "2026-10-02T09:00:00.000Z"
    );
    expect(new Date(u1?.last ?? 0).toISOString()).toBe(
      "2026-10-05T09:00:00.000Z"
    );
    // Not taken for a bot, so its own closes are recorded.
    const closed = (
      await env.call("GET", "/v1/activities?kind=ticket.closed", {
        token: owner.token,
      })
    ).body;
    expect(closed).toHaveLength(2);
  });

  test("an account linked by login before it's seen spans its first delivery's actions too", async () => {
    const owner = await env.workspace();
    await env.call("POST", "/v1/members/me/identities", {
      token: owner.token,
      body: { provider: "jira:gamma", handle: "sam" },
    });
    const conn = (
      await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: {
          provider: "custom",
          settings: { identityNamespace: "jira:gamma" },
        },
      })
    ).body;
    await env.call("POST", `/v1/connections/${conn.id}/events`, {
      token: owner.token,
      body: {
        events: [
          closedByU1("PAY-5", "2026-10-05T09:00:00Z"),
          closedByU1("PAY-2", "2026-10-02T09:00:00Z"),
        ],
      },
    });
    await env.drain();
    const [u1] = (
      await env.ctx.db.execute<{ first: Date; last: Date; member: string }>(sql`
        select first_seen_at as first, last_seen_at as last, member_id as member
        from identities where workspace_id = ${owner.workspace.id} and external_id = 'u1'`)
    ).rows;
    expect(u1?.member).toBe(owner.member.id);
    expect(new Date(u1?.first ?? 0).toISOString()).toBe(
      "2026-10-02T09:00:00.000Z"
    );
    expect(new Date(u1?.last ?? 0).toISOString()).toBe(
      "2026-10-05T09:00:00.000Z"
    );
  });

  test("namespaces under the generic prefixes are free, but not another connection's own", async () => {
    const owner = await env.workspace();
    for (const name of ["one", "two"]) {
      const shared = await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: {
          provider: "custom",
          name,
          settings: { identityNamespace: "webhook:gitlab" },
        },
      });
      expect(shared.status).toBe(201);
    }
    const taking = await env.call("POST", "/v1/connections", {
      token: owner.token,
      body: {
        provider: "custom",
        settings: { identityNamespace: "webhook:con_01abc" },
      },
    });
    expect(taking.status).toBe(400);
  });

  test("every built-in connector's namespace is reserved", () => {
    for (const connector of listConnectors()) {
      expect([connector.id, isBuiltInNamespace(connector.id)]).toEqual([
        connector.id,
        connector.perConnection !== true,
      ]);
    }
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

describe("connections that choose their own event ids", () => {
  test("two in one workspace can name different events alike", async () => {
    const owner = await env.workspace();
    const pushTo = async (name: string) => {
      const conn = (
        await env.call("POST", "/v1/connections", {
          token: owner.token,
          body: {
            provider: "custom",
            name,
            settings: { identityNamespace: `jira:${name}` },
          },
        })
      ).body;
      const pushed = await env.call(
        "POST",
        `/v1/connections/${conn.id}/events`,
        {
          token: owner.token,
          body: {
            events: [
              {
                id: "PAY-12:closed",
                kind: "ticket.closed",
                occurredAt: new Date().toISOString(),
                actor: null,
                title: `Closed PAY-12 in ${name}`,
              },
            ],
          },
        }
      );
      expect(pushed.status).toBe(202);
    };
    await pushTo("billing");
    await pushTo("payroll");
    await env.drain();
    const closed = (
      await env.call("GET", "/v1/activities?kind=ticket.closed", {
        token: owner.token,
      })
    ).body;
    expect(closed.map((a: any) => a.title).toSorted()).toEqual([
      "Closed PAY-12 in billing",
      "Closed PAY-12 in payroll",
    ]);
  });
});

describe("upgrading to ids counted within the connection", () => {
  test("what a generic connection recorded before still matches its redeliveries", async () => {
    const owner = await env.workspace();
    const conn = (
      await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: {
          provider: "custom",
          name: "Jira",
          settings: { identityNamespace: "jira:old" },
        },
      })
    ).body;
    const event = {
      id: "PAY-12:closed",
      kind: "ticket.closed",
      occurredAt: new Date().toISOString(),
      actor: null,
      title: "Closed PAY-12",
    };
    const push = async () => {
      await env.call("POST", `/v1/connections/${conn.id}/events`, {
        token: owner.token,
        body: { events: [event] },
      });
      await env.drain();
    };
    await push();
    // As it was recorded before ids were scoped to their connection.
    await env.ctx.db.execute(sql`
      update activities set external_id = 'PAY-12:closed' where connection_id = ${conn.id}`);
    await env.ctx.db.execute(sql`
      update ingested_events set external_id = 'PAY-12:closed' where connection_id = ${conn.id}`);
    // And an event redelivered between the two changes, recorded both ways.
    await env.call("POST", `/v1/connections/${conn.id}/events`, {
      token: owner.token,
      body: {
        events: [{ ...event, id: "PAY-13:closed", title: "Closed PAY-13" }],
      },
    });
    await env.drain();
    await env.ctx.db.execute(sql`
      insert into activities (id, workspace_id, source, kind, title, visibility, external_id, data, connection_id, importance, count, occurred_at, updated_at, created_at)
      select 'act_old_twin', workspace_id, source, kind, title, visibility, 'PAY-13:closed', data, connection_id, importance, count, occurred_at, updated_at, created_at
      from activities where connection_id = ${conn.id} and external_id like '%PAY-13:closed'`);
    const migration = readFileSync(
      new URL("../drizzle/0015_generic_ids.sql", import.meta.url),
      "utf-8"
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      await env.ctx.db.execute(sql.raw(statement));
    }
    await push();
    const closed = (
      await env.call("GET", "/v1/activities?kind=ticket.closed", {
        token: owner.token,
      })
    ).body;
    expect(closed.map((a: any) => a.title).toSorted()).toEqual([
      "Closed PAY-12",
      "Closed PAY-13",
    ]);
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

// The id GitHub's webhook for this would give the event.
const webhook = (type: string, payload: object) =>
  gh(type, payload).events[0]?.id ?? "none";

describe("history read back from APIs", () => {
  const since = "2026-10-20T00:00:00Z";
  const author = { __typename: "User", login: "emma-gh", databaseId: 101 };
  const reviewer = { __typename: "User", login: "sam-gh", databaseId: 202 };
  const page = (stage: string, nodes: unknown[]) => ({
    repo: { id: 501, full_name: "acme/api" },
    since,
    stage,
    nodes,
  });

  const node = (number: number, extra: object) => ({
    number,
    title: `PR ${number}`,
    url: `u${number}`,
    isDraft: false,
    createdAt: "2026-10-01T08:00:00Z",
    updatedAt: "2026-10-23T08:00:00Z",
    closedAt: null,
    mergedAt: null,
    author,
    mergedBy: null,
    reviewRequests: { nodes: [] },
    reviews: { nodes: [] },
    comments: { nodes: [] },
    timelineItems: { nodes: [] },
    ...extra,
  });

  test("a GitHub PR read back gets the same event ids as its webhooks", () => {
    const pr = {
      number: 7,
      title: "Retry payments",
      url: "https://github.com/acme/api/pull/7",
      isDraft: false,
      createdAt: "2026-10-21T08:00:00Z",
      updatedAt: "2026-10-22T09:00:00Z",
      closedAt: "2026-10-22T09:00:00Z",
      mergedAt: "2026-10-22T09:00:00Z",
      author,
      mergedBy: author,
      reviewRequests: { nodes: [] },
      reviews: {
        nodes: [
          {
            databaseId: 9,
            state: "APPROVED",
            body: "LGTM",
            url: "r",
            submittedAt: "2026-10-22T08:00:00Z",
            author: reviewer,
            comments: {
              nodes: [
                {
                  databaseId: 77,
                  body: "Cap this",
                  url: "lc",
                  createdAt: "2026-10-22T08:00:00Z",
                  author: reviewer,
                },
              ],
            },
          },
        ],
      },
      comments: { nodes: [] },
      timelineItems: { nodes: [] },
    };
    const synced = normalizeSyncPage("github", page("pulls", [pr]), now, {});
    const ids = synced.events
      .map((e) => e.id)
      .toSorted((a, b) => a.localeCompare(b));
    expect(ids).toEqual(
      [
        webhook("pull_request", {
          action: "opened",
          pull_request: {
            number: 7,
            title: "Retry payments",
            html_url: pr.url,
            user: emma,
            created_at: pr.createdAt,
            updated_at: pr.createdAt,
          },
        }),
        webhook("pull_request", {
          action: "closed",
          pull_request: {
            number: 7,
            title: "Retry payments",
            html_url: pr.url,
            user: emma,
            merged: true,
            closed_at: pr.closedAt,
          },
        }),
        webhook("pull_request_review_comment", {
          action: "created",
          pull_request: {
            number: 7,
            title: "Retry payments",
            html_url: "https://github.com/acme/api/pull/7",
            user: emma,
          },
          comment: {
            id: 77,
            body: "Cap this",
            html_url: "lc",
            user: { login: "sam-gh", id: 202 },
          },
        }),
        webhook("pull_request_review", {
          action: "submitted",
          pull_request: {
            number: 7,
            title: "Retry payments",
            html_url: pr.url,
            user: emma,
          },
          review: {
            id: 9,
            state: "approved",
            body: "LGTM",
            html_url: "r",
            user: { login: "sam-gh", id: 202 },
          },
        }),
      ].toSorted((a, b) => a.localeCompare(b))
    );
  });

  test("a draft is not opened, history before the window is skipped, and open requests are kept hidden", () => {
    const synced = normalizeSyncPage(
      "github",
      page("pulls", [
        node(1, { isDraft: true, createdAt: "2026-10-22T08:00:00Z" }),
        node(2, {
          reviewRequests: {
            nodes: [{ requestedReviewer: reviewer }, { requestedReviewer: {} }],
          },
        }),
      ]),
      now,
      {}
    );
    expect(synced.events).toHaveLength(1);
    expect(synced.events[0]).toMatchObject({
      id: "pr:github:acme/api#2:awaiting:202",
      hidden: true,
      signals: [{ type: "review_requested", who: { id: "202" } }],
    });
  });

  test("a push read back from the repository's activity matches its webhook", () => {
    const after = "f".repeat(40);
    const synced = normalizeSyncPage(
      "github",
      {
        ...page("pushes", [
          {
            before: "e".repeat(40),
            after,
            ref: "refs/heads/retry",
            timestamp: "2026-10-22T10:00:00Z",
            actor: { login: "emma-gh", id: 101, type: "User" },
            total_commits: 2,
            commits: [
              { id: "1", message: "Add jitter" },
              { id: "2", message: "Cap at 5" },
            ],
          },
        ]),
        repo: { id: 501, full_name: "acme/api", default_branch: "main" },
      },
      now,
      {}
    );
    const live = gh("push", {
      ref: "refs/heads/retry",
      after,
      commits: [
        { id: "1", message: "Add jitter" },
        { id: "2", message: "Cap at 5" },
      ],
    });
    expect(synced.events.map((e) => [e.id, e.title])).toEqual(
      live.events.map((e) => [e.id, e.title])
    );
  });

  test("Slack history goes through the same rules as live messages", () => {
    const settings = { channels: ["C1"], channelNames: { C1: "standup" } };
    const out = normalizeHistory(
      {
        channel: "C1",
        private: false,
        messages: [
          {
            type: "message",
            user: "U1",
            text: "Shipped billing retries to prod",
            ts: "1793000000.000100",
          },
          { type: "message", user: "U1", text: "ok", ts: "1793000001.000100" },
          {
            type: "message",
            subtype: "channel_join",
            user: "U2",
            text: "joined",
            ts: "1793000002.000100",
          },
        ],
      },
      settings,
      now
    );
    expect(out.events.map((e) => e.id)).toEqual(["slack:C1:1793000000.000100"]);
    expect(out.events[0]?.title).toBe(
      "Posted in #standup: Shipped billing retries to prod"
    );
  });
});
