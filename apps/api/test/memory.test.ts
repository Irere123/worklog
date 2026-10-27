import { expect, test } from "bun:test";

import { DAY_MS } from "#lib/time";

import { scriptedModel, testEnv } from "./harness";
import type { TestEnv } from "./harness";

// Kigali is UTC+2 all year, the harness's default workspace time zone.
const TUESDAY = new Date("2026-10-27T10:00:00Z");
const WEDNESDAY = new Date("2026-10-28T10:00:00Z");
const SUNDAY = new Date("2026-11-01T10:00:00Z");
const MONDAY = new Date("2026-11-02T10:00:00Z");

async function consolidate(env: TestEnv, token: string, at: Date) {
  const auto = (await env.call("GET", "/v1/automations", { token })).body.find(
    (a: any) => a.kind === "consolidate"
  );
  env.ctx.now = () => at;
  return (await env.call("POST", `/v1/automations/${auto.id}/run`, { token }))
    .body;
}

async function memories(env: TestEnv, token: string, query = "") {
  return (await env.call("GET", `/v1/memories${query}`, { token })).body;
}

// About 22k tokens a turn, so three turns cross the compaction budget.
function big(label: string) {
  return `${label} ${"x".repeat(90_000)}`;
}

const nothingNew = JSON.stringify({
  journal: "- a day",
  facts: [],
  profile: [],
});

test("a long conversation folds its older turns into a recap that later turns start from", async () => {
  const env = await testEnv();
  const { token } = await env.workspace();
  const recap = {
    openLoops: ["Emma owes Sam the retry design doc"],
    decisions: ["Retries move to a queue"],
    identifiers: ["#12", "PR #41"],
    done: [],
    context: "Planning the payments retry work.",
  };
  const { model, prompts } = scriptedModel([
    { text: "one" },
    { text: "two" },
    { text: "three" },
    { text: JSON.stringify(recap) },
    { text: "four" },
  ]);
  env.ctx.models = { main: model, fast: model };

  const first = await env.call("POST", "/v1/conversations", {
    token,
    body: { message: big("first-turn") },
  });
  const { id } = first.body.conversation;
  for (const label of ["second-turn", "third-turn"]) {
    await env.call("POST", `/v1/conversations/${id}/messages`, {
      token,
      body: { message: big(label) },
    });
  }
  await env.drain();
  await env.call("POST", `/v1/conversations/${id}/messages`, {
    token,
    body: { message: "Where were we?" },
  });

  const next = JSON.stringify(prompts[4]!.prompt);
  expect(next).toContain("Emma owes Sam the retry design doc");
  expect(next).toContain("PR #41");
  expect(next).not.toContain("first-turn");
  expect(next).not.toContain("second-turn");
  expect(next).toContain("third-turn");
  const stored = (await env.call("GET", `/v1/conversations/${id}`, { token }))
    .body;
  expect(stored.messages).toHaveLength(8);
});

