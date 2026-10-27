import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { testEnv } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});
beforeEach(() => {
  env.reset();
});

async function team() {
  const owner = await env.workspace();
  const sam = await env.teammate(owner.token, "Sam");
  const board = (
    await env.call("POST", "/v1/boards", {
      token: owner.token,
      body: { name: "B" },
    })
  ).body;
  const autos = (await env.call("GET", "/v1/automations", { token: sam.token }))
    .body;
  const check = autos.find((a: any) => a.kind === "check");
  const digest = autos.find((a: any) => a.kind === "digest");
  const runCheck = async () =>
    (
      await env.call("POST", `/v1/automations/${check.id}/run`, {
        token: sam.token,
      })
    ).body;
  let n = 0;
  const mentionSam = async (by = owner.token) => {
    n += 1;
    const { body: card } = await env.call("POST", "/v1/cards", {
      token: by,
      body: { boardId: board.id, title: `Card ${n}` },
    });
    await env.call("POST", `/v1/cards/${card.number}/comments`, {
      token: by,
      body: { body: `@${sam.member.handle} please look` },
    });
    return card;
  };
  return { owner, sam, board, check, digest, runCheck, mentionSam };
}

describe("interruption budget", () => {
  test("urgent items pull the attention check forward (debounced)", async () => {
    const { sam, check, mentionSam } = await team();
    await mentionSam();
    const after = (
      await env.call("GET", "/v1/automations", { token: sam.token })
    ).body.find((a: any) => a.id === check.id);
    expect(new Date(after.nextRunAt).getTime()).toBeLessThanOrEqual(
      Date.now() + 3 * 60_000 + 1000
    );
  });

  test("after a ping, new urgent items wait out the minimum gap instead of interrupting again", async () => {
    const { sam, runCheck, mentionSam, owner } = await team();
    const ana = await env.teammate(owner.token, "Ana");
    await mentionSam();
    expect((await runCheck()).status).toBe("delivered");
    await mentionSam(ana.token);
    const held = await runCheck();
    expect(held).toMatchObject({ status: "quiet" });
    expect(held.summary).toContain("Holding");
    // Still unconsidered — it'll be decided after the gap.
    const items = (await env.call("GET", "/v1/attention", { token: sam.token }))
      .body;
    expect(items.filter((i: any) => i.disposition === null).length).toBe(1);
  });

  test("past the daily cap, urgent items go to the digest, with a reason", async () => {
    const { sam, runCheck, mentionSam } = await team();
    await env.call("PATCH", "/v1/me", {
      token: sam.token,
      body: {
        settings: {
          activeHours: { start: "00:00", end: "23:59" },
          notify: { dailyPushCap: 1, minGapMinutes: 0 },
        },
      },
    });
    await mentionSam();
    expect((await runCheck()).status).toBe("delivered");
    await mentionSam();
    expect((await runCheck()).status).toBe("quiet");
    const latest = (
      await env.call("GET", "/v1/attention", { token: sam.token })
    ).body.find((i: any) => i.disposition === "digest");
    expect(latest.reason).toContain("budget");
  });

  test("one sender can't flood someone with high-priority items", async () => {
    const { sam, mentionSam } = await team();
    for (let i = 0; i < 3; i += 1) {
      await mentionSam();
    }
    const items = (
      await env.call("GET", "/v1/attention", { token: sam.token })
    ).body.filter((i: any) => i.kind === "mention");
    expect(items.map((i: any) => i.priority).toSorted()).toEqual([
      "high",
      "high",
      "normal",
    ]);
  });
});

describe("feedback and digests", () => {
  test("'less like this' holds that kind for the digest; the digest then delivers it once", async () => {
    const { sam, runCheck, mentionSam, digest } = await team();
    await mentionSam();
    await runCheck();
    const [first] = (
      await env.call("GET", "/v1/attention", { token: sam.token })
    ).body;
    const fb = await env.call("POST", `/v1/attention/${first.id}/feedback`, {
      token: sam.token,
      body: { signal: "less_like_this" },
    });
    expect(fb.body).toEqual({ kind: "mention", muted: true });

    await env.call("PATCH", "/v1/me", {
      token: sam.token,
      body: {
        settings: {
          activeHours: { start: "00:00", end: "23:59" },
          notify: { minGapMinutes: 0 },
        },
      },
    });
    await mentionSam();
    expect((await runCheck()).status).toBe("quiet");

    const run = (
      await env.call("POST", `/v1/automations/${digest.id}/run`, {
        token: sam.token,
      })
    ).body;
    expect(run.status).toBe("delivered");
    expect(
      (
        await env.call("POST", `/v1/automations/${digest.id}/run`, {
          token: sam.token,
        })
      ).body.status
    ).toBe("skipped");

    const metrics = (
      await env.call("GET", "/v1/attention/metrics", { token: sam.token })
    ).body;
    expect(metrics).toMatchObject({
      pushes: 1,
      mutedKinds: ["mention"],
      feedback: { less_like_this: 1 },
    });
  });
});
