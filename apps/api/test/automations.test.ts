import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { sql } from "drizzle-orm";

import { CONSTITUTION } from "#agent/prompts";
import { briefWindow } from "#automations/briefs";
import { queueDueAutomations, runAutomation } from "#automations/run";
import { nextRun } from "#automations/schedule";
import { findAutomationById } from "#db/queries/automations";
import { enqueue } from "#jobs/queue";
import { startWorker } from "#jobs/tasks";
import type { ConsoleMailer } from "#lib/mailer";
import { localParts } from "#lib/time";

import { scriptedModel, testEnv } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;

const listOf = (values: string[]) =>
  sql`(${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `
  )})`;

async function onlyDue(workspaceId: string) {
  await env.ctx.db.execute(sql`
    update automations set next_run_at = next_run_at + interval '10 years'
    where workspace_id <> ${workspaceId}`);
}
beforeAll(async () => {
  env = await testEnv();
});
beforeEach(() => {
  env.reset();
});

function notify(message: string) {
  return { tool: "send_message", input: { message, summary: "sent" } };
}

describe("schedules follow each person's local clock", () => {
  const kigali = "Africa/Kigali";
  const ny = "America/New_York";

  test("daily on weekdays skips the weekend", () => {
    const friday9 = new Date("2026-10-30T07:00:00Z");
    const next = nextRun(
      { type: "daily", at: "08:30", weekdays: [1, 2, 3, 4, 5] },
      kigali,
      friday9
    );
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
    expect(mail.html).toContain("Call with finance about budget");
    expect(mail.headers?.["List-Unsubscribe"]).toBe(
      "<https://worklog.test/settings/automations>"
    );
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

  test("a scheduled brief with nothing in it stays quiet; run by hand it still comes", async () => {
    const { token } = await env.workspace();
    const autos = (await env.call("GET", "/v1/automations", { token })).body;
    const morning = autos.find((a: any) => a.kind === "brief.daily");
    const loaded = await findAutomationById(env.ctx.db, { id: morning.id });
    const sent = (env.ctx.mailer as ConsoleMailer).sent.length;

    const scheduled = await runAutomation(env.ctx, loaded!);
    expect(scheduled).toMatchObject({ status: "quiet" });
    expect((env.ctx.mailer as ConsoleMailer).sent).toHaveLength(sent);

    const byHand = (
      await env.call("POST", `/v1/automations/${morning.id}/run`, { token })
    ).body;
    expect(byHand.status).toBe("delivered");

    await env.call("POST", "/v1/logs", {
      token,
      body: { text: "Call with finance about budget" },
    });
    const withNews = await runAutomation(env.ctx, loaded!);
    expect(withNews).toMatchObject({ status: "delivered" });
  });

  test("a card touched several times is one line in the brief, with each change", async () => {
    const { token, member } = await env.workspace();
    const board = (
      await env.call("POST", "/v1/boards", {
        token,
        body: { name: "Ops", columns: ["Doing"] },
      })
    ).body;
    const card = (
      await env.call("POST", "/v1/cards", {
        token,
        body: { boardId: board.id, title: "Rotate the keys" },
      })
    ).body;
    await env.call("POST", `/v1/cards/${card.number}/triage`, {
      token,
      body: { columnId: board.columns[0].id },
    });
    await env.call("POST", `/v1/cards/${card.number}/assignments`, {
      token,
      body: { memberId: member.id },
    });
    await env.call("POST", `/v1/cards/${card.number}/closure`, { token });

    const brief = (
      await env.call("POST", "/v1/briefs", { token, body: { period: "daily" } })
    ).body;
    const lines = brief.body
      .split("\n")
      .filter((l: string) => l.includes(`#${card.number} Rotate the keys`));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(" · ");
  });

  test("briefs and custom automations start from the assistant's constitution", async () => {
    const { token } = await env.workspace();
    const { model, prompts } = scriptedModel([
      { text: "## You\n- A quiet day." },
      notify("Nothing to rank; here is what moved."),
    ]);
    env.ctx.models = { main: model, fast: model };
    const autos = (await env.call("GET", "/v1/automations", { token })).body;
    const morning = autos.find((a: any) => a.kind === "brief.daily");
    await env.call("POST", `/v1/automations/${morning.id}/run`, { token });
    const custom = (
      await env.call("POST", "/v1/automations", {
        token,
        body: {
          name: "Friday ranking",
          schedule: { type: "weekly", weekday: 5, at: "15:00" },
          instructions: "Rank my teammates by commits this week",
        },
      })
    ).body;
    await env.call("POST", `/v1/automations/${custom.id}/run`, { token });

    const systems = prompts.map((p) => p.prompt[0].content as string);
    expect(systems).toHaveLength(2);
    expect(systems.every((s) => s.startsWith(CONSTITUTION))).toBe(true);
    expect(systems[0]).toContain("# This brief");
    expect(systems[1]).toContain("# This routine");
  });

  test("private work only reaches private targets; a team channel gets the brief the team could see", async () => {
    const { token } = await env.workspace();
    for (const [text, visibility] of [
      ["Shipped the retry queue", "team"],
      ["Interview loop at Acme", "private"],
    ] as const) {
      await env.call("POST", "/v1/logs", { token, body: { text, visibility } });
    }
    const target = async (body: object) =>
      (await env.call("POST", "/v1/delivery-targets", { token, body })).body;
    const channel = await target({
      kind: "webhook",
      address: "https://hooks.test/eng",
    });
    const phone = await target({
      kind: "webhook",
      address: "https://ntfy.test/emma",
    });
    const lead = await target({ kind: "email", address: "lead@example.com" });
    expect([channel, phone, lead].map((t) => t.visibility)).toEqual([
      "team",
      "team",
      "team",
    ]);
    const marked = await env.call("PATCH", `/v1/delivery-targets/${phone.id}`, {
      token,
      body: { visibility: "private" },
    });
    expect(marked.body.visibility).toBe("private");
    const own = (
      await env.call("GET", "/v1/delivery-targets", { token })
    ).body.find((t: any) => t.kind === "email" && t.id !== lead.id);
    expect(own.visibility).toBe("private");

    const autos = (await env.call("GET", "/v1/automations", { token })).body;
    const morning = autos.find((a: any) => a.kind === "brief.daily");
    await env.call("PATCH", `/v1/automations/${morning.id}`, {
      token,
      body: { targetIds: [own.id, channel.id, phone.id, lead.id] },
    });
    await env.call("POST", `/v1/automations/${morning.id}/run`, { token });

    const posted = (url: string): string =>
      (env.ctx.fetch as any).calls.find((c: any) => c.url === url).body
        .markdown;
    const mailed = (to: string): string =>
      (env.ctx.mailer as ConsoleMailer).sent.find((m) => m.to === to)!.text;
    for (const full of [
      posted("https://ntfy.test/emma"),
      mailed(own.address),
    ]) {
      expect(full).toContain("Interview loop at Acme");
    }
    for (const shared of [
      posted("https://hooks.test/eng"),
      mailed(lead.address),
    ]) {
      expect(shared).toContain("Shipped the retry queue");
      expect(shared).not.toContain("Interview loop");
    }
  });

  test("a team copy only mentions attention that team-visible activity raised", async () => {
    const owner = await env.workspace();
    const sam = await env.teammate(owner.token, "Sam");
    const board = (
      await env.call("POST", "/v1/boards", {
        token: owner.token,
        body: { name: "B" },
      })
    ).body;
    const card = (
      await env.call("POST", "/v1/cards", {
        token: owner.token,
        body: { boardId: board.id, title: "Retry queue" },
      })
    ).body;
    await env.call("POST", `/v1/cards/${card.number}/comments`, {
      token: sam.token,
      body: { body: `@${owner.member.handle} can you review the backoff?` },
    });
    const { model } = scriptedModel([
      {
        tool: "leave_note_for_owner",
        input: { note: "Sam needs the salary bands", urgent: false },
      },
      { text: "Left a note." },
    ]);
    env.ctx.models = { main: model, fast: model };
    await env.call("POST", "/v1/conversations", {
      token: sam.token,
      body: { to: owner.member.handle, message: "Can I see the bands?" },
    });
    env.ctx.models = null;

    const channel = (
      await env.call("POST", "/v1/delivery-targets", {
        token: owner.token,
        body: { kind: "webhook", address: "https://hooks.test/eng" },
      })
    ).body;
    const autos = (
      await env.call("GET", "/v1/automations", { token: owner.token })
    ).body;
    const digest = autos.find((a: any) => a.kind === "digest");
    await env.call("PATCH", `/v1/automations/${digest.id}`, {
      token: owner.token,
      body: { targetIds: [...digest.targetIds, channel.id] },
    });
    const run = await env.call("POST", `/v1/automations/${digest.id}/run`, {
      token: owner.token,
    });
    expect(run.body.status).toBe("delivered");

    const shared: string = (env.ctx.fetch as any).calls.at(-1).body.markdown;
    expect(shared).toContain("1 thing since");
    expect(shared).toContain("Sam mentioned you on #1 Retry queue");
    expect(shared).not.toContain("salary bands");
    const inbox = (
      await env.call("GET", "/v1/conversations", { token: owner.token })
    ).body.find((c: any) => c.inbox);
    const full: string = (
      await env.call("GET", `/v1/conversations/${inbox.id}`, {
        token: owner.token,
      })
    ).body.messages.at(-1).text;
    expect(full).toContain("2 things since");
    expect(full).toContain("salary bands");
  });

  test("a routine looks up what it needs, speaks only through send_message, and otherwise stays quiet", async () => {
    const { token } = await env.workspace();
    const channel = (
      await env.call("POST", "/v1/delivery-targets", {
        token,
        body: { kind: "webhook", address: "https://hooks.test/eng" },
      })
    ).body;
    const custom = (
      await env.call("POST", "/v1/automations", {
        token,
        body: {
          name: "Retry watch",
          schedule: { type: "daily", at: "09:00" },
          instructions: "Tell me if anything about retries moved",
          targetIds: [channel.id],
        },
      })
    ).body;
    const run = async () =>
      (await env.call("POST", `/v1/automations/${custom.id}/run`, { token }))
        .body;

    const quiet = scriptedModel([
      { tool: "search_activity", input: { query: "retries" } },
      { text: "Nothing moved on retries." },
    ]);
    env.ctx.models = { main: quiet.model, fast: quiet.model };
    const calm = await run();
    expect(calm).toMatchObject({ status: "quiet" });
    expect(calm.summary).toContain("Nothing moved");

    const { model, prompts } = scriptedModel([
      { tool: "search_cards", input: { query: "retry" } },
      notify("Retries: nothing new, but #3 is close to drifting"),
      notify("Team version"),
    ]);
    env.ctx.models = { main: model, fast: model };
    expect((await run()).status).toBe("delivered");
    const tools = (i: number) =>
      (prompts[i].tools ?? []).map((t: any) => t.name).toSorted();
    expect(tools(0)).toContain("my_attention");
    expect(tools(0)).toContain("send_message");
    expect(tools(0)).not.toContain("move_card");
    expect(tools(2)).not.toContain("my_attention");
    expect(JSON.stringify(prompts[1].prompt.at(-1))).toContain("tool-result");
  });

  test("a custom automation writes its team copy without private memory or its last result", async () => {
    const { token } = await env.workspace();
    await env.call("POST", "/v1/memories", {
      token,
      body: {
        content: "Interviewing at Acme",
        kind: "fact",
        visibility: "private",
      },
    });
    const channel = (
      await env.call("POST", "/v1/delivery-targets", {
        token,
        body: { kind: "webhook", address: "https://hooks.test/eng" },
      })
    ).body;
    const { model, prompts } = scriptedModel([
      notify("Full version"),
      notify("Team version"),
    ]);
    env.ctx.models = { main: model, fast: model };
    const custom = (
      await env.call("POST", "/v1/automations", {
        token,
        body: {
          name: "Friday wrap",
          schedule: { type: "weekly", weekday: 5, at: "15:00" },
          instructions: "Summarize my week",
          targetIds: [channel.id],
        },
      })
    ).body;
    await env.call("POST", `/v1/automations/${custom.id}/run`, { token });

    const [own, team] = prompts.map((p) => JSON.stringify(p.prompt));
    expect(own).toContain("Interviewing at Acme");
    expect(own).toContain("Last result");
    expect(team).not.toContain("Interviewing at Acme");
    expect(team).not.toContain("Last result");
    expect(team).toContain("Others might read this too");
    expect((env.ctx.fetch as any).calls.at(-1).body.markdown).toBe(
      "Team version"
    );
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
    expect((await run()).status).toBe("quiet");

    await env.call("POST", `/v1/cards/${card.number}/comments`, {
      token: owner.token,
      body: { body: `@${sam.member.handle} need your call on this` },
    });
    const seen: { type: string; data: Record<string, unknown> }[] = [];
    const unsubscribe = env.ctx.bus.subscribe((e) => {
      if (e.audienceId === sam.member.id) {
        seen.push(e);
      }
    });
    const pinged = await run().finally(unsubscribe);
    expect(pinged.status).toBe("delivered");
    const sent = seen.find((e) => e.type === "notification.sent");
    expect(sent?.data).toMatchObject({
      kind: "push",
      subject: expect.stringMatching(/^Needs you: /u),
    });
    expect(sent?.data.itemIds).toHaveLength(1);

    expect((await run()).status).toBe("skipped");
  });

  test("the scheduler runs whatever is due", async () => {
    const { token, workspace } = await env.workspace();
    await env.call("POST", "/v1/logs", {
      token,
      body: { text: "Call with finance about budget" },
    });
    const autos = (await env.call("GET", "/v1/automations", { token })).body;
    const morning = autos.find((a: any) => a.kind === "brief.daily");
    await onlyDue(workspace.id);
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

  test("what is due runs on the workers, once each, however many schedulers look", async () => {
    const { token, workspace } = await env.workspace();
    const autos = (await env.call("GET", "/v1/automations", { token })).body;
    await onlyDue(workspace.id);
    const latest = Math.max(
      ...autos.map((a: any) => new Date(a.nextRunAt).getTime())
    );
    const due = new Date(latest + 1000);
    env.ctx.now = () => due;
    const queued = await Promise.all([
      queueDueAutomations(env.ctx),
      queueDueAutomations(env.ctx),
    ]);
    expect(queued[0] + queued[1]).toBe(autos.length);
    env.ctx.now = () => new Date(due.getTime() + 16 * 60_000);
    expect(await queueDueAutomations(env.ctx)).toBe(autos.length);
    const jobs = await env.ctx.db.execute<{ n: number }>(sql`
      select count(*)::int as n from graphile_worker._private_jobs
      where key in ${listOf(autos.map((a: any) => `automation:${a.id}`))}`);
    expect(jobs.rows[0]?.n).toBe(autos.length);
    await env.drain();
    const runs = await env.ctx.db.execute<{ id: string; n: number }>(sql`
      select automation_id as id, count(*)::int as n from automation_runs
      where automation_id in ${listOf(autos.map((a: any) => a.id))} group by 1`);
    expect(runs.rows).toHaveLength(autos.length);
    expect(runs.rows.every((r) => r.n === 1)).toBe(true);
  });

  test("a run retried after it finished isn't sent again; one edited while queued still runs", async () => {
    const { token, workspace } = await env.workspace();
    const autos = (await env.call("GET", "/v1/automations", { token })).body;
    const digest = autos.find((a: any) => a.kind === "digest");
    const morning = autos.find((a: any) => a.kind === "brief.daily");
    await onlyDue(workspace.id);
    await env.ctx.db.execute(sql`
      update automations set next_run_at = next_run_at + interval '10 years'
      where workspace_id = ${workspace.id} and id not in (${digest.id}, ${morning.id})`);
    const due = new Date(
      Math.max(
        new Date(digest.nextRunAt).getTime(),
        new Date(morning.nextRunAt).getTime()
      ) + 1000
    );
    env.ctx.now = () => due;
    expect(await queueDueAutomations(env.ctx)).toBe(2);
    await env.call("PATCH", `/v1/automations/${morning.id}`, {
      token,
      body: { name: "Morning" },
    });
    expect(
      (await env.call("POST", `/v1/automations/${morning.id}/run`, { token }))
        .status
    ).toBe(200);
    const { bus } = env.ctx;
    const publish = bus.publish.bind(bus);
    let failed = false;
    bus.publish = async (input) => {
      if (input.type === "automation.ran" && !failed) {
        failed = true;
        throw new Error("events insert failed");
      }
      await publish(input);
    };
    try {
      await env.drain();
      await env.ctx.db.execute(sql`
        update graphile_worker._private_jobs set run_at = now()
        where key = ${`automation:${digest.id}`}`);
      await env.drain();
    } finally {
      bus.publish = publish;
    }
    const runs = await env.ctx.db.execute<{ id: string; n: number }>(sql`
      select automation_id as id, count(*)::int as n from automation_runs
      where automation_id in (${digest.id}, ${morning.id}) group by 1 order by automation_id collate "C"`);
    expect(runs.rows).toEqual(
      [
        { id: digest.id, n: 1 },
        { id: morning.id, n: 2 },
      ].toSorted((a, b) => (a.id < b.id ? -1 : 1))
    );
    const after = (await env.call("GET", "/v1/automations", { token })).body;
    for (const a of after.filter((x: any) =>
      [digest.id, morning.id].includes(x.id)
    )) {
      expect(new Date(a.nextRunAt).getTime()).toBeGreaterThan(
        due.getTime() + 60 * 60_000
      );
    }
  });

  test("a run whose worker died is released and runs, instead of waiting hours", async () => {
    const { token, workspace } = await env.workspace();
    const autos = (await env.call("GET", "/v1/automations", { token })).body;
    const digest = autos.find((a: any) => a.kind === "digest");
    await onlyDue(workspace.id);
    await env.ctx.db.execute(sql`
      update automations set next_run_at = next_run_at + interval '10 years'
      where workspace_id = ${workspace.id} and id <> ${digest.id}`);
    env.ctx.now = () => new Date(new Date(digest.nextRunAt).getTime() + 1000);
    expect(await queueDueAutomations(env.ctx)).toBe(1);
    await env.ctx.db.execute(sql`
      update graphile_worker._private_jobs
      set locked_at = now() - interval '2 hours', locked_by = 'dead-worker', attempts = 1
      where key = ${`automation:${digest.id}`}`);
    await env.ctx.db.execute(sql`
      update graphile_worker._private_job_queues
      set locked_at = now() - interval '2 hours', locked_by = 'dead-worker'
      where queue_name like 'automations:%'
        and id = (select job_queue_id from graphile_worker._private_jobs
          where key = ${`automation:${digest.id}`})`);
    await env.drain();
    const before = await env.ctx.db.execute<{ n: number }>(sql`
      select count(*)::int as n from automation_runs where automation_id = ${digest.id}`);
    expect(before.rows[0]?.n).toBe(0);
    await enqueue(env.ctx, "jobs:release", {});
    await env.drain();
    const after = await env.ctx.db.execute<{ n: number }>(sql`
      select count(*)::int as n from automation_runs where automation_id = ${digest.id}`);
    expect(after.rows[0]?.n).toBe(1);
  });

  test("turning an automation off while it runs keeps it off", async () => {
    const { token } = await env.workspace();
    const autos = (await env.call("GET", "/v1/automations", { token })).body;
    const digest = autos.find((a: any) => a.kind === "digest");
    const loaded = await findAutomationById(env.ctx.db, { id: digest.id });
    await env.call("PATCH", `/v1/automations/${digest.id}`, {
      token,
      body: { enabled: false },
    });
    if (loaded) {
      await runAutomation(env.ctx, loaded);
    }
    const after = (await env.call("GET", "/v1/automations", { token })).body;
    expect(after.find((a: any) => a.id === digest.id).enabled).toBe(false);
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
