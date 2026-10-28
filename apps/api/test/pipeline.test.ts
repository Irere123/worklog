import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { setTimeout as sleep } from "node:timers/promises";

import { sql } from "drizzle-orm";

import { deliver as sendTo } from "#automations/delivery";
import { laneOf, LANES } from "#ingest/lanes";
import { drainLane, processInbound } from "#ingest/process";
import { pruneIngestState } from "#ingest/retention";
import { noticeSilence } from "#ingest/silence";
import { enqueue } from "#jobs/queue";
import { hmacHex } from "#lib/crypto";
import { DAY_MS } from "#lib/time";

import { testEnv } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});
beforeEach(() => {
  env.reset();
});

const repo = { id: 501, full_name: "acme/api", default_branch: "main" };
const emma = { login: "emma-gh", id: 101 };
const sam = { login: "sam-gh", id: 202 };
const pr = {
  number: 7,
  title: "Retry payments",
  html_url: "https://github.com/acme/api/pull/7",
  user: emma,
  updated_at: "2026-10-26T08:00:00Z",
};

async function github(settings: Record<string, unknown> = {}) {
  const owner = await env.workspace();
  const teammate = await env.teammate(owner.token, "Sam");
  const conn = (
    await env.call("POST", "/v1/connections", {
      token: owner.token,
      body: { provider: "github", secrets: { webhookSecret: "s" }, settings },
    })
  ).body;
  await env.call("POST", "/v1/members/me/identities", {
    token: owner.token,
    body: { provider: "github", externalId: "101" },
  });
  await env.call("POST", `/v1/members/${teammate.member.id}/identities`, {
    token: teammate.token,
    body: { provider: "github", externalId: "202" },
  });
  let n = 0;
  const deliver = async (
    event: string,
    payload: object,
    opts: { delivery?: string; secret?: string; drain?: boolean } = {}
  ) => {
    n += 1;
    const raw = JSON.stringify({ repository: repo, ...payload });
    const res = await env.app.request(
      new URL(conn.webhookUrls.webhook).pathname,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": event,
          "x-github-delivery": opts.delivery ?? `d${n}-${Math.random()}`,
          "x-hub-signature-256": `sha256=${hmacHex(opts.secret ?? "s", raw)}`,
        },
        body: raw,
      }
    );
    if (opts.drain !== false) {
      await env.drain();
    }
    return res;
  };
  const activities = async (query = "") =>
    (await env.call("GET", `/v1/activities${query}`, { token: owner.token }))
      .body;
  return { owner, teammate, conn, deliver, activities };
}

// A body without a length, as a chunked upload sends it. A provider with no app answers without
// touching the database.
async function streamed(body: string, path = "/hooks/apps/nobody") {
  return await env.app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: new Blob([body]).stream(),
  });
}

const push = (after: string, ids: string[]) => ({
  ref: "refs/heads/feature",
  after,
  sender: emma,
  commits: ids.map((id) => ({ id, message: `commit ${id}` })),
});