test("conversations start from the nightly digest, and teammates only get the team one", async () => {
  const env = await testEnv();
  const owner = await env.workspace();
  const sam = await env.teammate(owner.token, "Sam");
  env.ctx.now = () => TUESDAY;
  await env.call("POST", "/v1/memories", {
    token: owner.token,
    body: { content: "Owns the payments service", kind: "fact" },
  });
  await env.call("POST", "/v1/memories", {
    token: owner.token,
    body: {
      content: "Interviewing elsewhere",
      kind: "fact",
      visibility: "private",
    },
  });
  await env.call("POST", "/v1/logs", {
    token: owner.token,
    body: { text: "Shipped the retry queue" },
  });

  const writer = scriptedModel([
    { text: nothingNew },
    { text: "TEAM-DIGEST: owns payments" },
    { text: "PRIVATE-DIGEST: owns payments, interviewing" },
  ]);
  env.ctx.models = { main: writer.model, fast: writer.model };
  expect((await consolidate(env, owner.token, WEDNESDAY)).status).toBe("quiet");
  const teamDigestInput = JSON.stringify(writer.prompts[1]!.prompt);
  expect(teamDigestInput).toContain("Owns the payments service");
  expect(teamDigestInput).not.toContain("Interviewing elsewhere");

  const chat = scriptedModel([{ text: "ok" }]);
  env.ctx.models = { main: chat.model, fast: chat.model };
  await env.call("POST", "/v1/conversations", {
    token: sam.token,
    body: { to: owner.member.handle, message: "What does Emma own?" },
  });
  await env.call("POST", "/v1/conversations", {
    token: owner.token,
    body: { message: "Morning" },
  });
  const asTeammate = JSON.stringify(chat.prompts[0]!.prompt);
  const asOwner = JSON.stringify(chat.prompts[1]!.prompt);
  expect(asTeammate).toContain("TEAM-DIGEST");
  expect(asTeammate).not.toContain("PRIVATE-DIGEST");
  expect(asTeammate).not.toContain("interviewing");
  expect(asOwner).toContain("PRIVATE-DIGEST");
});

test("what the owner told their assistant is consolidated privately, and time-bound facts expire", async () => {
  const env = await testEnv();
  const owner = await env.workspace();
  const chat = scriptedModel([{ text: "Noted, enjoy the break." }]);
  env.ctx.models = { main: chat.model, fast: chat.model };
  env.ctx.now = () => TUESDAY;
  await env.call("POST", "/v1/conversations", {
    token: owner.token,
    body: { message: "I'm on leave until Friday 30 Oct; Sam covers payments." },
  });

  const writer = scriptedModel([
    {
      text: JSON.stringify({
        journal: "- Planned leave",
        facts: [
          {
            content: "On leave until 30 Oct; Sam covers payments",
            aliases: ["leave", "@sam"],
            expiresOn: "2026-10-30",
          },
        ],
        profile: [],
      }),
    },
    { text: "team digest" },
    { text: "private digest" },
  ]);
  env.ctx.models = { main: writer.model, fast: writer.model };
  await consolidate(env, owner.token, WEDNESDAY);
  expect(JSON.stringify(writer.prompts[0]!.prompt)).toContain(
    "on leave until Friday 30 Oct"
  );

  const [fact] = await memories(env, owner.token, "?kind=fact");
  expect(fact).toMatchObject({
    visibility: "private",
    aliases: ["leave", "@sam"],
    expiresAt: "2026-10-30T22:00:00.000Z",
  });
  expect(await memories(env, owner.token, "?kind=fact&q=leave")).toHaveLength(
    1
  );
  env.ctx.now = () => SUNDAY;
  expect(await memories(env, owner.token, "?kind=fact")).toHaveLength(0);
});

test("Sunday's run tidies memory: duplicates merge and stale lines retire, keeping the history", async () => {
  const env = await testEnv();
  const { token } = await env.workspace();
  env.ctx.now = () => SUNDAY;
  const add = async (content: string) =>
    (
      await env.call("POST", "/v1/memories", {
        token,
        body: { content, kind: "fact" },
      })
    ).body.id as string;
  const a = await add("Prefers async updates");
  const b = await add("Likes written updates better than calls");
  const c = await add("Demo for Acme on Friday");

  const writer = scriptedModel([
    {
      text: JSON.stringify({
        rewrites: [
          {
            replaces: [a, b, "mmr_not_theirs"],
            kind: "fact",
            content: "Prefers written, async updates over calls",
            aliases: ["async", "calls"],
            expiresOn: null,
          },
        ],
        retire: [c],
      }),
    },
    { text: "team digest" },
    { text: "private digest" },
  ]);
  env.ctx.models = { main: writer.model, fast: writer.model };
  const run = await consolidate(env, token, MONDAY);
  expect(run.summary).toContain("2 line(s) merged, 1 retired");

  const facts = await memories(env, token, "?kind=fact");
  expect(facts.map((m: any) => m.content)).toEqual([
    "Prefers written, async updates over calls",
  ]);
  const merged = facts[0].id;
  const history = async (id: string, as = token) =>
    await env.call("GET", `/v1/memories/${id}/history`, { token: as });
  const lineage = (await history(merged)).body.map((m: any) => m.id);
  expect(lineage).toHaveLength(3);
  expect(lineage).toEqual(expect.arrayContaining([a, b, merged]));
  expect((await history(a)).body).toMatchObject([
    { id: a, status: "superseded", supersededBy: merged },
    { id: merged, status: "active", supersededBy: null },
  ]);
  expect((await history(c)).body).toMatchObject([
    { id: c, status: "superseded", supersededBy: null },
  ]);
  const sam = await env.teammate(token, "Sam");
  expect((await history(a, sam.token)).status).toBe(404);
});

