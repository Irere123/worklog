import { beforeAll, describe, expect, test } from "bun:test";
import { setTimeout as sleep } from "node:timers/promises";

import { sql } from "drizzle-orm";

import { startWorker } from "#jobs/tasks";
import { hmacHex } from "#lib/crypto";

import { testEnv } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});

const REPOS = 16;
const PUSHES = 5;
const PEOPLE = 4;

const dev = (i: number) => ({ login: `dev-${i}`, id: 1000 + i });
const at = (minute: number) =>
  new Date(Date.now() - (60 - minute) * 60_000).toISOString();

// This connection's jobs not yet finished: waiting, running, or retrying after a failure. Other
// tests leave jobs due later (a retry, a rate-limited sync), so it can't wait for all of them.
async function unfinished(connectionId: string) {
  const result = await env.ctx.db.execute<{ n: number }>(sql`
    select count(*)::int as n
    from graphile_worker._private_jobs as j
    join graphile_worker._private_job_queues as q on q.id = j.job_queue_id
    where q.queue_name like ${`ingest:${connectionId}:%`} and j.attempts < j.max_attempts`);
  return result.rows[0]?.n ?? 0;
}

describe("under load", () => {
  test("parallel lanes keep every repo's bursts, requests and resolutions exact", async () => {
    const owner = await env.workspace();
    const people = await Promise.all(
      Array.from({ length: PEOPLE }, async (_, i) => {
        const p = await env.teammate(owner.token, `Dev ${i}`);
        await env.call("POST", `/v1/members/${p.member.id}/identities`, {
          token: p.token,
          body: { provider: "github", externalId: String(1000 + i) },
        });
        return p;
      })
    );
    const conn = (
      await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: { provider: "github", secrets: { webhookSecret: "s" } },
      })
    ).body;
    const path = new URL(conn.webhookUrls.webhook).pathname;
    let n = 0;
    const deliver = async (event: string, payload: object) => {
      n += 1;
      const raw = JSON.stringify(payload);
      const res = await env.app.request(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": event,
          "x-github-delivery": `load-${n}`,
          "x-hub-signature-256": `sha256=${hmacHex("s", raw)}`,
        },
        body: raw,
      });
      expect(res.status).toBe(200);
    };

    // Every repo: a review request, a burst of pushes, the review that resolves the request,
    // and a duplicate of one push under a new delivery id. Repos interleave, as a busy org does.
    for (let step = 0; step < PUSHES + 2; step += 1) {
      for (let r = 0; r < REPOS; r += 1) {
        const repository = {
          id: 7000 + r,
          full_name: `acme/repo-${r}`,
          default_branch: "main",
        };
        const author = dev(r % PEOPLE);
        const reviewer = dev((r + 1) % PEOPLE);
        const pr = {
          number: 1,
          title: `Change ${r}`,
          html_url: `https://github.com/acme/repo-${r}/pull/1`,
          user: author,
        };
        if (step === 0) {
          await deliver("pull_request", {
            action: "review_requested",
            repository,
            sender: author,
            requested_reviewer: reviewer,
            pull_request: { ...pr, updated_at: at(1) },
          });
        } else if (step <= PUSHES) {
          await deliver("push", {
            ref: "refs/heads/feature",
            after: `r${r}-s${step}`,
            repository,
            sender: author,
            commits: [{ id: `${r}-${step}`, message: `step ${step}` }],
            head_commit: { timestamp: at(10 + step) },
          });
        } else {
          await deliver("pull_request_review", {
            action: "submitted",
            repository,
            sender: reviewer,
            pull_request: pr,
            review: {
              id: 50_000 + r,
              state: "approved",
              body: "Ship it",
              html_url: "r",
              user: reviewer,
              submitted_at: at(30),
            },
          });
          await deliver("push", {
            ref: "refs/heads/feature",
            after: `r${r}-s1`,
            repository,
            sender: author,
            commits: [{ id: `${r}-1`, message: "step 1" }],
            head_commit: { timestamp: at(11) },
          });
        }
      }
    }

    const started = performance.now();
    const stop = await startWorker(env.ctx, { cron: false, concurrency: 8 });
    try {
      for (let i = 0; i < 600 && (await unfinished(conn.id)) > 0; i += 1) {
        await sleep(100);
      }
    } finally {
      await stop();
    }
    const seconds = (performance.now() - started) / 1000;
    await env.ctx.tally.flush();
    expect(await unfinished(conn.id)).toBe(0);
    console.log(
      `[scale] ${n} deliveries in ${seconds.toFixed(1)} s (${(n / seconds).toFixed(0)}/s, 8 workers)`
    );

    const deliveries = (
      await env.call("GET", `/v1/connections/${conn.id}/deliveries?limit=200`, {
        token: owner.token,
      })
    ).body;
    expect(deliveries.filter((d: any) => d.status === "failed")).toHaveLength(
      0
    );

    const pushes = (
      await env.call("GET", "/v1/activities?kind=code.pushed&limit=500", {
        token: owner.token,
      })
    ).body;
    expect(pushes).toHaveLength(REPOS);
    for (const burst of pushes) {
      expect(burst.count).toBe(PUSHES);
      expect(burst.title).toStartWith(`Pushed ${PUSHES} commits`);
    }
    for (const p of people) {
      const open = (await env.call("GET", "/v1/attention", { token: p.token }))
        .body;
      expect(
        open.filter((a: any) => a.kind === "review.requested")
      ).toHaveLength(0);
    }
    const identities = (
      await env.call("GET", "/v1/identities", { token: owner.token })
    ).body.filter((i: any) => i.provider === "github");
    const sightings = identities.reduce(
      (sum: number, i: any) => sum + i.eventCount,
      0
    );
    expect(sightings).toBeGreaterThanOrEqual(REPOS * (PUSHES + 1));
  }, 120_000);
});
