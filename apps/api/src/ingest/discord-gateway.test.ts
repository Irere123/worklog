import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomInt } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { sql } from "drizzle-orm";

import { startStreams } from "#ingest/streams";
import { routedFetch, testEnv } from "#test/harness";
import type { TestEnv } from "#test/harness";

let env: TestEnv;
const identified: { token: string; intents: number }[] = [];
const resumed: { token: string; session_id: string; seq: number }[] = [];
let script: object[] = [];
// Sent after a Resume; when set, the socket closes right after the scripted dispatches.
let afterResume: object[] = [];
let dropAfterScript = false;

// Discord's Gateway, as far as Worklog uses it: Hello, then on Identify whatever the test scripts.
const gateway = Bun.serve({
  port: 0,
  fetch(req, server) {
    return server.upgrade(req)
      ? undefined
      : new Response("websocket only", { status: 400 });
  },
  websocket: {
    open(ws) {
      ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 45_000 } }));
    },
    message(ws, raw) {
      const frame = JSON.parse(String(raw)) as { op: number; d: any };
      if (frame.op === 2) {
        identified.push(frame.d);
        for (const dispatch of script) {
          ws.send(JSON.stringify(dispatch));
        }
        if (dropAfterScript) {
          ws.close(4000, "gone for a moment");
        }
      } else if (frame.op === 6) {
        resumed.push(frame.d);
        for (const dispatch of afterResume) {
          ws.send(JSON.stringify(dispatch));
        }
      } else if (frame.op === 1) {
        ws.send(JSON.stringify({ op: 11 }));
      }
    },
  },
});

beforeAll(async () => {
  env = await testEnv();
});
afterAll(() => {
  void gateway.stop(true);
});

const SETUP = { "x-setup-secret": "test-secret" };

