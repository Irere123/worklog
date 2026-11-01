import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { DAY_MS } from "#lib/time";
import { nudgeDrifting, sweepEntropy } from "#work/drift";

import { testEnv } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});
beforeEach(() => {
  env.reset();
});

async function boardSetup() {
  const owner = await env.workspace();
  const board = await env.call("POST", "/v1/boards", {
    token: owner.token,
    body: { name: "Product", columns: ["Doing", "Review"] },
  });
  expect(board.status).toBe(201);
  return { ...owner, board: board.body };
}

describe("board (Fizzy rules)", () => {
  test("new cards land in Maybe? and are numbered per workspace", async () => {
    const { token, board } = await boardSetup();
    const a = await env.call("POST", "/v1/cards", {
      token,
      body: { boardId: board.id, title: "First" },
    });
    const b = await env.call("POST", "/v1/cards", {
      token,
      body: { boardId: board.id, title: "Second" },
    });
    expect(a.body.stage).toBe("triage");
    expect(a.body.number).toBe(1);
    expect(b.body.number).toBe(2);
  });

  test("cards can be listed by who added them and who they're assigned to", async () => {
    const { token, board, member } = await boardSetup();
    const sam = await env.teammate(token, "Sam");
    await env.call("POST", "/v1/cards", {
      token,
      body: { boardId: board.id, title: "Mine" },
    });
    await env.call("POST", "/v1/cards", {
      token: sam.token,
      body: { boardId: board.id, title: "Sam's", assigneeIds: [member.id] },
    });
    const titles = async (query: string) =>
      (await env.call("GET", `/v1/cards?${query}`, { token })).body.map(
        (c: { title: string }) => c.title
      );

    expect(await titles("addedBy=me")).toEqual(["Mine"]);
    expect(await titles(`addedBy=${sam.member.handle}`)).toEqual(["Sam's"]);
    expect(await titles("assignee=me")).toEqual(["Sam's"]);
  });

  test("pins live in a person's settings, so they follow them to every device", async () => {
    const { token } = await boardSetup();
    const saved = await env.call("PATCH", "/v1/me", {
      token,
      body: { settings: { pins: [3, 1] } },
    });
    expect(saved.status).toBe(200);
    const me = await env.call("GET", "/v1/me", { token });
    expect(me.body.member.settings.pins).toEqual([3, 1]);

    const tooMany = await env.call("PATCH", "/v1/me", {
      token,
      body: { settings: { pins: Array.from({ length: 51 }, (_, i) => i + 1) } },
    });
    expect(tooMany.status).toBe(400);
  });

  test("a card moves through triage → column → not now → back → done → reopen", async () => {
    const { token, board } = await boardSetup();
    const doing = board.columns.find((c: any) => c.name === "Doing");
    const { body: card } = await env.call("POST", "/v1/cards", {
      token,
      body: { boardId: board.id, title: "Ship it" },
    });
    const n = card.number;

    let res = await env.call("POST", `/v1/cards/${n}/triage`, {
      token,
      body: { columnId: doing.id },
    });
    expect(res.body).toMatchObject({ stage: "active", columnName: "Doing" });
    expect(res.body.entropy.days).toBe(30);

    res = await env.call("POST", `/v1/cards/${n}/not_now`, { token });
    expect(res.body).toMatchObject({ stage: "not_now", columnId: null });

    res = await env.call("DELETE", `/v1/cards/${n}/not_now`, { token });
    expect(res.body.stage).toBe("triage");

    res = await env.call("POST", `/v1/cards/${n}/closure`, { token });
    expect(res.body.stage).toBe("done");
    expect(res.body.closedAt).not.toBeNull();

    res = await env.call("DELETE", `/v1/cards/${n}/closure`, { token });
    expect(res.body.stage).toBe("triage");

    const history = await env.call("GET", `/v1/activities?card=${n}`, {
      token,
    });
    expect(history.body.map((a: any) => a.kind)).toEqual(
      expect.arrayContaining([
        "card.created",
        "card.triaged",
        "card.postponed",
        "card.resumed",
        "card.closed",
        "card.reopened",
      ])
    );
  });

  test("golden tickets sort first; otherwise most recently active first", async () => {
    const { token, board } = await boardSetup();
    for (const title of ["Old", "Golden", "New"]) {
      await env.call("POST", "/v1/cards", {
        token,
        body: { boardId: board.id, title },
      });
    }
    const cards = (
      await env.call("GET", `/v1/cards?board=${board.id}`, { token })
    ).body;
    const golden = cards.find((c: any) => c.title === "Golden");
    await env.call("POST", `/v1/cards/${golden.number}/goldness`, { token });
    const sorted = (
      await env.call("GET", `/v1/cards?board=${board.id}`, { token })
    ).body.map((c: any) => c.title);
    expect(sorted[0]).toBe("Golden");
  });

  test("assigning someone and @mentioning them creates attention for them", async () => {
    const { token, board } = await boardSetup();
    const sam = await env.teammate(token, "Sam");
    const { body: card } = await env.call("POST", "/v1/cards", {
      token,
      body: {
        boardId: board.id,
        title: "Payments retry",
        assigneeIds: [sam.member.id],
      },
    });
    await env.call("POST", `/v1/cards/${card.number}/comments`, {
      token,
      body: { body: `@${sam.member.handle} can you check the backoff?` },
    });

    const attention = (
      await env.call("GET", "/v1/attention", { token: sam.token })
    ).body;
    expect(attention.map((a: any) => a.kind)).toEqual(
      expect.arrayContaining(["card.assigned", "mention"])
    );
    expect(attention[0].priority).toBe("high");
  });

  test("watchers get one collapsed item per card, not one per comment", async () => {
    const { token, board } = await boardSetup();
    const sam = await env.teammate(token, "Sam");
    const { body: card } = await env.call("POST", "/v1/cards", {
      token: sam.token,
      body: { boardId: board.id, title: "Watched" },
    });
    for (const text of ["one", "two", "three"]) {
      await env.call("POST", `/v1/cards/${card.number}/comments`, {
        token,
        body: { body: text },
      });
    }
    const items = (
      await env.call("GET", "/v1/attention", { token: sam.token })
    ).body.filter((a: any) => a.kind === "card.activity");
    expect(items).toHaveLength(1);
    expect(items[0].count).toBe(3);
  });

  test("entropy: untouched active cards drift to Not now; warnings in the last quarter", async () => {
    const { token, board } = await boardSetup();
    await env.call("PATCH", `/v1/boards/${board.id}`, {
      token,
      body: { entropyDays: 7 },
    });
    const [doing] = board.columns;
    const { body: card } = await env.call("POST", "/v1/cards", {
      token,
      body: { boardId: board.id, title: "Stale", columnId: doing.id },
    });

    const start = Date.now();
    env.ctx.now = () => new Date(start + 6 * DAY_MS);
    const soon = (await env.call("GET", `/v1/cards/${card.number}`, { token }))
      .body;
    expect(soon.entropy.postponingSoon).toBe(true);

    env.ctx.now = () => new Date(start + 8 * DAY_MS);
    expect(await sweepEntropy(env.ctx)).toBeGreaterThanOrEqual(1);
    const after = (await env.call("GET", `/v1/cards/${card.number}`, { token }))
      .body;
    expect(after).toMatchObject({ stage: "not_now", autoPostponed: true });
  });
});

