import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { routedFetch, scriptedModel, testEnv } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});
beforeEach(() => {
  env.reset();
});

const AUDIO = new Uint8Array([26, 69, 223, 163, 1, 2, 3, 4]);

async function upload(
  token: string,
  opts: {
    type?: string;
    body?: Uint8Array;
    headers?: Record<string, string>;
  } = {}
) {
  return await env.app.request("/v1/transcriptions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": opts.type ?? "audio/webm;codecs=opus",
      ...opts.headers,
    },
    body: opts.body ?? AUDIO,
  });
}

function provider(text: string) {
  return routedFetch([
    [
      "POST https://openrouter.ai/api/v1/audio/transcriptions",
      () => ({ text, usage: { seconds: 3, cost: 0.00001 } }),
    ],
  ]);
}

async function withCard() {
  const owner = await env.workspace("Acme", { name: "Kwame Mensah" });
  const board = (
    await env.call("POST", "/v1/boards", {
      token: owner.token,
      body: { name: "Platform" },
    })
  ).body;
  await env.call("POST", "/v1/cards", {
    token: owner.token,
    body: {
      boardId: board.id,
      title: "Move ingest to Graphile Worker",
      columnId: board.columns[0].id,
    },
  });
  return owner;
}

describe("transcription", () => {
  test("hears the recording, then spells the workspace's names right", async () => {
    const owner = await withCard();
    const fetch = provider("ask kwame men sa about the graph isle worker card");
    env.ctx.fetch = fetch;
    const { model, prompts } = scriptedModel([
      {
        text: JSON.stringify({
          text: "ask Kwame Mensah about the Graphile Worker card",
        }),
      },
    ]);
    env.ctx.models = { main: model, fast: model };

    const res = await upload(owner.token);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      text: "ask Kwame Mensah about the Graphile Worker card",
    });
    const sent = fetch.calls[0]!.body;
    expect(sent.model).toBe("openai/whisper-large-v3-turbo");
    expect(sent.input_audio).toEqual({
      data: Buffer.from(AUDIO).toString("base64"),
      format: "webm",
    });
    expect(sent.provider.data_collection).toBe("deny");
    expect(sent.provider.options.groq.prompt).toContain("Kwame Mensah");
    const instructions = JSON.stringify(prompts[0].prompt);
    expect(instructions).toContain("Kwame Mensah");
    expect(instructions).toContain("Platform");
    expect(instructions).toContain("Move ingest to Graphile Worker");
  });

  test("keeps what it heard when the fix rewrites instead of fixing", async () => {
    const owner = await withCard();
    env.ctx.fetch = provider("what is blocked");
    const { model } = scriptedModel([
      {
        text: JSON.stringify({
          text: "Nothing is blocked right now: the ingest card is moving and the rest is on track.",
        }),
      },
    ]);
    env.ctx.models = { main: model, fast: model };

    const res = await upload(owner.token);

    expect(await res.json()).toEqual({ text: "what is blocked" });
  });

  test("silence costs no second pass", async () => {
    const owner = await withCard();
    env.ctx.fetch = provider("  ");
    const { model, prompts } = scriptedModel([{ text: "{}" }]);
    env.ctx.models = { main: model, fast: model };

    const res = await upload(owner.token);

    expect(await res.json()).toEqual({ text: "" });
    expect(prompts).toHaveLength(0);
  });

  test("a provider failure is a 502 the client can fall back from", async () => {
    const owner = await withCard();
    env.ctx.fetch = routedFetch([
      [
        "POST https://openrouter.ai/api/v1/audio/transcriptions",
        () => new Response("upstream down", { status: 500 }),
      ],
    ]);
    const { model } = scriptedModel([{ text: "{}" }]);
    env.ctx.models = { main: model, fast: model };

    const res = await upload(owner.token);

    expect(res.status).toBe(502);
  });

  test("refuses what it can't or won't transcribe", async () => {
    const owner = await env.workspace();
    expect((await upload(owner.token)).status).toBe(503);

    const { model } = scriptedModel([{ text: "{}" }]);
    env.ctx.models = { main: model, fast: model };
    expect((await upload(owner.token, { type: "text/plain" })).status).toBe(
      400
    );
    expect((await upload(owner.token, { body: new Uint8Array() })).status).toBe(
      400
    );
    expect(
      (
        await upload(owner.token, {
          headers: { "content-length": String(9 * 1024 * 1024) },
        })
      ).status
    ).toBe(413);
  });

  test("me says whether the server has a model", async () => {
    const owner = await env.workspace();
    expect(
      (await env.call("GET", "/v1/me", { token: owner.token })).body.ai
    ).toBe(false);
    const { model } = scriptedModel([{ text: "" }]);
    env.ctx.models = { main: model, fast: model };
    expect(
      (await env.call("GET", "/v1/me", { token: owner.token })).body.ai
    ).toBe(true);
  });
});
