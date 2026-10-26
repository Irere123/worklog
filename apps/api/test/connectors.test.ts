import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";

import { hmacHex } from "../src/lib/crypto";
import { testEnv } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});
beforeEach(() => {
  env.reset();
});

async function connect(
  token: string,
  provider: string,
  secrets: Record<string, string>,
  settings: Record<string, unknown> = {}
) {
  const res = await env.call("POST", "/v1/connections", {
    token,
    body: { provider, secrets, settings },
  });
  expect(res.status).toBe(201);
  return res.body;
}

async function github() {
  const owner = await env.workspace();
  const sam = await env.teammate(owner.token, "Sam");
  const board = (
    await env.call("POST", "/v1/boards", {
      token: owner.token,
      body: { name: "Eng" },
    })
  ).body;
  const conn = await connect(
    owner.token,
    "github",
    { webhookSecret: "s3cret" },
    { boardId: board.id }
  );
  await env.call("POST", "/v1/members/me/identities", {
    token: owner.token,
    body: { provider: "github", externalId: "emma-gh" },
  });
  await env.call("POST", `/v1/members/${sam.member.id}/identities`, {
    token: sam.token,
    body: { provider: "github", externalId: "Sam-GH" },
  });
  let n = 0;
  const send = async (
    event: string,
    payload: unknown,
    opts: { secret?: string; delivery?: string } = {}
  ) => {
    n += 1;
    const raw = JSON.stringify(payload);
    const res = await env.app.request(
      new URL(conn.webhookUrls.webhook).pathname,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": event,
          "x-github-delivery": opts.delivery ?? `d-${n}`,
          "x-hub-signature-256": `sha256=${hmacHex(opts.secret ?? "s3cret", raw)}`,
        },
        body: raw,
      }
    );
    await env.drain();
    return res;
  };
  return { owner, sam, board, conn, send };
}

describe("GitHub", () => {
  const repo = { full_name: "acme/api" };
  const pr = {
    number: 7,
    title: "Retry payments",
    html_url: "https://github.com/acme/api/pull/7",
    body: "Fixes #3",
    user: { login: "emma-gh" },
  };

  test("rejects bad signatures", async () => {
    const { send } = await github();
    const res = await send("ping", { repository: repo }, { secret: "wrong" });
    expect(res.status).toBe(401);
  });

  test("issues become cards in Maybe?, closing the issue closes the card", async () => {
    const { owner, send } = await github();
    const issue = {
      number: 3,
      title: "Payments fail on retry",
      html_url: "https://github.com/acme/api/issues/3",
      user: { login: "emma-gh" },
    };
    await send("issues", {
      action: "opened",
      issue,
      repository: repo,
      sender: { login: "emma-gh" },
    });
    let cards = (await env.call("GET", "/v1/cards", { token: owner.token }))
      .body;
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      title: "Payments fail on retry",
      stage: "triage",
      source: "github",
    });

    await send("issues", {
      action: "closed",
      issue,
      repository: repo,
      sender: { login: "emma-gh" },
    });
    cards = (await env.call("GET", "/v1/cards", { token: owner.token })).body;
    expect(cards[0].stage).toBe("done");
  });

  test("review requests reach the reviewer; submitting the review resolves it and tells the author", async () => {
    const { owner, sam, send } = await github();
    await send("issues", {
      action: "opened",
      issue: {
        number: 3,
        title: "Bug",
        html_url: "x",
        user: { login: "emma-gh" },
      },
      repository: repo,
      sender: { login: "emma-gh" },
    });
    await send("pull_request", {
      action: "review_requested",
      pull_request: pr,
      requested_reviewer: { login: "sam-gh" },
      repository: repo,
      sender: { login: "emma-gh" },
    });

    let samItems = (
      await env.call("GET", "/v1/attention", { token: sam.token })
    ).body;
    expect(samItems[0]).toMatchObject({
      kind: "review.requested",
      priority: "high",
    });
    // Linked through "Fixes #3"
    expect(samItems[0].cardId).not.toBeNull();

    await send("pull_request_review", {
      action: "submitted",
      review: {
        id: 99,
        state: "changes_requested",
        body: "Needs a backoff cap",
        html_url: "https://github.com/acme/api/pull/7#r",
        user: { login: "sam-gh" },
      },
      pull_request: pr,
      repository: repo,
      sender: { login: "sam-gh" },
    });
    samItems = (await env.call("GET", "/v1/attention", { token: sam.token }))
      .body;
    expect(
      samItems.find((a: any) => a.kind === "review.requested")
    ).toBeUndefined();
    const emmaItems = (
      await env.call("GET", "/v1/attention", { token: owner.token })
    ).body;
    expect(emmaItems[0]).toMatchObject({ kind: "pr.review", priority: "high" });
  });

  test("redelivered webhooks are processed once", async () => {
    const { owner, send } = await github();
    const push = {
      ref: "refs/heads/main",
      after: "abc",
      commits: [{ id: "1", message: "Fix retry" }],
      repository: repo,
      sender: { login: "emma-gh" },
    };
    await send("push", push, { delivery: "same" });
    await send("push", push, { delivery: "same" });
    const pushes = (
      await env.call("GET", "/v1/activities?kind=code.pushed", {
        token: owner.token,
      })
    ).body;
    expect(pushes).toHaveLength(1);
    expect(pushes[0].actorId).toBe(owner.member.id);
  });
});

/** Slack's signature headers for a raw body. */
function slackHeaders(raw: string, ts = Math.floor(Date.now() / 1000)) {
  return {
    "x-slack-request-timestamp": String(ts),
    "x-slack-signature": `v0=${hmacHex("slack-secret", `v0:${ts}:${raw}`)}`,
  };
}