describe("Discord Gateway", () => {
  test("messages from chosen channels become activity, mentions reach people, removal revokes", async () => {
    const owner = await env.workspace();
    const sam = await env.teammate(owner.token, "Sam");
    await env.call("PUT", "/v1/apps/discord", {
      token: owner.token,
      headers: SETUP,
      body: {
        appId: "app-1",
        credentials: {
          clientId: "app-1",
          clientSecret: "discord-secret",
          publicKey: "00".repeat(32),
          botToken: "bot-token",
        },
        replace: true,
      },
    });
    const guild = String(randomInt(1_000_000, 900_000_000));
    env.ctx.fetch = routedFetch([
      [
        "POST https://discord.com/api/v10/oauth2/token",
        () => ({ access_token: "a", guild: { id: guild, name: "Acme" } }),
      ],
      [
        `GET https://discord.com/api/v10/guilds/${guild}/channels`,
        () => [
          { id: "CH1", name: "standup", type: 0 },
          // Hidden from @everyone (the role with the server's id).
          {
            id: "CH2",
            name: "leads",
            type: 0,
            permission_overwrites: [
              { id: guild, type: 0, allow: "0", deny: "1024" },
            ],
          },
          { id: "VC1", name: "voice", type: 2 },
        ],
      ],
      [
        "GET https://discord.com/api/v10/gateway/bot",
        () => ({ url: `ws://localhost:${gateway.port}` }),
      ],
    ]);
    const link = await env.call("POST", "/v1/apps/discord/install", {
      token: owner.token,
    });
    const state = new URL(link.body.url).searchParams.get("state") ?? "";
    await env.app.request(
      `/oauth/discord/callback?code=c&state=${encodeURIComponent(state)}`
    );
    const [conn] = (
      await env.call("GET", "/v1/connections", { token: owner.token })
    ).body;
    const sources = (
      await env.call("GET", `/v1/connections/${conn.id}/sources`, {
        token: owner.token,
      })
    ).body;
    expect(sources.map((s: any) => s.name)).toEqual(["leads", "standup"]);
    await env.call("PUT", `/v1/connections/${conn.id}/sources`, {
      token: owner.token,
      body: { ids: ["CH1", "CH2"] },
    });
    await env.call("POST", "/v1/members/me/identities", {
      token: owner.token,
      body: { provider: "discord", externalId: "1001" },
    });
    await env.call("POST", `/v1/members/${sam.member.id}/identities`, {
      token: sam.token,
      body: { provider: "discord", externalId: "1002" },
    });

    const message = {
      id: "m1",
      channel_id: "CH1",
      guild_id: guild,
      author: { id: "1001", username: "emma" },
      content:
        "Shipped the retry queue to production, <@1002> can you watch the alerts?",
      timestamp: new Date().toISOString(),
      mentions: [{ id: "1002", username: "sam" }],
    };
    script = [
      { op: 0, t: "READY", s: 1, d: { session_id: "sess-1" } },
      { op: 0, t: "MESSAGE_CREATE", s: 2, d: message },
      // Sent again, as after a resume.
      { op: 0, t: "MESSAGE_CREATE", s: 3, d: message },
      {
        op: 0,
        t: "MESSAGE_CREATE",
        s: 4,
        d: {
          ...message,
          id: "m2",
          author: { id: "1003", username: "ci", bot: true },
        },
      },
      {
        op: 0,
        t: "MESSAGE_CREATE",
        s: 5,
        d: {
          ...message,
          id: "m3",
          channel_id: "CH2",
          content: "The hiring plan for the platform team is final",
          mentions: [],
        },
      },
      { op: 0, t: "GUILD_DELETE", s: 6, d: { id: guild, guild_id: guild } },
    ];
    const stop = startStreams(env.ctx);
    try {
      for (let i = 0; i < 100; i += 1) {
        const [{ status } = { status: "" }] = (
          await env.ctx.db.execute<{ status: string }>(
            sql`select status from connections where id = ${conn.id}`
          )
        ).rows;
        if (status === "revoked") {
          break;
        }
        await sleep(100);
      }
    } finally {
      await stop();
    }
    expect(identified.at(-1)).toMatchObject({ token: "bot-token" });
    // The Message Content intent, without which messages arrive empty.
    expect(Math.floor((identified.at(-1)?.intents ?? 0) / 32_768) % 2).toBe(1);

    await env.drain();
    const activities = (
      await env.call("GET", "/v1/activities?source=discord", {
        token: owner.token,
      })
    ).body;
    expect(
      activities.map((a: any) => [a.title, a.visibility]).toSorted()
    ).toEqual([
      [
        "Posted in #leads: The hiring plan for the platform team is final",
        "private",
      ],
      [
        "Posted in #standup: Shipped the retry queue to production, @sam can you watch the alerts?",
        "team",
      ],
    ]);
    expect(activities[0].actorId).toBe(owner.member.id);
    // What only some can read in Discord stays the author's in Worklog.
    const seenBySam = (
      await env.call("GET", "/v1/activities?source=discord", {
        token: sam.token,
      })
    ).body;
    expect(seenBySam.map((a: any) => a.title)).toEqual([
      "Posted in #standup: Shipped the retry queue to production, @sam can you watch the alerts?",
    ]);
    const [mention] = (
      await env.call("GET", "/v1/attention", { token: sam.token })
    ).body;
    expect(mention).toMatchObject({ kind: "mention", priority: "normal" });
    const [after] = (
      await env.call("GET", "/v1/connections", { token: owner.token })
    ).body;
    expect(after).toMatchObject({
      status: "revoked",
      statusReason: "the bot was removed from the server",
    });
  }, 60_000);

  test("a dropped socket resumes from the last stored dispatch, and nothing is lost", async () => {
    const owner = await env.workspace();
    await env.call("PUT", "/v1/apps/discord", {
      token: owner.token,
      headers: SETUP,
      body: {
        appId: "app-1",
        credentials: {
          clientId: "app-1",
          clientSecret: "discord-secret",
          publicKey: "00".repeat(32),
          botToken: "bot-token",
        },
        replace: true,
      },
    });
    const guild = String(randomInt(1_000_000, 900_000_000));
    env.ctx.fetch = routedFetch([
      [
        "POST https://discord.com/api/v10/oauth2/token",
        () => ({ access_token: "a", guild: { id: guild, name: "Beta" } }),
      ],
      [
        "GET https://discord.com/api/v10/gateway/bot",
        () => ({ url: `ws://localhost:${gateway.port}` }),
      ],
    ]);
    const link = await env.call("POST", "/v1/apps/discord/install", {
      token: owner.token,
    });
    const state = new URL(link.body.url).searchParams.get("state") ?? "";
    await env.app.request(
      `/oauth/discord/callback?code=c&state=${encodeURIComponent(state)}`
    );
    const [conn] = (
      await env.call("GET", "/v1/connections", { token: owner.token })
    ).body;
    await env.call("PATCH", `/v1/connections/${conn.id}`, {
      token: owner.token,
      body: { settings: { channels: ["CH9"] } },
    });
    const post = (id: string, content: string) => ({
      id,
      channel_id: "CH9",
      guild_id: guild,
      author: { id: "2001", username: "ana" },
      content,
      timestamp: new Date().toISOString(),
    });
    script = [
      { op: 0, t: "READY", s: 1, d: { session_id: "sess-9" } },
      {
        op: 0,
        t: "MESSAGE_CREATE",
        s: 2,
        d: post("p1", "Migrated the billing tables"),
      },
    ];
    dropAfterScript = true;
    afterResume = [
      {
        op: 0,
        t: "MESSAGE_CREATE",
        s: 3,
        d: post("p2", "Backfilled last month's invoices"),
      },
      { op: 0, t: "RESUMED", s: 4, d: {} },
    ];
    const stop = startStreams(env.ctx);
    try {
      for (let i = 0; i < 100 && resumed.length === 0; i += 1) {
        await sleep(100);
      }
      await sleep(300);
    } finally {
      dropAfterScript = false;
      await stop();
    }
    expect(resumed.at(-1)).toEqual({
      token: "bot-token",
      session_id: "sess-9",
      seq: 2,
    });
    await env.drain();
    const titles = (
      await env.call("GET", "/v1/activities?source=discord", {
        token: owner.token,
      })
    ).body.map((a: any) => a.title);
    expect(
      titles.toSorted((a: string, b: string) => a.localeCompare(b))
    ).toEqual([
      "Posted in #CH9: Backfilled last month's invoices",
      "Posted in #CH9: Migrated the billing tables",
    ]);
  }, 60_000);
});
