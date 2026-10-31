import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomInt } from "node:crypto";

import { sql } from "drizzle-orm";

import { hmacHex } from "#lib/crypto";

import { routedFetch, scriptedModel, testEnv } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});
beforeEach(() => {
  env.reset();
});

const SETUP = { "x-setup-secret": "test-secret" };
const API = "https://slack.com/api";
const recent = () => (Date.now() / 1000 - 600).toFixed(6);

function slack(
  team: string,
  extra: [string, (r: any) => unknown][] = [],
  email = "nobody@example.com"
) {
  const started = recent();
  const replied = (Number(started) + 60).toFixed(6);
  return routedFetch([
    ...extra,
    [
      `POST ${API}/oauth.v2.access`,
      (r) =>
        r.body.client_secret === "client-secret" && r.body.code === "ok-code"
          ? {
              ok: true,
              access_token: "xoxb-installed",
              bot_user_id: "UBOT",
              team: { id: team, name: "Acme" },
              is_enterprise_install: false,
            }
          : { ok: false, error: "invalid_code" },
    ],
    [
      `GET ${API}/auth.test`,
      () => ({ ok: true, url: "https://acme.slack.com/" }),
    ],
    [
      `GET ${API}/conversations.list`,
      () => ({
        ok: true,
        channels: [
          { id: "C0STANDUP", name: "standup" },
          { id: "C0RANDOM", name: "random" },
        ],
        response_metadata: { next_cursor: "" },
      }),
    ],
    [
      `GET ${API}/conversations.info`,
      () => ({ ok: true, channel: { is_private: false } }),
    ],
    [
      `GET ${API}/conversations.history`,
      () => ({
        ok: true,
        has_more: false,
        messages: [
          {
            type: "message",
            user: "U0SAM",
            text: "Shipped the onboarding flow to staging",
            ts: started,
            reply_count: 1,
            latest_reply: replied,
          },
          { type: "message", user: "U0SAM", text: "ok", ts: recent() },
        ],
      }),
    ],
    [
      `GET ${API}/conversations.replies`,
      () => ({
        ok: true,
        messages: [
          { type: "message", user: "U0SAM", text: "parent", ts: started },
          {
            type: "message",
            user: "U0SAM",
            text: "Rolled the migration back for now, it locked the table",
            ts: replied,
            thread_ts: started,
          },
        ],
      }),
    ],
    [
      `GET ${API}/users.info`,
      () => ({
        ok: true,
        user: {
          name: "sam",
          real_name: "Sam Smith",
          profile: { email: email.toUpperCase(), display_name: "sam" },
        },
      }),
    ],
  ]);
}

async function installed() {
  const owner = await env.workspace();
  // Unique, so signing in as this address in another test claims no workspace from here.
  const email = `sam-${randomInt(1_000_000, 9_000_000)}@example.com`;
  const sam = await env.teammate(owner.token, "Sam", { email });
  const registered = await env.call("PUT", "/v1/apps/slack", {
    token: owner.token,
    headers: SETUP,
    body: {
      credentials: {
        clientId: "1.2",
        clientSecret: "client-secret",
        signingSecret: "app-signing-secret",
      },
      replace: true,
    },
  });
  expect(registered.status).toBe(200);
  const team = `T${randomInt(1_000_000, 9_000_000)}`;
  const fetch = slack(team, [], email);
  env.ctx.fetch = fetch;
  const link = await env.call("POST", "/v1/apps/slack/install", {
    token: owner.token,
  });
  const url = new URL(link.body.url);
  expect(url.origin + url.pathname).toBe(
    "https://slack.com/oauth/v2/authorize"
  );
  expect(url.searchParams.get("scope")).toContain("users:read.email");
  expect(url.searchParams.get("redirect_uri")).toBe(
    "http://worklog.test/oauth/slack/callback"
  );
  const state = url.searchParams.get("state") ?? "";
  const res = await env.app.request(
    `/oauth/slack/callback?code=ok-code&state=${encodeURIComponent(state)}`
  );
  expect(res.status).toBe(200);
  await env.drain();
  const [conn] = (
    await env.call("GET", "/v1/connections", { token: owner.token })
  ).body;
  const post = async (
    channel: string,
    raw: string,
    headers: Record<string, string> = {}
  ) => {
    const ts = Math.floor(Date.now() / 1000);
    const r = await env.app.request(`/hooks/apps/slack/${channel}`, {
      method: "POST",
      headers: {
        "content-type":
          channel === "commands"
            ? "application/x-www-form-urlencoded"
            : "application/json",
        "x-slack-request-timestamp": String(ts),
        "x-slack-signature": `v0=${hmacHex("app-signing-secret", `v0:${ts}:${raw}`)}`,
        ...headers,
      },
      body: raw,
    });
    await env.drain();
    return r;
  };
  const event = (id: string, e: object) =>
    JSON.stringify({
      type: "event_callback",
      team_id: team,
      event_id: id,
      event: e,
    });
  return { owner, sam, conn, team, fetch, post, event };
}