describe("exactly once", () => {
  test("an event merged into a burst is counted once, however often it arrives", async () => {
    const { deliver, activities } = await github();
    await deliver("push", push("a1", ["1", "2"]));
    await deliver("push", push("a2", ["3"]));
    // The same pushes again under new delivery ids: what a sync re-reading them looks like.
    await deliver("push", push("a2", ["3"]));
    await deliver("push", push("a1", ["1", "2"]));
    const [burst] = await activities("?kind=code.pushed");
    expect(burst).toMatchObject({
      title: "Pushed 3 commits to acme/api:feature",
      count: 2,
    });
  });

  test("processing a delivery again (a retry after a crash) changes nothing", async () => {
    const { owner, teammate, conn, deliver, activities } = await github();
    await deliver("pull_request", {
      action: "review_requested",
      sender: emma,
      pull_request: pr,
      requested_reviewer: sam,
    });
    await deliver("push", push("b1", ["1"]));
    const deliveries = (
      await env.call("GET", `/v1/connections/${conn.id}/deliveries`, {
        token: owner.token,
      })
    ).body;
    for (const d of deliveries) {
      await processInbound(env.ctx, d.id);
    }
    const [item] = (
      await env.call("GET", "/v1/attention", { token: teammate.token })
    ).body;
    expect(item).toMatchObject({ kind: "review.requested", count: 1 });
    const [pushed] = await activities("?kind=code.pushed");
    expect(pushed).toMatchObject({
      count: 1,
      title: expect.stringContaining("1 commit"),
    });
  });

  test("a redelivery of a delivery that failed is processed again", async () => {
    const { conn, deliver, activities } = await github();
    await deliver("push", push("c1", ["1"]), { delivery: "flaky" });
    // As if every attempt had failed and the queue had given up.
    await env.ctx.db.execute(sql`
      update inbound_events set status = 'failed', error = 'boom'
      where connection_id = ${conn.id}`);
    await env.ctx.db.execute(sql`
      delete from activities where connection_id = ${conn.id}`);
    const res = await deliver("push", push("c1", ["1"]), { delivery: "flaky" });
    expect(await res.json()).toEqual({ ok: true, duplicate: true });
    expect(await activities("?kind=code.pushed")).toHaveLength(1);
  });

  test("a delivery that fails doesn't hold back the ones processed with it, and is retried alone", async () => {
    const { conn, deliver, activities } = await github();
    await env.ctx.db.execute(
      sql.raw(`
        create function test_poison() returns trigger language plpgsql as $$
          begin
            if new.title like '%:poison%' then raise exception 'poisoned'; end if;
            return new;
          end $$;
        create trigger test_poison before insert on activities
          for each row execute function test_poison();
      `)
    );
    try {
      for (const branch of ["first", "poison", "last"]) {
        await deliver(
          "push",
          { ...push(`g-${branch}`, [branch]), ref: `refs/heads/${branch}` },
          { delivery: `g-${branch}`, drain: false }
        );
      }
      await env.drain();
    } finally {
      await env.ctx.db.execute(
        sql.raw(`
          drop trigger test_poison on activities;
          drop function test_poison();
        `)
      );
    }
    const titles = async () =>
      (await activities("?kind=code.pushed"))
        .map((a: any) => a.title)
        .toSorted();
    expect(await titles()).toEqual([
      "Pushed 1 commit to acme/api:first",
      "Pushed 1 commit to acme/api:last",
    ]);
    const states = await env.ctx.db.execute<{
      delivery_id: string;
      status: string;
      attempts: number;
      waits: boolean;
    }>(sql`
      select delivery_id, status, attempts, retry_at > now() as waits
      from inbound_events where connection_id = ${conn.id} order by delivery_id`);
    expect(states.rows).toEqual([
      { delivery_id: "g-first", status: "processed", attempts: 1, waits: null },
      { delivery_id: "g-last", status: "processed", attempts: 1, waits: null },
      { delivery_id: "g-poison", status: "failed", attempts: 1, waits: true },
    ] as any);

    await env.ctx.db.execute(sql`
      update inbound_events set retry_at = now() - interval '1 second'
      where connection_id = ${conn.id} and delivery_id = 'g-poison'`);
    const [{ lane } = { lane: 0 }] = (
      await env.ctx.db.execute<{ lane: number }>(
        sql`select lane from inbound_events where connection_id = ${conn.id} limit 1`
      )
    ).rows;
    await drainLane(env.ctx, conn.id, lane);
    expect(await titles()).toEqual([
      "Pushed 1 commit to acme/api:first",
      "Pushed 1 commit to acme/api:last",
      "Pushed 1 commit to acme/api:poison",
    ]);
  });

  test("a delivery two processors take at once is done once, and says what it did", async () => {
    const { conn, deliver } = await github();
    await deliver("push", push("race", ["1"]), {
      delivery: "raced",
      drain: false,
    });
    const [row] = (
      await env.ctx.db.execute<{ id: string; lane: number }>(
        sql`select id, lane from inbound_events where connection_id = ${conn.id}`
      )
    ).rows;
    // A job queued before lanes, running beside the lane's drain.
    await Promise.all([
      processInbound(env.ctx, row?.id ?? ""),
      drainLane(env.ctx, conn.id, row?.lane ?? 0),
    ]);
    const [done] = (
      await env.ctx.db.execute<{
        status: string;
        attempts: number;
        kept: number;
      }>(sql`
        select status, attempts, (outcome->>'kept')::int as kept
        from inbound_events where connection_id = ${conn.id}`)
    ).rows;
    expect(done).toEqual({ status: "processed", attempts: 1, kept: 1 });
  });

  test("deleting a connection while its deliveries are being processed waits for them", async () => {
    const { owner, conn, deliver } = await github();
    for (const branch of ["a", "b"]) {
      await deliver(
        "push",
        { ...push(`del-${branch}`, [branch]), ref: `refs/heads/${branch}` },
        { drain: false }
      );
    }
    const [{ lane } = { lane: 0 }] = (
      await env.ctx.db.execute<{ lane: number }>(
        sql`select lane from inbound_events where connection_id = ${conn.id} limit 1`
      )
    ).rows;
    // Slows the drain after it has locked its deliveries and before its first write refers to the
    // connection (the check of that reference comes after the row), where the delete lands.
    await env.ctx.db.execute(
      sql.raw(`
        create function test_slow() returns trigger language plpgsql as $$
          begin perform pg_sleep(0.3); return new; end $$;
        create trigger test_slow before insert on ingested_events
          for each row execute function test_slow();
      `)
    );
    try {
      const draining = drainLane(env.ctx, conn.id, lane);
      await sleep(150);
      const removed = await env.call("DELETE", `/v1/connections/${conn.id}`, {
        token: owner.token,
      });
      await draining;
      expect(removed.status).toBe(200);
    } finally {
      await env.ctx.db.execute(
        sql.raw(`
          drop trigger test_slow on ingested_events;
          drop function test_slow();
        `)
      );
    }
  });

  test("a delivery whose drain was lost is picked up within a minute", async () => {
    const { conn, deliver, activities } = await github();
    await deliver("push", push("lost", ["1"]), { drain: false });
    // As if the job queuing had lost its race with a drain already under way.
    await env.ctx.db.execute(sql`
      delete from graphile_worker._private_jobs
      where key like ${`%:${conn.id}:%`}`);
    await env.drain();
    expect(await activities("?kind=code.pushed")).toHaveLength(0);
    // Not yet: a drain may just be busy.
    await enqueue(env.ctx, "ingest:sweep", {});
    await env.drain();
    expect(await activities("?kind=code.pushed")).toHaveLength(0);
    await env.ctx.db.execute(sql`
      update inbound_events set received_at = now() - interval '2 minutes'
      where connection_id = ${conn.id}`);
    await enqueue(env.ctx, "ingest:sweep", {});
    await env.drain();
    expect(await activities("?kind=code.pushed")).toHaveLength(1);
  });

  test("a drain of new deliveries keeps the lane's later retries booked", async () => {
    const { conn, deliver } = await github();
    await deliver("push", push("r1", ["1"]), { delivery: "later" });
    const [{ lane } = { lane: 0 }] = (
      await env.ctx.db.execute<{ lane: number }>(
        sql`select lane from inbound_events where connection_id = ${conn.id} limit 1`
      )
    ).rows;
    // Failed, due in an hour, and the job that held its retry already ran.
    await env.ctx.db.execute(sql`
      update inbound_events set status = 'failed', attempts = 1,
        retry_at = now() + interval '1 hour'
      where connection_id = ${conn.id}`);
    await env.ctx.db.execute(sql`
      delete from graphile_worker._private_jobs where key like ${`%:${conn.id}:%`}`);
    await deliver("push", push("r2", ["2"]), { drain: false });
    await drainLane(env.ctx, conn.id, lane);
    const retry = await env.ctx.db.execute<{ due: boolean }>(sql`
      select run_at > now() + interval '50 minutes' as due
      from graphile_worker._private_jobs where key = ${`retry:${conn.id}:${lane}`}`);
    expect(retry.rows).toEqual([{ due: true }]);
  });

  test("a lane held by a worker that died is freed and drained", async () => {
    const { conn, deliver, activities } = await github();
    await deliver("push", push("dead", ["1"]), { drain: false });
    // Its drain started on a worker that was then killed: the job and its lane's queue stay
    // locked, and Graphile Worker would wait four hours to free them.
    await env.ctx.db.execute(sql`
      update graphile_worker._private_jobs
      set locked_at = now() - interval '15 minutes', locked_by = 'dead-worker', attempts = 1
      where key like ${`lane:${conn.id}:%`}`);
    await env.ctx.db.execute(sql`
      update graphile_worker._private_job_queues
      set locked_at = now() - interval '15 minutes', locked_by = 'dead-worker'
      where queue_name like ${`ingest:${conn.id}:%`}`);
    await env.ctx.db.execute(sql`
      update inbound_events set received_at = now() - interval '2 minutes'
      where connection_id = ${conn.id}`);
    await enqueue(env.ctx, "ingest:sweep", {});
    await env.drain();
    expect(await activities("?kind=code.pushed")).toHaveLength(1);
  });

  test("failed deliveries in one lane each get retried at their own time", async () => {
    const { conn, deliver, activities } = await github();
    await deliver("push", push("f1", ["1"]), { delivery: "due" });
    await deliver(
      "push",
      { ...push("f2", ["2"]), ref: "refs/heads/other" },
      { delivery: "later" }
    );
    // As if both had failed: one is due now, the other in an hour.
    await env.ctx.db.execute(sql`
      update inbound_events set status = 'failed',
        retry_at = case delivery_id when 'due' then now() - interval '1 second' else now() + interval '1 hour' end
      where connection_id = ${conn.id}`);
    await env.ctx.db.execute(
      sql`delete from activities where connection_id = ${conn.id}`
    );
    await env.ctx.db.execute(
      sql`delete from ingested_events where connection_id = ${conn.id}`
    );
    const [{ lane } = { lane: 0 }] = (
      await env.ctx.db.execute<{ lane: number }>(
        sql`select lane from inbound_events where connection_id = ${conn.id} limit 1`
      )
    ).rows;
    await drainLane(env.ctx, conn.id, lane);
    expect(await activities("?kind=code.pushed")).toHaveLength(1);
    const retry = await env.ctx.db.execute<{ run_at: Date }>(sql`
      select run_at from graphile_worker._private_jobs
      where key = ${`retry:${conn.id}:${lane}`}`);
    expect(retry.rows).toHaveLength(1);
    expect(new Date(retry.rows[0]?.run_at ?? 0).getTime()).toBeGreaterThan(
      Date.now() + 50 * 60_000
    );
  });
});

