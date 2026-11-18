import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync, randomInt, sign } from "node:crypto";

import { deliver } from "#automations/delivery";
import { guildChannels } from "#connectors/discord/app";
import { reconcileInstallations } from "#ingest/installations";

import { routedFetch, testEnv } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});
beforeEach(() => {
  env.reset();
});

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicHex = Buffer.from(
  publicKey.export({ format: "jwk" }).x ?? "",
  "base64url"
).toString("hex");
const SETUP = { "x-setup-secret": "test-secret" };

describe("Discord app", () => {
  test("adding the bot to a server connects it; commands from that server reach its workspace", async () => {
    const owner = await env.workspace();
    expect(
      (
        await env.call("PUT", "/v1/apps/discord", {
          token: owner.token,
          headers: SETUP,
          body: {
            appId: "app-1",
            credentials: {
              clientId: "app-1",
              clientSecret: "discord-secret",
              publicKey: publicHex,
              botToken: "bot-token",
            },
            replace: true,
          },
        })
      ).status
    ).toBe(200);
    const guild = String(randomInt(1_000_000, 900_000_000));
    const fetch = routedFetch([
      [
        "POST https://discord.com/api/v10/oauth2/token",
        (r) =>
          r.body.client_secret === "discord-secret"
            ? { access_token: "a", guild: { id: guild, name: "Acme" } }
            : new Response("no", { status: 401 }),
      ],
      ["PUT https://discord.com/api/v10/applications/app-1/commands", () => []],
    ]);
    env.ctx.fetch = fetch;
    const link = await env.call("POST", "/v1/apps/discord/install", {
      token: owner.token,
    });
    const url = new URL(link.body.url);
    expect(url.searchParams.get("scope")).toBe("bot applications.commands");
    const state = url.searchParams.get("state") ?? "";
    const res = await env.app.request(
      `/oauth/discord/callback?code=c&guild_id=666&state=${encodeURIComponent(state)}`
    );
    expect(res.status).toBe(200);
    const [conn] = (
      await env.call("GET", "/v1/connections", { token: owner.token })
    ).body;
    expect(conn).toMatchObject({ name: "Discord · Acme", externalId: guild });
    const commands = fetch.calls.find((c) => c.method === "PUT");
    expect(commands?.headers.get("authorization")).toBe("Bot bot-token");

    await env.call("POST", "/v1/members/me/identities", {
      token: owner.token,
      body: { provider: "discord", externalId: "D1" },
    });
    const raw = JSON.stringify({
      type: 2,
      id: "i1",
      token: "t",
      application_id: "app-1",
      guild_id: guild,
      member: { user: { id: "D1" } },
      data: {
        name: "log",
        options: [{ name: "text", value: "Reviewed the billing design" }],
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(
      null,
      Buffer.from(timestamp + raw),
      privateKey
    ).toString("hex");
    const answer = await env.app.request("/hooks/apps/discord/interactions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": signature,
        "x-signature-timestamp": timestamp,
      },
      body: raw,
    });
    const reply = (await answer.json()) as { data: { content: string } };
    expect(reply.data.content).toContain("Logged");
    const [logged] = (
      await env.call("GET", "/v1/activities?kind=log.entry", {
        token: owner.token,
      })
    ).body;
    expect(logged.title).toContain("billing design");

    env.ctx.fetch = routedFetch([
      [
        "GET https://discord.com/api/v10/channels/C-OTHER",
        () => ({ id: "C-OTHER", guild_id: "someone-elses-server" }),
      ],
      [
        "GET https://discord.com/api/v10/channels/C-1",
        () => ({ id: "C-1", guild_id: guild }),
      ],
    ]);
    const hook = await env.call("POST", "/v1/delivery-targets", {
      token: owner.token,
      body: {
        kind: "discord",
        address: "https://discord.com/api/webhooks/1/abc",
        connectionId: conn.id,
      },
    });
    expect(hook.status).toBe(201);
    const elsewhere = await env.call("POST", "/v1/delivery-targets", {
      token: owner.token,
      body: { kind: "discord", address: "C-OTHER", connectionId: conn.id },
    });
    expect(elsewhere.status).toBe(400);
    const target = (
      await env.call("POST", "/v1/delivery-targets", {
        token: owner.token,
        body: { kind: "discord", address: "C-1", connectionId: conn.id },
      })
    ).body;
    env.ctx.fetch = routedFetch([
      [
        "POST https://discord.com/api/v10/channels/C-1/messages",
        () => new Response("401: Unauthorized", { status: 401 }),
      ],
    ]);
    const sent = await deliver(env.ctx, owner.member.id, [target.id], {
      subject: "Brief",
      markdown: "Nothing new",
      type: "brief",
    });
    expect(sent.failed).toHaveLength(1);
    const kept = (
      await env.call("GET", "/v1/connections", { token: owner.token })
    ).body;
    expect(kept[0].status).toBe("active");

    env.ctx.fetch = routedFetch([
      [
        `GET https://discord.com/api/v10/guilds/${guild}/channels`,
        () => new Response("401: Unauthorized", { status: 401 }),
      ],
    ]);
    const refused = await env.call(
      "GET",
      `/v1/connections/${conn.id}/sources`,
      {
        token: owner.token,
      }
    );
    expect(refused.status).toBeGreaterThanOrEqual(400);
    const stillActive = (
      await env.call("GET", "/v1/connections", { token: owner.token })
    ).body;
    expect(stillActive[0].status).toBe("active");

    env.ctx.fetch = routedFetch([
      [
        "GET https://discord.com/api/v10/users/@me/guilds",
        () => new Response("down", { status: 500 }),
      ],
    ]);
    await reconcileInstallations(env.ctx);
    const still = (
      await env.call("GET", "/v1/connections", { token: owner.token })
    ).body;
    expect(still[0].status).toBe("active");
    env.ctx.fetch = routedFetch([
      [
        "GET https://discord.com/api/v10/users/@me/guilds",
        () => [{ id: "someone-else" }],
      ],
    ]);
    await reconcileInstallations(env.ctx);
    const after = (
      await env.call("GET", "/v1/connections", { token: owner.token })
    ).body;
    expect(after[0]).toMatchObject({
      status: "revoked",
      statusReason: "the app is no longer installed there",
    });
  });

  test("a channel hidden from @everyone is private, unless it's hidden only behind the member role", async () => {
    const everyoneOut = { id: "G1", type: 0, allow: "0", deny: "1024" };
    expect(
      await channelsOf([
        { id: "C1", name: "general", type: 0 },
        {
          id: "C2",
          name: "leads",
          type: 0,
          permission_overwrites: [everyoneOut, letIn("R_LEADS")],
        },
      ])
    ).toEqual([
      { id: "C1", name: "general", private: false },
      { id: "C2", name: "leads", private: true },
    ]);
    expect(
      await channelsOf([
        { id: "C0", name: "welcome", type: 0 },
        {
          id: "C1",
          name: "general",
          type: 0,
          permission_overwrites: [everyoneOut, letIn("R_MEMBER")],
        },
        {
          id: "C2",
          name: "dev",
          type: 0,
          permission_overwrites: [everyoneOut, letIn("R_MEMBER")],
        },
        {
          id: "C3",
          name: "leads",
          type: 0,
          permission_overwrites: [everyoneOut, letIn("R_LEADS")],
        },
      ])
    ).toEqual([
      { id: "C2", name: "dev", private: false },
      { id: "C1", name: "general", private: false },
      { id: "C3", name: "leads", private: true },
      { id: "C0", name: "welcome", private: false },
    ]);
  });
});

async function channelsOf(channels: object[]) {
  env.ctx.fetch = routedFetch([
    ["GET https://discord.com/api/v10/guilds/G1/channels", () => channels],
  ]);
  return await guildChannels(env.ctx, "G1", "bot");
}

function letIn(role: string) {
  return { id: role, type: 0, allow: "1024", deny: "0" };
}
