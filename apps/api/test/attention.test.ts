import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { runAutomation } from "#automations/run";
import { findAutomationById } from "#db/queries/automations";

import { scriptedModel, testEnv } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});
beforeEach(() => {
  env.reset();
});

function kigaliMinute(date: Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Africa/Kigali",
    dateStyle: "short",
    timeStyle: "short",
  })
    .format(date)
    .replace(" ", "T");
}

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

describe("learning from what people do", () => {
  test("pings dismissed again and again without acting are held for the digest; acting on one undoes it", async () => {
    const { owner, sam, runCheck, mentionSam } = await team();
    await env.call("PATCH", "/v1/me", {
      token: sam.token,
      body: {
        settings: {
          activeHours: { start: "00:00", end: "23:59" },
          notify: { dailyPushCap: 20, minGapMinutes: 0 },
        },
      },
    });
    let n = 0;
    const mentionFromSomeone = async () => {
      n += 1;
      const sender = await env.teammate(owner.token, `Sender ${n}`);
      await mentionSam(sender.token);
    };
    const resolveNewest = async (state: string) => {
      const [item] = (
        await env.call("GET", "/v1/attention", { token: sam.token })
      ).body;
      await env.call("PATCH", `/v1/attention/${item.id}`, {
        token: sam.token,
        body: { state },
      });
    };
    for (let i = 0; i < 3; i += 1) {
      await mentionFromSomeone();
      expect((await runCheck()).status).toBe("delivered");
      await resolveNewest("dismissed");
    }

    await mentionFromSomeone();
    expect((await runCheck()).status).toBe("quiet");
    const [held] = (
      await env.call("GET", "/v1/attention", { token: sam.token })
    ).body;
    expect(held).toMatchObject({ disposition: "digest" });
    expect(held.reason).toContain("dismissed");

    await resolveNewest("done");
    await mentionFromSomeone();
    expect((await runCheck()).status).toBe("delivered");
  });
});

describe("follow-ups", () => {
  test("a follow-up the owner asked for stays out of sight, then comes back when they asked, even past the day's budget", async () => {
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
    const now = Date.now();
    env.ctx.now = () => new Date(now);
    const when = new Date(now + 10 * 60_000);
    const wakes = Math.floor(when.getTime() / 60_000) * 60_000;
    const { model } = scriptedModel([
      {
        tool: "follow_up",
        input: {
          what: "Check whether the retry fix shipped",
          at: kigaliMinute(when),
        },
      },
      { text: "I'll bring it back at that time." },
    ]);
    env.ctx.models = { main: model, fast: model };
    await env.call("POST", "/v1/conversations", {
      token: sam.token,
      body: { message: "Remind me in ten minutes to check the retry fix" },
    });
    env.ctx.models = null;

    const autos = (
      await env.call("GET", "/v1/automations", { token: sam.token })
    ).body;
    const check = autos.find((a: any) => a.kind === "check");
    expect(new Date(check.nextRunAt).getTime()).toBeLessThanOrEqual(wakes);
    const open = (await env.call("GET", "/v1/attention", { token: sam.token }))
      .body;
    expect(open.some((i: any) => i.kind === "follow_up")).toBe(false);
    const glance = scriptedModel([{ text: "Morning." }]);
    env.ctx.models = { main: glance.model, fast: glance.model };
    await env.call("POST", "/v1/conversations", {
      token: sam.token,
      body: { message: "Morning" },
    });
    env.ctx.models = null;
    expect(JSON.stringify(glance.prompts[0].prompt.at(-1))).toContain(
      "follow-ups you'll bring back: Check whether the retry fix shipped"
    );

    await mentionSam();
    expect((await runCheck()).status).toBe("delivered");
    await runAutomation(
      env.ctx,
      (await findAutomationById(env.ctx.db, { id: check.id }))!
    );
    const next = (
      await env.call("GET", "/v1/automations", { token: sam.token })
    ).body.find((a: any) => a.id === check.id);
    expect(new Date(next.nextRunAt).getTime()).toBe(wakes);

    env.ctx.now = () => new Date(when.getTime() + 60_000);
    const back = await runCheck();
    expect(back).toMatchObject({ status: "delivered" });
    const inbox = (
      await env.call("GET", "/v1/conversations", { token: sam.token })
    ).body.find((c: any) => c.inbox);
    const thread = (
      await env.call("GET", `/v1/conversations/${inbox.id}`, {
        token: sam.token,
      })
    ).body;
    const last = thread.messages.at(-1).text;
    expect(last).toContain("Follow up: Check whether the retry fix shipped");
    expect(last).toContain("You asked me to bring this back now");
  });

  test("a follow-up still comes when the gap after the last ping holds everything else back, and a snoozed one comes back again", async () => {
    const { owner, sam, runCheck, mentionSam } = await team();
    await env.call("PATCH", "/v1/me", {
      token: sam.token,
      body: {
        settings: {
          activeHours: { start: "00:00", end: "23:59" },
          notify: { minGapMinutes: 90 },
        },
      },
    });
    const now = Date.now();
    env.ctx.now = () => new Date(now);
    const { model } = scriptedModel([
      {
        tool: "follow_up",
        input: {
          what: "Send the retry design doc",
          at: kigaliMinute(new Date(now + 10 * 60_000)),
        },
      },
      { text: "Will do." },
    ]);
    env.ctx.models = { main: model, fast: model };
    await env.call("POST", "/v1/conversations", {
      token: sam.token,
      body: { message: "Remind me in ten minutes to send the doc" },
    });
    env.ctx.models = null;
    await mentionSam();
    expect((await runCheck()).status).toBe("delivered");

    env.ctx.now = () => new Date(now + 11 * 60_000);
    const ana = await env.teammate(owner.token, "Ana");
    await mentionSam(ana.token);
    const run = await runCheck();
    expect(run).toMatchObject({ status: "delivered" });
    expect(run.summary).toContain("Pushed 1");
    const items = (await env.call("GET", "/v1/attention", { token: sam.token }))
      .body;
    const followUp = items.find((i: any) => i.kind === "follow_up");
    expect(followUp.disposition).toBe("push");
    expect(
      items.filter((i: any) => i.kind !== "follow_up" && i.disposition === null)
    ).toHaveLength(1);

    await env.call("PATCH", `/v1/attention/${followUp.id}`, {
      token: sam.token,
      body: {
        state: "snoozed",
        snoozedUntil: new Date(now + 3 * 3_600_000).toISOString(),
      },
    });
    env.ctx.now = () => new Date(now + 3 * 3_600_000 + 60_000);
    const again = await runCheck();
    expect(again).toMatchObject({ status: "delivered" });
    const inbox = (
      await env.call("GET", "/v1/conversations", { token: sam.token })
    ).body.find((c: any) => c.inbox);
    const thread = (
      await env.call("GET", `/v1/conversations/${inbox.id}`, {
        token: sam.token,
      })
    ).body;
    expect(thread.messages.at(-1).text).toContain(
      "Follow up: Send the retry design doc"
    );
  });
});
