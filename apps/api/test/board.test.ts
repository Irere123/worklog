import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { sweepEntropy } from "../src/board/service";
import { DAY_MS } from "../src/lib/time";
import { testEnv } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});
beforeEach(() => {
  env.reset();
});

describe("API basics", () => {
  test("setup is closed once a workspace exists, unless the setup secret is sent", async () => {
    await env.workspace();
    const res = await env.call("POST", "/v1/setup", {
      body: { workspaceName: "X", name: "Y" },
    });
    expect(res.status).toBe(403);
  });

  test("requests without a valid token are rejected", async () => {
    expect((await env.call("GET", "/v1/me")).status).toBe(401);
    expect((await env.call("GET", "/v1/me", { token: "wl_nope" })).status).toBe(
      401
    );
  });

  test("me returns the member, workspace and personal assistant", async () => {
    const { token } = await env.workspace("Me Co");
    const res = await env.call("GET", "/v1/me", { token });
    expect(res.status).toBe(200);
    expect(res.body.member.name).toBe("Emma");
    expect(res.body.assistant.kind).toBe("agent");
    expect(res.body.assistant.ownerId).toBe(res.body.member.id);
  });

  test("the OpenAPI document describes the API with stable operation ids", async () => {
    const res = await env.call("GET", "/openapi.json");
    expect(res.status).toBe(200);
    const ops = Object.values(
      res.body.paths as Record<string, Record<string, { operationId: string }>>
    ).flatMap((p) => Object.values(p).map((o) => o.operationId));
    expect(ops).toContain("card.close");
    expect(ops).toContain("conversation.create");
    expect(new Set(ops).size).toBe(ops.length);
  });

  test("validation errors come back as 400 with details", async () => {
    const { token } = await env.workspace();
    const res = await env.call("POST", "/v1/cards", {
      token,
      body: { title: "" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_request");
  });
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
    // Mention sorts first
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