test("recall matches word by word and forgives typos", async () => {
  const env = await testEnv();
  const { token } = await env.workspace();
  for (const content of [
    "Loves pasta from the corner place",
    "Owns the payment service and its retry queue",
  ]) {
    await env.call("POST", "/v1/memories", {
      token,
      body: { content, kind: "fact" },
    });
  }
  const top = async (q: string) =>
    (await memories(env, token, `?q=${encodeURIComponent(q)}`)).map(
      (m: any) => m.content
    );
  expect((await top("pazta"))[0]).toBe("Loves pasta from the corner place");
  expect((await top("who owns payments"))[0]).toBe(
    "Owns the payment service and its retry queue"
  );
  expect(await top("billing")).toEqual([]);
});

test("a new conversation opens with what's in flight; later turns don't repeat it", async () => {
  const env = await testEnv();
  const owner = await env.workspace();
  const sam = await env.teammate(owner.token, "Sam");
  const board = (
    await env.call("POST", "/v1/boards", {
      token: owner.token,
      body: { name: "Product", columns: ["Doing"] },
    })
  ).body;
  const { body: card } = await env.call("POST", "/v1/cards", {
    token: owner.token,
    body: {
      boardId: board.id,
      title: "Payments retry",
      columnId: board.columns[0].id,
      assigneeIds: [sam.member.id],
    },
  });
  await env.call("POST", `/v1/cards/${card.number}/comments`, {
    token: owner.token,
    body: { body: `@${sam.member.handle} can you check the backoff?` },
  });

  const { model, prompts } = scriptedModel([{ text: "ok" }]);
  env.ctx.models = { main: model, fast: model };
  const res = await env.call("POST", "/v1/conversations", {
    token: sam.token,
    body: { message: "What should I do first?" },
  });
  await env.call(
    "POST",
    `/v1/conversations/${res.body.conversation.id}/messages`,
    { token: sam.token, body: { message: "And after that?" } }
  );

  const opening = JSON.stringify(prompts[0]!.prompt.at(-1));
  expect(opening).toContain("Open right now");
  expect(opening).toContain(`#${card.number} Payments retry`);
  expect(opening).toContain("waiting on Sam");
  expect(JSON.stringify(prompts[1]!.prompt.at(-1))).not.toContain(
    "Open right now"
  );
});

