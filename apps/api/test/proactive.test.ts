import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { nextRun } from "#automations/schedule";
import { briefWindow } from "#briefs/service";
import type { ConsoleMailer } from "#delivery/mailer";
import { enqueue } from "#jobs/queue";
import { startWorker } from "#jobs/worker";
import { localParts } from "#lib/time";

import { testEnv } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});
beforeEach(() => {
  env.reset();
});

describe("schedules follow each person's local clock", () => {
  // UTC+2, no DST
  const kigali = "Africa/Kigali";
  const ny = "America/New_York";

  test("daily on weekdays skips the weekend", () => {
    // Fri 09:00 Kigali
    const friday9 = new Date("2026-10-30T07:00:00Z");
    const next = nextRun(
      { type: "daily", at: "08:30", weekdays: [1, 2, 3, 4, 5] },
      kigali,
      friday9
    );
    // Mon 08:30 Kigali
    expect(next.toISOString()).toBe("2026-11-02T06:30:00.000Z");
  });

  test("weekly runs on the right weekday", () => {
    const next = nextRun(
      { type: "weekly", weekday: 5, at: "16:00" },
      kigali,
      new Date("2026-10-26T10:00:00Z")
    );
    expect(next.toISOString()).toBe("2026-10-30T14:00:00.000Z");
  });

  test("handles daylight-saving transitions", () => {
    // US clocks fall back on 2026-11-01; 08:30 local is 12:30Z before and 13:30Z after.
    const before = nextRun(
      { type: "daily", at: "08:30" },
      ny,
      new Date("2026-10-31T00:00:00Z")
    );
    const after = nextRun(
      { type: "daily", at: "08:30" },
      ny,
      new Date("2026-11-01T14:00:00Z")
    );
    expect(before.toISOString()).toBe("2026-10-31T12:30:00.000Z");
    expect(after.toISOString()).toBe("2026-11-02T13:30:00.000Z");
  });

  test("interval checks wait for active hours", () => {
    // Tue 20:50 Kigali
    const evening = new Date("2026-10-27T18:50:00Z");
    const next = nextRun(
      { type: "interval", minutes: 30, activeHoursOnly: true },
      kigali,
      evening,
      {
        activeHours: { start: "08:00", end: "19:00" },
        workdays: [1, 2, 3, 4, 5],
      }
    );
    // Wed 08:00 Kigali
    expect(next.toISOString()).toBe("2026-10-28T06:00:00.000Z");
  });

  test("a Monday stand-up brief covers Friday and the weekend", () => {
    const monday = new Date("2026-11-02T06:30:00Z");
    const { start } = briefWindow(monday, kigali, "daily");
    expect(localParts(start, kigali)).toMatchObject({ weekday: 5, hour: 0 });
  });
});

