import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { nudgeDrifting } from "../src/board/service";
import { sanitizeMarkdown, urlsIn } from "../src/delivery/sanitize";
import { DAY_MS } from "../src/lib/time";
import { scriptedModel, testEnv, type TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});
beforeEach(() => env.reset());

/** Owner + teammate Sam on a shared board, with Sam's attention-check automation at hand. */
async function team() {
  const owner = await env.workspace();
  const sam = await env.teammate(owner.token, "Sam");
  const board = (await env.call("POST", "/v1/boards", { token: owner.token, body: { name: "B" } })).body;
  const autos = (await env.call("GET", "/v1/automations", { token: sam.token })).body;
  const check = autos.find((a: any) => a.kind === "check");
  const digest = autos.find((a: any) => a.kind === "digest");
  const runCheck = async () => (await env.call("POST", `/v1/automations/${check.id}/run`, { token: sam.token })).body;
  let n = 0;
  const mentionSam = async (by = owner.token) => {
    const { body: card } = await env.call("POST", "/v1/cards", { token: by, body: { boardId: board.id, title: `Card ${++n}` } });
    await env.call("POST", `/v1/cards/${card.number}/comments`, { token: by, body: { body: `@${sam.member.handle} please look` } });
    return card;
  };
  return { owner, sam, board, check, digest, runCheck, mentionSam };
}

describe("memory privacy (P0)", () => {
  test("private work never reaches team-visible memory or teammates", async () => {
    const owner = await env.workspace();
    const sam = await env.teammate(owner.token, "Sam");
    await env.call("POST", "/v1/logs", { token: owner.token, body: { text: "Shipped the retry queue" } });
    await env.call("POST", "/v1/logs", { token: owner.token, body: { text: "Salary negotiation call", visibility: "private" } });

    const consolidate = (await env.call("GET", "/v1/automations", { token: owner.token })).body.find((a: any) => a.kind === "consolidate");
    env.ctx.now = () => new Date(Date.now() + DAY_MS);
    await env.call("POST", `/v1/automations/${consolidate.id}/run`, { token: owner.token });

    const journals = (await env.call("GET", "/v1/memories?kind=journal", { token: owner.token })).body;
    const team = journals.find((j: any) => j.visibility === "team");
    const mine = journals.find((j: any) => j.visibility === "private");
    expect(team.content).toContain("Shipped the retry queue");
    expect(team.content).not.toContain("Salary");
    expect(mine.content).toContain("Salary negotiation call");

    // A teammate asking the assistant only ever sees the team journal.
    const { model, prompts } = scriptedModel([{ tool: "recall", input: {} }, { text: "ok" }]);
    env.ctx.models = { main: model, fast: model };
    await env.call("POST", "/v1/conversations", { token: sam.token, body: { to: owner.member.handle, message: "What did Emma do yesterday?" } });
    expect(JSON.stringify(prompts[1].prompt)).not.toContain("Salary");
  });

  test("the model pass over team activity is never shown private activity or private memory", async () => {
    const owner = await env.workspace();
    await env.call("POST", "/v1/memories", { token: owner.token, body: { content: "Secret: planning to leave", kind: "fact", visibility: "private" } });
    await env.call("POST", "/v1/logs", { token: owner.token, body: { text: "Reviewed onboarding copy" } });
    await env.call("POST", "/v1/logs", { token: owner.token, body: { text: "Doctor appointment", visibility: "private" } });
    const { model, prompts } = scriptedModel([{ text: JSON.stringify({ journal: "- did things", facts: [], profile: [] }) }]);
    env.ctx.models = { main: model, fast: model };
    const consolidate = (await env.call("GET", "/v1/automations", { token: owner.token })).body.find((a: any) => a.kind === "consolidate");
    env.ctx.now = () => new Date(Date.now() + DAY_MS);
    await env.call("POST", `/v1/automations/${consolidate.id}/run`, { token: owner.token });

    const teamPass = JSON.stringify(prompts.find((p) => JSON.stringify(p.prompt).includes("Reviewed onboarding copy"))!.prompt);
    expect(teamPass).not.toContain("Doctor appointment");
    expect(teamPass).not.toContain("planning to leave");
  });
});