describe("ordering", () => {
  test("a review request that arrives after the review doesn't reopen it", async () => {
    const { teammate, deliver } = await github();
    await deliver("pull_request_review", {
      action: "submitted",
      sender: sam,
      pull_request: pr,
      review: {
        id: 9,
        state: "approved",
        body: "LGTM",
        html_url: "r",
        user: sam,
        submitted_at: "2026-10-26T09:00:00Z",
      },
    });
    await deliver("pull_request", {
      action: "review_requested",
      sender: emma,
      pull_request: { ...pr, updated_at: "2026-10-26T08:00:00Z" },
      requested_reviewer: sam,
    });
    const open = (
      await env.call("GET", "/v1/attention", { token: teammate.token })
    ).body;
    expect(open.filter((a: any) => a.kind === "review.requested")).toHaveLength(
      0
    );

    // Asked again after that review: a new request.
    await deliver("pull_request", {
      action: "review_requested",
      sender: emma,
      pull_request: { ...pr, updated_at: "2026-10-26T10:00:00Z" },
      requested_reviewer: sam,
    });
    const again = (
      await env.call("GET", "/v1/attention", { token: teammate.token })
    ).body;
    expect(
      again.filter((a: any) => a.kind === "review.requested")
    ).toHaveLength(1);
  });

  test("closing a PR resolves its review requests for everyone, including ones that arrive late", async () => {
    const { teammate, deliver } = await github();
    await deliver("pull_request", {
      action: "closed",
      sender: emma,
      pull_request: {
        ...pr,
        merged: true,
        closed_at: "2026-10-26T09:00:00Z",
        merged_at: "2026-10-26T09:00:00Z",
        updated_at: "2026-10-26T09:00:00Z",
      },
    });
    await deliver("pull_request", {
      action: "review_requested",
      sender: emma,
      pull_request: pr,
      requested_reviewer: sam,
    });
    expect(
      (await env.call("GET", "/v1/attention", { token: teammate.token })).body
    ).toHaveLength(0);
  });

  test("a bot closing a PR isn't recorded, and still resolves its review requests", async () => {
    const { teammate, deliver, activities } = await github();
    await deliver("pull_request", {
      action: "review_requested",
      sender: emma,
      pull_request: pr,
      requested_reviewer: sam,
    });
    expect(
      (await env.call("GET", "/v1/attention", { token: teammate.token })).body
    ).toHaveLength(1);
    await deliver("pull_request", {
      action: "closed",
      sender: { login: "stale[bot]", id: 999, type: "Bot" },
      pull_request: {
        ...pr,
        merged: false,
        closed_at: new Date().toISOString(),
      },
    });
    expect(
      (await env.call("GET", "/v1/attention", { token: teammate.token })).body
    ).toHaveLength(0);
    expect(await activities("?kind=pr.closed")).toHaveLength(0);
  });

  test("a late resolve leaves a newer request open", async () => {
    const { teammate, deliver } = await github();
    await deliver("pull_request", {
      action: "review_requested",
      sender: emma,
      pull_request: { ...pr, updated_at: "2026-10-26T10:00:00Z" },
      requested_reviewer: sam,
    });
    // The removal of an earlier request, arriving after the new one was made.
    await deliver("pull_request", {
      action: "review_request_removed",
      sender: emma,
      pull_request: { ...pr, updated_at: "2026-10-26T09:00:00Z" },
      requested_reviewer: sam,
    });
    const open = (
      await env.call("GET", "/v1/attention", { token: teammate.token })
    ).body;
    expect(open.filter((a: any) => a.kind === "review.requested")).toHaveLength(
      1
    );
  });

  test("lanes: a repo always maps to the same lane, and repos spread across lanes", () => {
    expect(laneOf("")).toBe(0);
    expect(laneOf("501")).toBe(laneOf("501"));
    const lanes = new Set(
      Array.from({ length: 200 }, (_, i) => laneOf(`repo-${i}`))
    );
    expect(lanes.size).toBe(LANES);
  });

  test("deliveries record their partition, so each repo's events stay in order", async () => {
    const { owner, conn, deliver } = await github();
    await deliver("push", { ...push("p1", ["1"]), pusher: { name: "emma" } });
    await deliver("push", {
      ...push("p2", ["2"]),
      repository: { id: 502, full_name: "acme/web", default_branch: "main" },
    });
    const deliveries = (
      await env.call("GET", `/v1/connections/${conn.id}/deliveries`, {
        token: owner.token,
      })
    ).body;
    expect(deliveries.map((d: any) => d.partitionKey).toSorted()).toEqual([
      "501",
      "502",
    ]);
    // Stored as sent, including what no mapping reads yet, so a replay can use it later.
    const stored = await env.ctx.db.execute<{ pusher: string }>(sql`
      select payload->'pusher'->>'name' as pusher from inbound_events
      where connection_id = ${conn.id} and partition_key = '501'`);
    expect(stored.rows[0]?.pusher).toBe("emma");
  });
});

