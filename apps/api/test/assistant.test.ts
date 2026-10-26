import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { scriptedModel, testEnv } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});
beforeEach(() => {
  env.reset();
});

const toolNames = (prompt: any) =>
  (prompt.tools ?? []).map((t: any) => t.name).toSorted();

describe("assistant", () => {
  test("without AI configured it still answers from the data", async () => {
    const { token } = await env.workspace();
    const res = await env.call("POST", "/v1/conversations", {
      token,
      body: { message: "What am I working on?" },
    });
    expect(res.status).toBe(201);
    expect(res.body.reply).toContain("OPENROUTER_API_KEY");
  });

  test("owner mode: looks things up with tools, answers, and keeps an append-only history", async () => {
    const owner = await env.workspace();
    const { model, prompts } = scriptedModel([
      { tool: "work_snapshot", input: { person: owner.member.handle } },
      { text: "You're on #1 Draft the Q4 plan." },
      { text: "Nothing else is in progress." },
    ]);
    env.ctx.models = { main: model, fast: model };
    const board = (
      await env.call("POST", "/v1/boards", {
        token: owner.token,
        body: { name: "B" },
      })
    ).body;
    await env.call("POST", "/v1/cards", {
      token: owner.token,
      body: {
        boardId: board.id,
        title: "Draft the Q4 plan",
        columnId: board.columns[0].id,
        assigneeIds: [owner.member.id],
      },
    });

    const first = await env.call("POST", "/v1/conversations", {
      token: owner.token,
      body: { message: "What am I on?" },
    });
    expect(first.body.reply).toBe("You're on #1 Draft the Q4 plan.");
    expect(first.body.conversation.mode).toBe("owner");
    expect(toolNames(prompts[0])).toContain("remember");
    expect(JSON.stringify(prompts[1].prompt)).toContain("Draft the Q4 plan");

    const second = await env.call(
      "POST",
      `/v1/conversations/${first.body.conversation.id}/messages`,
      { token: owner.token, body: { message: "Anything else?" } }
    );
    expect(second.body.reply).toBe("Nothing else is in progress.");
    // Turn 2 replays turn 1 verbatim (system prompt, tool call and result included) — never edited.
    expect(prompts[2].prompt.slice(0, prompts[1].prompt.length)).toEqual(
      prompts[1].prompt.map((m: any) => m)
    );

    const thread = (
      await env.call("GET", `/v1/conversations/${first.body.conversation.id}`, {
        token: owner.token,
      })
    ).body;
    expect(thread.messages.map((m: any) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  test("owner mode: 'remember' saves what the assistant learns", async () => {
    const owner = await env.workspace();
    const { model } = scriptedModel([
      {
        tool: "remember",
        input: {
          content: "Owns the payments service",
          kind: "profile",
          private: false,
        },
      },
      { text: "Noted." },
    ]);
    env.ctx.models = { main: model, fast: model };
    await env.call("POST", "/v1/conversations", {
      token: owner.token,
      body: { message: "FYI I own payments now" },
    });
    const memories = (
      await env.call("GET", "/v1/memories?kind=profile", { token: owner.token })
    ).body;
    expect(memories[0]).toMatchObject({
      content: "Owns the payments service",
      source: "agent",
      visibility: "team",
    });
  });

  test("teammate mode: read-only tools, team-visible data only, and a note for the owner", async () => {
    const owner = await env.workspace();
    const sam = await env.teammate(owner.token, "Sam");
    await env.call("POST", "/v1/memories", {
      token: owner.token,
      body: {
        content: "Payments retry logic lives in jobs/retry.ts",
        kind: "fact",
      },
    });
    await env.call("POST", "/v1/memories", {
      token: owner.token,
      body: {
        content: "Interviewing elsewhere",
        kind: "fact",
        visibility: "private",
      },
    });

    const { model, prompts } = scriptedModel([
      { tool: "recall", input: {} },
      {
        tool: "leave_note_for_owner",
        input: { note: "Sam needs the retry design doc", urgent: true },
      },
      {
        text: "It's in jobs/retry.ts. I've also asked Emma for the design doc.",
      },
    ]);
    env.ctx.models = { main: model, fast: model };

    const res = await env.call("POST", "/v1/conversations", {
      token: sam.token,
      body: { to: owner.member.handle, message: "Where's the retry logic?" },
    });
    expect(res.body.conversation.mode).toBe("teammate");
    expect(toolNames(prompts[0])).not.toContain("remember");
    expect(toolNames(prompts[0])).not.toContain("move_card");
    expect(toolNames(prompts[0])).toContain("leave_note_for_owner");

    const recalled = JSON.stringify(prompts[1].prompt);
    expect(recalled).toContain("jobs/retry.ts");
    expect(recalled).not.toContain("Interviewing elsewhere");

    const emmaItems = (
      await env.call("GET", "/v1/attention", { token: owner.token })
    ).body;
    expect(emmaItems[0]).toMatchObject({
      kind: "assistant.note",
      priority: "high",
      fromId: sam.member.id,
    });

    expect(
      (
        await env.call("GET", `/v1/conversations/${res.body.conversation.id}`, {
          token: owner.token,
        })
      ).status
    ).toBe(403);
  });

  test("manual logs are structured in the background: titled, classified, linked, and blockers ping the blocker", async () => {
    const owner = await env.workspace();
    const sam = await env.teammate(owner.token, "Sam");
    const board = (
      await env.call("POST", "/v1/boards", {
        token: owner.token,
        body: { name: "B" },
      })
    ).body;
    await env.call("POST", "/v1/cards", {
      token: owner.token,
      body: { boardId: board.id, title: "Bank webhook retries" },
    });
    const { model } = scriptedModel([
      {
        text: JSON.stringify({
          title: "Waiting on Sam's API keys for bank sandbox",
          kind: "blocker",
          cardNumber: 1,
          blockedOn: [sam.member.handle],
        }),
      },
    ]);
    env.ctx.models = { main: model, fast: model };

    const { logWork } = await import("#activity/worklog");
    const { personalAgentOf, resolveMember } = await import("#members/service");
    const emma = await resolveMember(
      env.ctx,
      await personalAgentOf(env.ctx, owner.member.id),
      owner.member.id
    );
    const { activity, enrichment } = await logWork(env.ctx, emma, {
      text: "can't test the bank sandbox until sam sends the API keys",
      via: "voice",
    });
    await enrichment;

    const [entry] = (
      await env.call(
        "GET",
        `/v1/activities?actor=${owner.member.id}&kind=log.blocker`,
        { token: owner.token }
      )
    ).body;
    expect(entry).toMatchObject({
      id: activity.id,
      title: "Waiting on Sam's API keys for bank sandbox",
      data: { via: "voice", structured: true },
    });
    expect(entry.cardId).not.toBeNull();
    const samItems = (
      await env.call("GET", "/v1/attention", { token: sam.token })
    ).body;
    expect(samItems[0]).toMatchObject({ kind: "blocking", priority: "high" });
  });

  test("streams answers in the AI SDK UI-message protocol (useChat) and keeps the transcript server-side", async () => {
    const owner = await env.workspace();
    const { model } = scriptedModel([
      { tool: "my_attention", input: {} },
      { text: "Nothing needs you right now." },
    ]);
    env.ctx.models = { main: model, fast: model };
    const { body: opened } = await env.call("POST", "/v1/conversations", {
      token: owner.token,
      body: {},
    });
    expect(opened.reply).toBeNull();

    const res = await env.app.request(
      `/v1/conversations/${opened.conversation.id}/chat`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${owner.token}`,
        },
        body: JSON.stringify({
          message: {
            id: "u1",
            role: "user",
            parts: [{ type: "text", text: "Anything for me?" }],
          },
        }),
      }
    );
    expect(res.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
    const sse = await res.text();
    expect(sse).toContain('"type":"tool-input-available"');
    expect(sse).toContain("Nothing needs you right now.");

    let thread: any;
    for (let i = 0; i < 20; i += 1) {
      thread = (
        await env.call("GET", `/v1/conversations/${opened.conversation.id}`, {
          token: owner.token,
        })
      ).body;
      if (thread.messages.length >= 2) {
        break;
      }
      await Bun.sleep(50);
    }
    expect(thread.messages.map((m: any) => m.text)).toEqual([
      expect.stringContaining("Anything for me?"),
      "Nothing needs you right now.",
    ]);
  });
});