describe("interruption budget", () => {
  test("urgent items pull the attention check forward (debounced)", async () => {
    const { sam, check, mentionSam } = await team();
    await mentionSam();
    const after = (await env.call("GET", "/v1/automations", { token: sam.token })).body.find((a: any) => a.id === check.id);
    expect(new Date(after.nextRunAt).getTime()).toBeLessThanOrEqual(Date.now() + 3 * 60_000 + 1000);
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
    const items = (await env.call("GET", "/v1/attention", { token: sam.token })).body;
    expect(items.filter((i: any) => i.disposition === null).length).toBe(1);
  });

  test("past the daily cap, urgent items go to the digest, with a reason", async () => {
    const { sam, runCheck, mentionSam } = await team();
    await env.call("PATCH", "/v1/me", { token: sam.token, body: { settings: { activeHours: { start: "00:00", end: "23:59" }, notify: { dailyPushCap: 1, minGapMinutes: 0 } } } });
    await mentionSam();
    expect((await runCheck()).status).toBe("delivered");
    await mentionSam();
    expect((await runCheck()).status).toBe("quiet");
    const latest = (await env.call("GET", "/v1/attention", { token: sam.token })).body.find((i: any) => i.disposition === "digest");
    expect(latest.reason).toContain("budget");
  });

  test("one sender can't flood someone with high-priority items", async () => {
    const { sam, mentionSam } = await team();
    for (let i = 0; i < 3; i++) await mentionSam();
    const items = (await env.call("GET", "/v1/attention", { token: sam.token })).body.filter((i: any) => i.kind === "mention");
    expect(items.map((i: any) => i.priority).sort()).toEqual(["high", "high", "normal"]);
  });
});

describe("feedback and digests", () => {
  test("'less like this' holds that kind for the digest; the digest then delivers it once", async () => {
    const { sam, runCheck, mentionSam, digest } = await team();
    await mentionSam();
    await runCheck();
    const [first] = (await env.call("GET", "/v1/attention", { token: sam.token })).body;
    const fb = await env.call("POST", `/v1/attention/${first.id}/feedback`, { token: sam.token, body: { signal: "less_like_this" } });
    expect(fb.body).toEqual({ kind: "mention", muted: true });

    await env.call("PATCH", "/v1/me", { token: sam.token, body: { settings: { activeHours: { start: "00:00", end: "23:59" }, notify: { minGapMinutes: 0 } } } });
    await mentionSam();
    expect((await runCheck()).status).toBe("quiet");

    const run = (await env.call("POST", `/v1/automations/${digest.id}/run`, { token: sam.token })).body;
    expect(run.status).toBe("delivered");
    expect((await env.call("POST", `/v1/automations/${digest.id}/run`, { token: sam.token })).body.status).toBe("skipped");

    const metrics = (await env.call("GET", "/v1/attention/metrics", { token: sam.token })).body;
    expect(metrics).toMatchObject({ pushes: 1, mutedKinds: ["mention"], feedback: { less_like_this: 1 } });
  });
});

describe("drift nudges", () => {
  test("asks the assignee before a card drifts, once, and acts on the one-click answer", async () => {
    const owner = await env.workspace();
    const board = (await env.call("POST", "/v1/boards", { token: owner.token, body: { name: "B", entropyDays: 7 } })).body;
    const { body: card } = await env.call("POST", "/v1/cards", {
      token: owner.token,
      body: { boardId: board.id, title: "Migrate billing", columnId: board.columns[0].id, assigneeIds: [owner.member.id] },
    });
    // Assigning yourself is activity too; wait out 6 of the 7 days.
    env.ctx.now = () => new Date(Date.now() + 6 * DAY_MS);
    expect(await nudgeDrifting(env.ctx)).toBe(1);
    expect(await nudgeDrifting(env.ctx)).toBe(0); // once per quiet spell

    const item = (await env.call("GET", "/v1/attention", { token: owner.token })).body.find((a: any) => a.kind === "card.drifting");
    expect(item.actions.map((a: any) => a.id)).toEqual(["keep", "not_now", "done"]);
    const answered = await env.call("POST", `/v1/attention/${item.id}/actions/keep`, { token: owner.token });
    expect(answered.body.state).toBe("done");

    const after = (await env.call("GET", `/v1/cards/${card.number}`, { token: owner.token })).body;
    expect(after.entropy.postponingSoon).toBe(false); // the clock restarted
  });
});

describe("outbound sanitizing", () => {
  test("drops images and links that weren't in the source data", () => {
    const md = [
      "See [the PR](https://github.com/acme/api/pull/7) and [this](https://evil.example/?q=secret)",
      "![](https://evil.example/pixel?d=salary) <https://evil.example/a> raw https://evil.example/b",
      "<img src=x onerror=alert(1)>",
    ].join("\n");
    const out = sanitizeMarkdown(md, urlsIn({ url: "https://github.com/acme/api/pull/7" }));
    expect(out).toContain("[the PR](https://github.com/acme/api/pull/7)");
    expect(out).not.toContain("evil.example");
    expect(out).toContain("this");
  });
});

describe("assistant step limit", () => {
  test("a turn cut off mid-tool-call says so, and the transcript records it", async () => {
    const owner = await env.workspace();
    const { model } = scriptedModel([{ tool: "team_directory", input: {} }]); // never stops calling tools
    env.ctx.models = { main: model, fast: model };
    const res = await env.call("POST", "/v1/conversations", { token: owner.token, body: { message: "Loop forever" } });
    expect(res.body.reply).toContain("ran out of steps");
    const thread = (await env.call("GET", `/v1/conversations/${res.body.conversation.id}`, { token: owner.token })).body;
    expect(thread.messages.at(-1).text).toContain("ran out of steps");
  });
});