describe("reading webhooks", () => {
  test("a payload with a character Postgres can't store is kept without it", async () => {
    const { deliver, activities } = await github();
    const res = await deliver("push", {
      ...push("nul", ["n1"]),
      commits: [{ id: "n1", message: "Strip \u0000 from exports" }],
    });
    expect(res.status).toBe(200);
    const [pushed] = await activities("?kind=code.pushed");
    expect(pushed.body).toContain("Strip  from exports");
  });

  // Bun (1.3) fails to read a request rebuilt around a new stream, which is how Hono's bodyLimit
  // bounds a body without a length: a run of a hundred or so after nine thousand requests.
  test("bodies without a length are read whole, however many arrive, and the cap holds for them", async () => {
    const statuses = new Map<number, number>();
    let left = 12_000;
    await Promise.all(
      Array.from({ length: 32 }, async () => {
        while (left > 0) {
          left -= 1;
          const { status } = await streamed(
            '{"zen":"Keep it logically awesome."}'
          );
          statuses.set(status, (statuses.get(status) ?? 0) + 1);
        }
      })
    );
    expect(Object.fromEntries(statuses)).toEqual({ 404: 12_000 });
    const { conn } = await github();
    const path = new URL(conn.webhookUrls.webhook).pathname;
    expect(
      (await streamed("x".repeat(25 * 1024 * 1024 + 1), path)).status
    ).toBe(413);
  }, 120_000);
});

