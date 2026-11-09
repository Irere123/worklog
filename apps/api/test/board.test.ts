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

  test("cards can be listed by who they're assigned to", async () => {
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

    expect(await titles("assignee=me")).toEqual(["Sam's"]);
  });

  test("searching a card's number finds it, with or without the #", async () => {
    const { token, board } = await boardSetup();
    for (const title of ["Ship the export", "Fix 2FA", "Review the copy"]) {
      await env.call("POST", "/v1/cards", {
        token,
        body: { boardId: board.id, title },
      });
    }
    const titles = async (q: string) =>
      (
        await env.call("GET", `/v1/cards?q=${encodeURIComponent(q)}`, {
          token,
        })
      ).body.map((c: { title: string }) => c.title);

    expect(await titles("3")).toEqual(["Review the copy"]);
    expect(await titles("#3")).toEqual(["Review the copy"]);
    expect(await titles("2")).toEqual(["Fix 2FA"]);
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

  test("an edit's log line says what changed in words, not field names", async () => {
    const { token, board } = await boardSetup();
    const { body: card } = await env.call("POST", "/v1/cards", {
      token,
      body: { boardId: board.id, title: "Ship it" },
    });
    const edit = async (body: Record<string, unknown>) => {
      await env.call("PATCH", `/v1/cards/${card.number}`, { token, body });
      const history = await env.call(
        "GET",
        `/v1/activities?card=${card.number}&kind=card.updated`,
        { token }
      );
      return history.body[0].body;
    };

    expect(await edit({ body: "Context" })).toBe("Edited the description");
    expect(await edit({ tags: ["ops", "urgent"] })).toBe("Tagged #ops #urgent");
    expect(await edit({ dueOn: "2026-11-02", title: "Ship it now" })).toBe(
      "Renamed it · Set it due 2 Nov"
    );
    expect(await edit({ dueOn: null })).toBe("Cleared the due date");
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

describe("the team at a glance", () => {
  test("everyone's current card and latest work, private logs only for their author", async () => {
    const owner = await env.workspace();
    const ana = await env.teammate(owner.token, "Ana");
    const board = (
      await env.call("POST", "/v1/boards", {
        token: owner.token,
        body: { name: "B" },
      })
    ).body;
    for (const title of ["Quiet one", "Ship the importer"]) {
      await env.call("POST", "/v1/cards", {
        token: owner.token,
        body: {
          boardId: board.id,
          title,
          columnId: board.columns[0].id,
          assigneeIds: [ana.member.id],
        },
      });
    }
    await env.call("POST", "/v1/cards/2/goldness", { token: owner.token });
    await env.call("POST", "/v1/logs", {
      token: ana.token,
      body: { text: "Paired on the importer", visibility: "team" },
    });
    await env.call("POST", "/v1/logs", {
      token: ana.token,
      body: { text: "Interviewing elsewhere", visibility: "private" },
    });

    const seenByOwner = await env.call("GET", "/v1/now?days=3", {
      token: owner.token,
    });
    expect(seenByOwner.status).toBe(200);
    const anaForOwner = seenByOwner.body.find(
      (row: any) => row.memberId === ana.member.id
    );
    expect(anaForOwner.current).toMatchObject({
      number: 2,
      title: "Ship the importer",
      golden: true,
    });
    expect(anaForOwner.latest.title).not.toContain("Interviewing");

    // An agent's state comes from its latest update that carried one, not its latest line.
    const agent = (
      await env.call("POST", "/v1/members", {
        token: owner.token,
        body: {
          kind: "agent",
          name: "Atlas",
          agentProvider: "cursor",
          ownerId: owner.member.id,
          issueToken: true,
        },
      })
    ).body;
    await env.call("POST", "/v1/activities", {
      token: agent.token.token,
      body: {
        kind: "agent.task",
        title: "Should I take the maintenance window?",
        thread: "cursor:bc-1",
        state: "needs_you",
        cardNumber: 2,
      },
    });
    await env.call("POST", "/v1/activities", {
      token: agent.token.token,
      body: { kind: "agent.note", title: "Read the runbook" },
    });
    const withAgent = await env.call("GET", "/v1/now", { token: owner.token });
    const atlas = withAgent.body.find(
      (row: any) => row.memberId === agent.member.id
    );
    expect(atlas.latest.title).toBe("Read the runbook");
    expect(atlas.agent).toMatchObject({
      state: "needs_you",
      title: "Should I take the maintenance window?",
      cardNumber: 2,
    });
    expect(anaForOwner.agent).toBeNull();

    const seenByAna = await env.call("GET", "/v1/now", { token: ana.token });
    const anaForAna = seenByAna.body.find(
      (row: any) => row.memberId === ana.member.id
    );
    expect(anaForAna.latest.title).toContain("Interviewing");
  });
});

describe("counting the day", () => {
  test("activity counts by kind cover everything since a time, and only the asker's private entries", async () => {
    const owner = await env.workspace();
    const ana = await env.teammate(owner.token, "Ana");
    const since = new Date(Date.now() - 60_000).toISOString();
    const board = (
      await env.call("POST", "/v1/boards", {
        token: owner.token,
        body: { name: "B" },
      })
    ).body;
    for (const title of ["One", "Two", "Three"]) {
      await env.call("POST", "/v1/cards", {
        token: owner.token,
        body: { boardId: board.id, title },
      });
    }
    await env.call("POST", "/v1/cards/1/closure", { token: owner.token });
    await env.call("POST", "/v1/logs", {
      token: ana.token,
      body: { text: "Interviewing elsewhere", visibility: "private" },
    });

    const counts = async (token: string) =>
      Object.fromEntries(
        (
          await env.call(
            "GET",
            `/v1/activities/counts?since=${encodeURIComponent(since)}`,
            { token }
          )
        ).body.map((row: any) => [row.kind, row.count])
      );
    const forOwner = await counts(owner.token);
    expect(forOwner["card.created"]).toBe(3);
    expect(forOwner["card.closed"]).toBe(1);
    expect(Object.keys(forOwner).some((kind) => kind.startsWith("log."))).toBe(
      false
    );
    const forAna = await counts(ana.token);
    expect(Object.keys(forAna).some((kind) => kind.startsWith("log."))).toBe(
      true
    );
  });
});