async function slack() {
  const owner = await env.workspace();
  const conn = await connect(
    owner.token,
    "slack",
    { signingSecret: "slack-secret", botToken: "xoxb-test" },
    { channels: ["C0STANDUP"] }
  );
  await env.call("POST", "/v1/members/me/identities", {
    token: owner.token,
    body: { provider: "slack", externalId: "U0EMMA" },
  });
  const post = async (path: string, raw: string, contentType: string) => {
    const res = await env.app.request(new URL(path).pathname, {
      method: "POST",
      headers: { "content-type": contentType, ...slackHeaders(raw) },
      body: raw,
    });
    await env.drain();
    return res;
  };
  return { owner, conn, post };
}

/** A /log slash command, form-encoded like Slack sends it. */
function slashLog(user: string, text: string) {
  return new URLSearchParams({
    command: "/log",
    text,
    user_id: user,
    response_url: "https://hooks.slack.test/r",
  }).toString();
}

/** A message event callback in a channel. */
function slackMessage(id: string, text: string, channel: string) {
  return JSON.stringify({
    type: "event_callback",
    event_id: id,
    event: {
      type: "message",
      user: "U0EMMA",
      text,
      channel,
      channel_type: "channel",
      ts: `${Date.now() / 1000}`,
    },
  });
}

describe("Slack", () => {
  test("answers Slack's URL verification challenge", async () => {
    const { conn, post } = await slack();
    const res = await post(
      conn.webhookUrls.events,
      JSON.stringify({ type: "url_verification", challenge: "abc" }),
      "application/json"
    );
    expect(await res.json()).toEqual({ challenge: "abc" });
  });

  test("rejects stale timestamps (replay protection)", async () => {
    const { conn } = await slack();
    const raw = JSON.stringify({ type: "url_verification", challenge: "abc" });
    const res = await env.app.request(
      new URL(conn.webhookUrls.events).pathname,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...slackHeaders(raw, Math.floor(Date.now() / 1000) - 3600),
        },
        body: raw,
      }
    );
    expect(res.status).toBe(401);
  });

  test("/log records work; unknown users are told how to link", async () => {
    const { owner, conn, post } = await slack();
    const ok = await post(
      conn.webhookUrls.commands,
      slashLog("U0EMMA", "Call with the bank about webhook retries"),
      "application/x-www-form-urlencoded"
    );
    expect(((await ok.json()) as any).text).toContain("Logged");
    const logs = (
      await env.call("GET", "/v1/activities?kind=log.entry", {
        token: owner.token,
      })
    ).body;
    expect(logs[0]).toMatchObject({
      title: "Call with the bank about webhook retries",
      data: { via: "slack" },
    });

    const stranger = await post(
      conn.webhookUrls.commands,
      slashLog("U0WHO", "hi"),
      "application/x-www-form-urlencoded"
    );
    expect(((await stranger.json()) as any).text).toContain("U0WHO");
  });

  test("standup-channel messages become activity; mentions become attention", async () => {
    const { owner, conn, post } = await slack();
    const sam = await env.teammate(owner.token, "Sam");
    await env.call("POST", `/v1/members/${sam.member.id}/identities`, {
      token: sam.token,
      body: { provider: "slack", externalId: "U0SAM" },
    });
    await post(
      conn.webhookUrls.events,
      slackMessage("E1", "Shipped the retry fix", "C0STANDUP"),
      "application/json"
    );
    await post(
      conn.webhookUrls.events,
      slackMessage("E2", "<@U0SAM> can you look at the dashboard?", "C0RANDOM"),
      "application/json"
    );

    const msgs = (
      await env.call("GET", "/v1/activities?source=slack", {
        token: owner.token,
      })
    ).body;
    // C0RANDOM isn't an opted-in channel
    expect(msgs).toHaveLength(1);
    const samItems = (
      await env.call("GET", "/v1/attention", { token: sam.token })
    ).body;
    expect(samItems[0]).toMatchObject({
      kind: "mention",
      title: "Emma mentioned you in #C0RANDOM",
      priority: "normal",
    });
  });
});

describe("Discord", () => {
  test("verifies Ed25519 signatures, answers PING, and runs /log", async () => {
    const owner = await env.workspace();
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const rawPub = publicKey
      .export({ format: "der", type: "spki" })
      .subarray(-32)
      .toString("hex");
    const conn = await connect(owner.token, "discord", {
      publicKey: rawPub,
      applicationId: "app1",
      botToken: "bot",
    });
    await env.call("POST", "/v1/members/me/identities", {
      token: owner.token,
      body: { provider: "discord", externalId: "D_EMMA" },
    });

    const send = async (payload: unknown, tamper = false) => {
      const raw = JSON.stringify(payload);
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = sign(null, Buffer.from(ts + raw), privateKey).toString("hex");
      return await env.app.request(
        new URL(conn.webhookUrls.interactions).pathname,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-signature-ed25519": tamper
              ? (sig.startsWith("0") ? "1" : "0") + sig.slice(1)
              : sig,
            "x-signature-timestamp": ts,
          },
          body: raw,
        }
      );
    };

    expect((await send({ type: 1 }, true)).status).toBe(401);
    expect(await (await send({ type: 1 })).json()).toEqual({ type: 1 });

    const res = await send({
      type: 2,
      id: "i1",
      token: "tok",
      application_id: "app1",
      member: { user: { id: "D_EMMA" } },
      data: {
        name: "log",
        options: [
          { name: "text", value: "Reviewed the onboarding flow with design" },
        ],
      },
    });
    expect(((await res.json()) as any).data.content).toContain("Logged");
  });
});