describe("visibility into a connection", () => {
  test("rejected deliveries show up in health with the reason", async () => {
    const { owner, conn, deliver } = await github();
    const res = await deliver("push", push("x", ["1"]), { secret: "wrong" });
    expect(res.status).toBe(401);
    await env.drain();
    let health = (
      await env.call("GET", `/v1/connections/${conn.id}/health`, {
        token: owner.token,
      })
    ).body;
    expect(health.rejections).toMatchObject({
      total: 1,
      last: "bad signature",
      failingNow: true,
    });

    await deliver("push", push("y", ["2"]));
    health = (
      await env.call("GET", `/v1/connections/${conn.id}/health`, {
        token: owner.token,
      })
    ).body;
    expect(health.rejections.failingNow).toBe(false);
    expect(health.lastEventAt).not.toBeNull();
    expect(health.backlog.pending).toBe(0);
    expect(health.lagMs.p50).not.toBeNull();
  });

  test("a paused connection acknowledges deliveries and records nothing", async () => {
    const { owner, conn, deliver, activities } = await github();
    await env.call("PATCH", `/v1/connections/${conn.id}`, {
      token: owner.token,
      body: { status: "paused" },
    });
    const res = await deliver("push", push("z", ["1"]));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: "connection is paused" });
    expect(await activities("?kind=code.pushed")).toHaveLength(0);
  });

  test("identity sightings are counted without a write per event", async () => {
    const { owner, deliver } = await github();
    const stranger = { login: "newbie", id: 909 };
    for (let i = 0; i < 3; i += 1) {
      await deliver(
        "push",
        { ...push(`s${i}`, [`${i}`]), sender: stranger },
        { drain: false }
      );
    }
    await env.drain();
    const [identity] = (
      await env.call("GET", "/v1/identities?unlinked=true", {
        token: owner.token,
      })
    ).body;
    expect(identity).toMatchObject({ externalId: "909", eventCount: 3 });
  });
});