describe("automations", () => {
  test("every human starts with a morning brief, two digests, a weekly wrap, an attention check and nightly memory", async () => {
    const { token } = await env.workspace();
    const autos = (await env.call("GET", "/v1/automations", { token })).body;
    expect(autos.map((a: any) => a.kind).toSorted()).toEqual([
      "brief.daily",
      "brief.weekly",
      "check",
      "consolidate",
      "digest",
      "digest",
    ]);
    const morning = autos.find((a: any) => a.kind === "brief.daily");
    expect(morning.targetIds).toHaveLength(1);
  });

  test("the morning brief lands in the inbox and the chosen channels", async () => {
    const { token } = await env.workspace();
    const board = (
      await env.call("POST", "/v1/boards", { token, body: { name: "B" } })
    ).body;
    await env.call("POST", "/v1/cards", {
      token,
      body: { boardId: board.id, title: "Draft the Q4 plan", assigneeIds: [] },
    });
    await env.call("POST", "/v1/logs", {
      token,
      body: { text: "Call with finance about budget" },
    });
    const hook = (
      await env.call("POST", "/v1/delivery-targets", {
        token,
        body: { kind: "webhook", address: "https://ntfy.test/emma" },
      })
    ).body;
    const autos = (await env.call("GET", "/v1/automations", { token })).body;
    const morning = autos.find((a: any) => a.kind === "brief.daily");
    await env.call("PATCH", `/v1/automations/${morning.id}`, {
      token,
      body: { targetIds: [...morning.targetIds, hook.id] },
    });

    const run = (
      await env.call("POST", `/v1/automations/${morning.id}/run`, { token })
    ).body;
    expect(run.status).toBe("delivered");

    const mail = (env.ctx.mailer as ConsoleMailer).sent.at(-1)!;
    expect(mail.subject).toContain("Morning brief");
    expect(mail.text).toContain("Call with finance about budget");
    expect((env.ctx.fetch as any).calls.at(-1).url).toBe(
      "https://ntfy.test/emma"
    );

    const inbox = (
      await env.call("GET", "/v1/conversations", { token })
    ).body.find((c: any) => c.inbox);
    const thread = (
      await env.call("GET", `/v1/conversations/${inbox.id}`, { token })
    ).body;
    expect(thread.messages.at(-1).text).toContain("Call with finance");
  });

  test("the attention check stays quiet for low-key items and pings for things blocked on you", async () => {
    const owner = await env.workspace();
    const sam = await env.teammate(owner.token, "Sam");
    const board = (
      await env.call("POST", "/v1/boards", {
        token: owner.token,
        body: { name: "B" },
      })
    ).body;
    const { body: card } = await env.call("POST", "/v1/cards", {
      token: sam.token,
      body: { boardId: board.id, title: "Watched by Sam" },
    });
    const check = (
      await env.call("GET", "/v1/automations", { token: sam.token })
    ).body.find((a: any) => a.kind === "check");
    const run = async () =>
      (
        await env.call("POST", `/v1/automations/${check.id}/run`, {
          token: sam.token,
        })
      ).body;

    expect((await run()).status).toBe("skipped");

    await env.call("POST", `/v1/cards/${card.number}/comments`, {
      token: owner.token,
      body: { body: "fyi" },
    });
    // A watcher heads-up can wait for the brief
    expect((await run()).status).toBe("quiet");

    await env.call("POST", `/v1/cards/${card.number}/comments`, {
      token: owner.token,
      body: { body: `@${sam.member.handle} need your call on this` },
    });
    const pinged = await run();
    expect(pinged.status).toBe("delivered");

    expect((await run()).status).toBe("skipped");
  });

  test("the scheduler runs whatever is due", async () => {
    const { token } = await env.workspace();
    const autos = (await env.call("GET", "/v1/automations", { token })).body;
    const morning = autos.find((a: any) => a.kind === "brief.daily");
    env.ctx.now = () => new Date(new Date(morning.nextRunAt).getTime() + 1000);
    await enqueue(env.ctx, "automations:run", {});
    await env.drain();
    const after = (
      await env.call("GET", "/v1/automations", { token })
    ).body.find((a: any) => a.id === morning.id);
    expect(after.lastStatus).toBe("delivered");
    expect(new Date(after.nextRunAt).getTime()).toBeGreaterThan(
      new Date(morning.nextRunAt).getTime()
    );
  });

  test("the worker starts with its cron schedule", async () => {
    const stop = await startWorker(env.ctx);
    await stop();
  });

  test("nightly consolidation writes yesterday's journal", async () => {
    const { token } = await env.workspace();
    await env.call("POST", "/v1/logs", {
      token,
      body: { text: "Decided to move retries to a queue", kind: "decision" },
    });
    const consolidate = (
      await env.call("GET", "/v1/automations", { token })
    ).body.find((a: any) => a.kind === "consolidate");
    env.ctx.now = () => new Date(Date.now() + 24 * 3600 * 1000);
    const run = (
      await env.call("POST", `/v1/automations/${consolidate.id}/run`, { token })
    ).body;
    expect(run.status).toBe("quiet");
    const journal = (
      await env.call("GET", "/v1/memories?kind=journal", { token })
    ).body;
    expect(journal[0].content).toContain("Decided to move retries to a queue");
  });
});