describe("drift nudges", () => {
  test("asks the assignee before a card drifts, once, and acts on the one-click answer", async () => {
    const owner = await env.workspace();
    const board = (
      await env.call("POST", "/v1/boards", {
        token: owner.token,
        body: { name: "B", entropyDays: 7 },
      })
    ).body;
    const { body: card } = await env.call("POST", "/v1/cards", {
      token: owner.token,
      body: {
        boardId: board.id,
        title: "Migrate billing",
        columnId: board.columns[0].id,
        assigneeIds: [owner.member.id],
      },
    });
    // Assigning yourself is activity too; wait out 6 of the 7 days.
    env.ctx.now = () => new Date(Date.now() + 6 * DAY_MS);
    expect(await nudgeDrifting(env.ctx)).toBe(1);
    // Once per quiet spell
    expect(await nudgeDrifting(env.ctx)).toBe(0);

    const item = (
      await env.call("GET", "/v1/attention", { token: owner.token })
    ).body.find((a: any) => a.kind === "card.drifting");
    expect(item.actions.map((a: any) => a.id)).toEqual([
      "keep",
      "not_now",
      "done",
    ]);
    const answered = await env.call(
      "POST",
      `/v1/attention/${item.id}/actions/keep`,
      { token: owner.token }
    );
    expect(answered.body.state).toBe("done");

    const after = (
      await env.call("GET", `/v1/cards/${card.number}`, { token: owner.token })
    ).body;
    expect(after.entropy.postponingSoon).toBe(false);
  });
});