describe("replay", () => {
  test("a delivery that fails during a replay doesn't stop the rest from being rebuilt", async () => {
    const owner = await env.workspace();
    const conn = (
      await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: { provider: "custom", settings: { identityNamespace: "jira:x" } },
      })
    ).body;
    const pushOne = async (id: string) =>
      await env.call("POST", `/v1/connections/${conn.id}/events`, {
        token: owner.token,
        body: {
          events: [
            {
              id,
              kind: "ticket.closed",
              occurredAt: new Date().toISOString(),
              actor: null,
              title: `Closed ${id}`,
            },
          ],
        },
        headers: { "idempotency-key": id },
      });
    await pushOne("T-1");
    await env.ctx.db.execute(sql`
      insert into inbound_events (id, workspace_id, connection_id, delivery_id, event_type, payload, status)
      values (${`inb_poison_${conn.id}`}, ${owner.workspace.id}, ${conn.id}, 'poison', 'worklog.events', '{"events": "not a list"}', 'ignored')`);
    await pushOne("T-2");
    await env.drain();
    const replay = await env.call("POST", `/v1/connections/${conn.id}/replay`, {
      token: owner.token,
      body: {},
    });
    expect(replay.status).toBe(202);
    await env.drain();
    const titles = (
      await env.call("GET", "/v1/activities?source=custom", {
        token: owner.token,
      })
    ).body.map((a: any) => a.title);
    expect(
      titles.toSorted((a: string, b: string) => a.localeCompare(b))
    ).toEqual(["Closed T-1", "Closed T-2"]);
    // The one that failed stays done, with why, for the next replay to try again.
    const poison = await env.ctx.db.execute<{ status: string; error: string }>(
      sql`select status, error from inbound_events where id = ${`inb_poison_${conn.id}`}`
    );
    expect(poison.rows[0]?.status).toBe("ignored");
    expect(poison.rows[0]?.error).toContain("replay failed");
  });
});

describe("retention", () => {
  test("a thread resolved again recently keeps its resolution, however old the first one", async () => {
    const owner = await env.workspace();
    const ws = owner.workspace.id as string;
    await env.ctx.db.execute(sql`
      insert into attention_resolutions (workspace_id, member_id, dedupe_key, resolved_through, created_at)
      values (${ws}, '', 'review:old-thread', now() - interval '40 days', now() - interval '40 days'),
             (${ws}, '', 'review:busy-thread', now() - interval '1 day', now() - interval '40 days')`);
    await pruneIngestState(env.ctx);
    const left = await env.ctx.db.execute<{ dedupe_key: string }>(
      sql`select dedupe_key from attention_resolutions where workspace_id = ${ws}`
    );
    expect(left.rows.map((r) => r.dedupe_key)).toEqual(["review:busy-thread"]);
  });
});