test("memory exports as Markdown files split by visibility, unchanged until memory changes", async () => {
  const env = await testEnv();
  const { token } = await env.workspace();
  env.ctx.now = () => TUESDAY;
  for (const body of [
    { content: "Owns the payments\nservice", aliases: ["billing"] },
    { content: "Interviewing elsewhere", kind: "fact", visibility: "private" },
    {
      content: "On leave until 30 Oct",
      kind: "fact",
      expiresAt: "2026-10-30T22:00:00.000Z",
    },
  ]) {
    await env.call("POST", "/v1/memories", { token, body });
  }
  await env.call("POST", "/v1/logs", {
    token,
    body: { text: "Shipped the retry queue" },
  });
  await consolidate(env, token, WEDNESDAY);
  const exported = async (at: Date) => {
    env.ctx.now = () => at;
    return (await env.call("GET", "/v1/memories/export", { token })).body
      .files as { path: string; content: string }[];
  };

  const files = await exported(WEDNESDAY);
  expect(files.map((f) => f.path)).toEqual([
    "private/facts.md",
    "team/facts.md",
    "team/journal/2026-10-27.md",
    "team/profile.md",
  ]);
  const file = (path: string) => files.find((f) => f.path === path)?.content;
  expect(file("team/profile.md")).toMatch(
    /^# Profile\n\n- Owns the payments service \(also: billing\) \[mmr_\w+\]\n$/u
  );
  expect(file("team/facts.md")).toContain(
    "- On leave until 30 Oct (until 2026-10-30)"
  );
  expect(file("team/facts.md")).not.toContain("Interviewing");
  expect(file("private/facts.md")).toContain("Interviewing elsewhere");
  expect(file("team/journal/2026-10-27.md")).toContain(
    "Shipped the retry queue"
  );

  expect(await exported(new Date("2026-10-29T10:00:00Z"))).toEqual(files);
  expect((await exported(SUNDAY)).map((f) => f.path)).not.toContain(
    "team/facts.md"
  );
});

test("private work never reaches team-visible memory or teammates", async () => {
  const env = await testEnv();
  const owner = await env.workspace();
  const sam = await env.teammate(owner.token, "Sam");
  await env.call("POST", "/v1/logs", {
    token: owner.token,
    body: { text: "Shipped the retry queue" },
  });
  await env.call("POST", "/v1/logs", {
    token: owner.token,
    body: { text: "Salary negotiation call", visibility: "private" },
  });

  await consolidate(env, owner.token, new Date(Date.now() + DAY_MS));

  const journals = (
    await env.call("GET", "/v1/memories?kind=journal", { token: owner.token })
  ).body;
  const shared = journals.find((j: any) => j.visibility === "team");
  const mine = journals.find((j: any) => j.visibility === "private");
  expect(shared.content).toContain("Shipped the retry queue");
  expect(shared.content).not.toContain("Salary");
  expect(mine.content).toContain("Salary negotiation call");

  // A teammate asking the assistant only ever sees the team journal.
  const { model, prompts } = scriptedModel([
    { tool: "recall", input: {} },
    { text: "ok" },
  ]);
  env.ctx.models = { main: model, fast: model };
  await env.call("POST", "/v1/conversations", {
    token: sam.token,
    body: { to: owner.member.handle, message: "What did Emma do yesterday?" },
  });
  expect(JSON.stringify(prompts[1].prompt)).not.toContain("Salary");
});

test("the model pass over team activity is never shown private activity or private memory", async () => {
  const env = await testEnv();
  const owner = await env.workspace();
  await env.call("POST", "/v1/memories", {
    token: owner.token,
    body: {
      content: "Secret: planning to leave",
      kind: "fact",
      visibility: "private",
    },
  });
  await env.call("POST", "/v1/logs", {
    token: owner.token,
    body: { text: "Reviewed onboarding copy" },
  });
  await env.call("POST", "/v1/logs", {
    token: owner.token,
    body: { text: "Doctor appointment", visibility: "private" },
  });
  const { model, prompts } = scriptedModel([
    {
      text: JSON.stringify({
        journal: "- did things",
        facts: [],
        profile: [],
      }),
    },
  ]);
  env.ctx.models = { main: model, fast: model };
  await consolidate(env, owner.token, new Date(Date.now() + DAY_MS));

  const teamPass = JSON.stringify(
    prompts.find((p) =>
      JSON.stringify(p.prompt).includes("Reviewed onboarding copy")
    )!.prompt
  );
  expect(teamPass).not.toContain("Doctor appointment");
  expect(teamPass).not.toContain("planning to leave");
});