describe("Slack app", () => {
  test("installing connects the team, with links back to messages", async () => {
    const { conn } = await installed();
    expect(conn).toMatchObject({
      provider: "slack",
      name: "Slack · Acme",
      status: "active",
      settings: { teamUrl: "https://acme.slack.com", botUserId: "UBOT" },
    });
  });

  test("choosing channels from the list reads their recent history and links people by email", async () => {
    const { owner, sam, conn, team } = await installed();
    const sources = (
      await env.call("GET", `/v1/connections/${conn.id}/sources`, {
        token: owner.token,
      })
    ).body;
    expect(sources.map((s: any) => s.name)).toEqual(["random", "standup"]);
    const updated = await env.call(
      "PUT",
      `/v1/connections/${conn.id}/sources`,
      {
        token: owner.token,
        body: { ids: ["C0STANDUP"] },
      }
    );
    expect(updated.body.settings).toMatchObject({
      channels: ["C0STANDUP"],
      channelNames: { C0STANDUP: "standup" },
    });
    await env.drain();
    const messages = (
      await env.call("GET", "/v1/activities?source=slack", {
        token: owner.token,
      })
    ).body;
    expect(
      messages
        .map((m: any) => m.title)
        .toSorted((a: string, b: string) => a.localeCompare(b))
    ).toEqual([
      "Posted in #standup: Shipped the onboarding flow to staging",
      "Replied 1 time in a #standup thread",
    ]);
    expect(messages.every((m: any) => m.actorId === sam.member.id)).toBe(true);
    // Counted per message, not per page of history: "ok" is the one dropped.
    const health = (
      await env.call("GET", `/v1/connections/${conn.id}/health`, {
        token: owner.token,
      })
    ).body;
    expect(health.signalRate).toBeGreaterThan(0);
    expect(health.signalRate).toBeLessThan(1);
    // Later, the thread gets a reply. The thread's first message is older than where the next
    // run reads from, but the run remembers the thread and asks for it.
    const remembered = await env.ctx.db.execute<{ threads: string[] }>(
      sql`select cursor->'threads' as threads from connection_cursors where connection_id = ${conn.id} and stream = 'channel:C0STANDUP'`
    );
    const [thread = ""] = remembered.rows[0]?.threads ?? [];
    expect(thread).not.toBe("");
    env.ctx.fetch = slack(team, [
      [
        `GET ${API}/conversations.history`,
        () => ({ ok: true, has_more: false, messages: [] }),
      ],
      [
        `GET ${API}/conversations.replies`,
        () => ({
          ok: true,
          messages: [
            { type: "message", user: "U0SAM", text: "parent", ts: thread },
            {
              type: "message",
              user: "U0SAM",
              text: "And the backfill job is done for March too",
              ts: (Number(thread) + 7200).toFixed(6),
              thread_ts: thread,
            },
          ],
        }),
      ],
    ]);
    await env.call("POST", `/v1/connections/${conn.id}/sync`, {
      token: owner.token,
    });
    await env.drain();
    const replies = (
      await env.call("GET", "/v1/activities?source=slack", {
        token: owner.token,
      })
    ).body.find((a: any) => a.title.startsWith("Replied"));
    expect(replies.title).toBe("Replied 2 times in a #standup thread");

    const bad = await env.call("PUT", `/v1/connections/${conn.id}/sources`, {
      token: owner.token,
      body: { ids: ["C0SECRET"] },
    });
    expect(bad.status).toBe(400);
  });

  test("a question asked by mentioning the bot tells the assistant it came through Slack", async () => {
    const { owner, conn, post, event } = await installed();
    await env.call("PUT", `/v1/connections/${conn.id}/sources`, {
      token: owner.token,
      body: { ids: ["C0STANDUP"] },
    });
    await env.drain();
    await env.call("POST", "/v1/members/me/identities", {
      token: owner.token,
      body: { provider: "slack", externalId: "U0EMMA" },
    });
    const { model, prompts } = scriptedModel([{ text: "You're on #1." }]);
    env.ctx.models = { main: model, fast: model };
    await post(
      "events",
      event("Ev-question", {
        type: "app_mention",
        user: "U0EMMA",
        text: "<@UBOT> what am I on?",
        channel: "C0STANDUP",
        ts: "1793000000.000200",
      })
    );
    await env.drain();
    const asked = JSON.stringify(prompts[0].prompt.at(-1));
    expect(asked).toContain("via Slack");
    expect(asked).toContain("what am I on?");
  });

  test("events route by team; a mention is answered once, however often Slack retries it", async () => {
    const { owner, conn, fetch, post, event } = await installed();
    await env.call("PUT", `/v1/connections/${conn.id}/sources`, {
      token: owner.token,
      body: { ids: ["C0STANDUP"] },
    });
    await env.drain();
    await env.call("POST", "/v1/members/me/identities", {
      token: owner.token,
      body: { provider: "slack", externalId: "U0EMMA" },
    });
    const mention = event("Ev-mention", {
      type: "app_mention",
      user: "U0EMMA",
      text: "<@UBOT> log Paired with Sam on the retry bug",
      channel: "C0STANDUP",
      ts: "1793000000.000100",
    });
    expect((await post("events", mention)).status).toBe(200);
    await post("events", mention, { "x-slack-retry-num": "1" });
    // The same message as a channel message, which Slack sends as well: not a post to record.
    await post(
      "events",
      event("Ev-mention-message", {
        type: "message",
        user: "U0EMMA",
        text: "<@UBOT> log Paired with Sam on the retry bug",
        channel: "C0STANDUP",
        channel_type: "channel",
        ts: "1793000000.000100",
      })
    );
    // Only the person who asked sees the answer: it can hold what's private to them.
    expect(
      fetch.calls.filter((c) => c.url === `${API}/chat.postMessage`)
    ).toHaveLength(0);
    const replies = fetch.calls.filter(
      (c) => c.url === `${API}/chat.postEphemeral`
    );
    expect(replies).toHaveLength(1);
    expect(replies[0]?.body).toMatchObject({
      channel: "C0STANDUP",
      user: "U0EMMA",
    });
    // Asked at the top of the channel: Slack wouldn't show a private reply in a thread not there.
    expect(replies[0]?.body).not.toHaveProperty("thread_ts");
    expect(replies[0]?.headers.get("authorization")).toBe(
      "Bearer xoxb-installed"
    );
    const [logged] = (
      await env.call("GET", "/v1/activities?kind=log.entry", {
        token: owner.token,
      })
    ).body;
    expect(logged.title).toContain("Paired with Sam");
    const posted = (
      await env.call("GET", "/v1/activities?kind=message.posted", {
        token: owner.token,
      })
    ).body;
    expect(posted.filter((a: any) => a.title.includes("Paired"))).toEqual([]);
  });

  test("a paused connection still answers commands; a revoked one says so in Slack's terms", async () => {
    const { owner, conn, team, post, event } = await installed();
    await env.call("PATCH", `/v1/connections/${conn.id}`, {
      token: owner.token,
      body: { status: "paused" },
    });
    const form = new URLSearchParams({
      command: "/worklog",
      text: "help",
      user_id: "U0NOBODY",
      team_id: team,
    }).toString();
    const paused = await post("commands", form);
    const answer = (await paused.json()) as { text: string };
    expect(answer.text).toContain("Worklog commands");
    await post("events", event("Ev-gone-2", { type: "app_uninstalled" }));
    const revoked = await post("commands", form);
    expect(await revoked.json()).toMatchObject({
      response_type: "ephemeral",
      text: expect.stringContaining("revoked"),
    });
  });

  test("slash commands route by team", async () => {
    const { team, post } = await installed();
    const form = new URLSearchParams({
      command: "/worklog",
      text: "help",
      user_id: "U0NOBODY",
      team_id: team,
    }).toString();
    const res = await post("commands", form);
    expect(await res.json()).toMatchObject({ response_type: "ephemeral" });
  });

  test("uninstalling the app revokes the connection and drops its token", async () => {
    const { owner, conn, post, event } = await installed();
    await post("events", event("Ev-gone", { type: "app_uninstalled" }));
    const [after] = (
      await env.call("GET", "/v1/connections", { token: owner.token })
    ).body;
    expect(after).toMatchObject({ id: conn.id, status: "revoked" });
    const sources = await env.call(
      "GET",
      `/v1/connections/${conn.id}/sources`,
      {
        token: owner.token,
      }
    );
    expect(sources.status).toBe(400);
  });

  test("Slack retrying an uninstall after the team came back doesn't undo the reinstall", async () => {
    const { owner, conn, team, post, event } = await installed();
    const bye = event("Ev-retried", { type: "app_uninstalled" });
    await post("events", bye);
    env.ctx.fetch = slack(team);
    const link = await env.call("POST", "/v1/apps/slack/install", {
      token: owner.token,
    });
    const state = new URL(link.body.url).searchParams.get("state") ?? "";
    await env.app.request(
      `/oauth/slack/callback?code=ok-code&state=${encodeURIComponent(state)}`
    );
    const res = await post("events", bye, { "x-slack-retry-num": "1" });
    expect(res.status).toBe(200);
    const [after] = (
      await env.call("GET", "/v1/connections", { token: owner.token })
    ).body;
    expect(after).toMatchObject({ id: conn.id, status: "active" });
  });

  test("a refused code connects nothing", async () => {
    const owner = await env.workspace();
    env.ctx.fetch = slack("T0NEVER");
    const link = await env.call("POST", "/v1/apps/slack/install", {
      token: owner.token,
    });
    const state = new URL(link.body.url).searchParams.get("state") ?? "";
    const res = await env.app.request(
      `/oauth/slack/callback?code=stolen&state=${encodeURIComponent(state)}`
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("invalid_code");
    expect(
      (await env.call("GET", "/v1/connections", { token: owner.token })).body
    ).toHaveLength(0);
  });

  test("a team uninstalled from one workspace can be connected to another", async () => {
    const { owner, team, post, event } = await installed();
    await post("events", event("Ev-bye", { type: "app_uninstalled" }));
    const other = await env.workspace("Other Co");
    env.ctx.fetch = slack(team);
    const link = await env.call("POST", "/v1/apps/slack/install", {
      token: other.token,
    });
    const state = new URL(link.body.url).searchParams.get("state") ?? "";
    const res = await env.app.request(
      `/oauth/slack/callback?code=ok-code&state=${encodeURIComponent(state)}`
    );
    expect(res.status).toBe(200);
    const [moved] = (
      await env.call("GET", "/v1/connections", { token: other.token })
    ).body;
    expect(moved).toMatchObject({ externalId: team, status: "active" });
    const [left] = (
      await env.call("GET", "/v1/connections", { token: owner.token })
    ).body;
    expect(left).toMatchObject({ status: "revoked", externalId: null });
  });

  test("another team with the same name gets a connection of its own", async () => {
    const { owner, conn, post, event } = await installed();
    await post("events", event("Ev-bye-3", { type: "app_uninstalled" }));
    const other = `T${Math.floor(Math.random() * 9_000_000) + 1_000_000}`;
    env.ctx.fetch = slack(other);
    const link = await env.call("POST", "/v1/apps/slack/install", {
      token: owner.token,
    });
    const state = new URL(link.body.url).searchParams.get("state") ?? "";
    await env.app.request(
      `/oauth/slack/callback?code=ok-code&state=${encodeURIComponent(state)}`
    );
    const conns = (
      await env.call("GET", "/v1/connections", { token: owner.token })
    ).body;
    expect(conns).toHaveLength(2);
    expect(conns.find((c: any) => c.id === conn.id).status).toBe("revoked");
    expect(conns.find((c: any) => c.id !== conn.id)).toMatchObject({
      externalId: other,
      status: "active",
    });
  });
});