describe("replay and live work", () => {
  test("a replay leaves deliveries still waiting to the drain, effects and all", async () => {
    const { owner, teammate, conn, deliver } = await github();
    await deliver("push", push("r1", ["1"]));
    // Waiting in its lane, not yet processed.
    await deliver(
      "pull_request",
      {
        action: "review_requested",
        sender: emma,
        pull_request: pr,
        requested_reviewer: sam,
      },
      { drain: false }
    );
    await env.ctx.db.execute(
      sql`delete from graphile_worker._private_jobs where key like ${`lane:${conn.id}:%`}`
    );
    await env.call("POST", `/v1/connections/${conn.id}/replay`, {
      token: owner.token,
      body: {},
    });
    await env.drain();
    const waiting = await env.ctx.db.execute<{ status: string }>(
      sql`select status from inbound_events where connection_id = ${conn.id} and event_type = 'pull_request'`
    );
    expect(waiting.rows[0]?.status).toBe("pending");
    // The drain gets to it later, with its effects.
    const lane = await env.ctx.db.execute<{ lane: number }>(
      sql`select lane from inbound_events where connection_id = ${conn.id} limit 1`
    );
    await drainLane(env.ctx, conn.id, lane.rows[0]?.lane ?? 0);
    const [item] = (
      await env.call("GET", "/v1/attention", { token: teammate.token })
    ).body;
    expect(item).toMatchObject({ kind: "review.requested" });
  });

  test("a paused Slack connection records nothing but still delivers briefs", async () => {
    const owner = await env.workspace();
    const conn = (
      await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: {
          provider: "slack",
          secrets: { signingSecret: "ss", botToken: "xoxb-1" },
        },
      })
    ).body;
    await env.call("PATCH", `/v1/connections/${conn.id}`, {
      token: owner.token,
      body: { status: "paused" },
    });
    const target = (
      await env.call("POST", "/v1/delivery-targets", {
        token: owner.token,
        body: { kind: "slack", address: "C0BRIEFS", connectionId: conn.id },
      })
    ).body;
    const sent = await sendTo(env.ctx, owner.member.id, [target.id], {
      subject: "Brief",
      markdown: "All quiet",
      type: "brief",
    });
    expect(sent).toMatchObject({ delivered: [target.id], failed: [] });
  });
});

describe("silence", () => {
  test("a connection that usually hears from its tool and goes quiet tells its owner, once", async () => {
    const { owner, deliver } = await github();
    const before = new Date(Date.now() - 6 * DAY_MS);
    env.ctx.now = () => before;
    for (let i = 0; i < 20; i += 1) {
      await deliver("push", push(`q${i}`, [`${i}`]), { drain: false });
    }
    await env.drain();
    env.ctx.now = () => new Date();
    await noticeSilence(env.ctx);
    await noticeSilence(env.ctx);
    const items = (
      await env.call("GET", "/v1/attention", { token: owner.token })
    ).body.filter((a: any) => a.kind === "connection.silent");
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain("has received nothing since");
  });
});

describe("Slack deletions", () => {
  test("a deleted reply takes the burst's text with it", async () => {
    const owner = await env.workspace();
    const conn = (
      await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: {
          provider: "slack",
          secrets: { signingSecret: "ss", botToken: "xoxb" },
          settings: { channels: ["C1"] },
        },
      })
    ).body;
    const post = async (id: string, event: object) => {
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
    const base = Math.floor(Date.now() / 1000);
    const reply = (ts: number, text: string) => ({
      type: "message",
      user: "U1",
      text,
      channel: "C1",
      channel_type: "channel",
      ts: `${ts}.000100`,
      thread_ts: `${base - 100}.000100`,
    });
    await post("E1", reply(base, "The pool size is the culprit here"));
    await post("E2", reply(base + 1, "My card number is 4242 4242 4242 4242"));
    await post("E3", {
      type: "message",
      subtype: "message_deleted",
      channel: "C1",
      deleted_ts: `${base + 1}.000100`,
      ts: `${base + 2}.0`,
    });
    const [burst] = (
      await env.call("GET", "/v1/activities?source=slack", {
        token: owner.token,
      })
    ).body;
    expect(burst.count).toBe(2);
    expect(burst.body).toBeNull();

    // The burst's first message going too leaves the burst: it stands for the others.
    await post("E4", {
      type: "message",
      subtype: "message_deleted",
      channel: "C1",
      deleted_ts: `${base}.000100`,
      ts: `${base + 3}.0`,
    });
    const after = (
      await env.call("GET", "/v1/activities?source=slack", {
        token: owner.token,
      })
    ).body;
    expect(after).toHaveLength(1);
  });
});
