import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { account } from "#db/auth-schema";
import { hmacHex } from "#lib/crypto";
import type { ConsoleMailer } from "#lib/mailer";

import { testEnv } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});
beforeEach(() => {
  env.reset();
});

const mailbox = () => (env.ctx.mailer as ConsoleMailer).sent;

async function mailTo(address: string, sentAfter = 0) {
  for (let tries = 0; tries < 100; tries += 1) {
    const mail = mailbox()
      .slice(sentAfter)
      .findLast((m) => m.to === address);
    if (mail) {
      return mail;
    }
    await Bun.sleep(10);
  }
  throw new Error(`No email reached ${address}`);
}

async function signIn(email: string) {
  const before = mailbox().length;
  const start = await env.app.request("/api/auth/sign-in/magic-link", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://worklog.test",
    },
    body: JSON.stringify({ email, callbackURL: "/" }),
  });
  expect(start.status).toBe(200);
  const mail = await mailTo(email, before);
  const link = new URL(/https?:\/\/\S+/u.exec(mail.text)![0]);
  const verify = await env.app.request(link.pathname + link.search);
  const token = verify.headers.get("set-auth-token");
  expect(token).toBeTruthy();
  return token!;
}

describe("signing in", () => {
  test("advertises how to sign in, and that setup is closed once a workspace exists", async () => {
    await env.workspace();
    const res = await env.call("GET", "/v1/auth/config");
    expect(res.body).toEqual({
      magicLink: true,
      socialProviders: [],
      authBasePath: "/api/auth",
      setupOpen: false,
      signupOpen: true,
      mcpUrl: "https://worklog.test/mcp",
    });
  });

  test("a server with signup closed lets people join only by invite", async () => {
    await env.workspace();
    env.ctx.config.SIGNUP = "closed";
    try {
      const config = await env.call("GET", "/v1/auth/config");
      expect(config.body.signupOpen).toBe(false);
      const token = await signIn("stranger@example.com");
      const created = await env.call("POST", "/v1/workspaces", {
        token,
        body: { name: "Not here" },
      });
      expect(created.status).toBe(403);
      expect(created.body.error.message).toContain("invite-only");
    } finally {
      env.ctx.config.SIGNUP = "open";
    }
  });

  test("a new person signs in with an email link, creates a workspace, and is its owner", async () => {
    const token = await signIn("founder@example.com");
    const session = await env.call("GET", "/v1/session", { token });
    expect(session.body).toMatchObject({
      user: { email: "founder@example.com" },
      memberships: [],
      via: "session",
    });
    expect((await env.call("GET", "/v1/me", { token })).body.error.code).toBe(
      "no_workspace"
    );

    const created = await env.call("POST", "/v1/workspaces", {
      token,
      body: { name: "Founders Inc", timezone: "Africa/Kigali" },
    });
    expect(created.status).toBe(201);
    expect(created.body.member).toMatchObject({
      role: "owner",
      signedUp: true,
    });
    const me = await env.call("GET", "/v1/me", { token });
    expect(me.body.workspace.name).toBe("Founders Inc");
  });

  test("adding a teammate by email invites them; signing in with that email joins the workspace", async () => {
    const owner = await env.workspace("Invites Co");
    const added = await env.call("POST", "/v1/members", {
      token: owner.token,
      body: { kind: "human", name: "Sam", email: "Sam@Example.com" },
    });
    expect(added.body).toMatchObject({
      invited: true,
      member: { signedUp: false },
    });
    expect((await mailTo("Sam@Example.com")).subject).toContain("Invites Co");

    const token = await signIn("sam@example.com");
    const session = (await env.call("GET", "/v1/session", { token })).body;
    expect(session.memberships.map((m: any) => m.workspace.name)).toEqual([
      "Invites Co",
    ]);
    const me = (await env.call("GET", "/v1/me", { token })).body;
    expect(me.member).toMatchObject({ name: "Sam", signedUp: true });
  });

  test("an invite shows names as text, never as markup", async () => {
    const owner = await env.workspace("<img src=x> Co");
    await env.call("POST", "/v1/members", {
      token: owner.token,
      body: { kind: "human", name: "Rae", email: "rae@example.com" },
    });
    const mail = await mailTo("rae@example.com");
    expect(mail.html).toContain("&lt;img src=x&gt; Co");
    expect(mail.html).not.toContain("<img");
  });

  test("each sign-in email starts its own thread, so a fresh link isn't buried under old ones", async () => {
    await signIn("thread@example.com");
    await signIn("thread@example.com");
    const [first, second] = mailbox()
      .filter((m) => m.to === "thread@example.com")
      .map((m) => m.headers?.["X-Entity-Ref-ID"]);
    expect(first).toBeTruthy();
    expect(first).not.toBe(second);
  });

  test("people in several workspaces choose one per request", async () => {
    const a = await env.workspace("Alpha");
    const b = await env.workspace("Beta");
    for (const w of [a, b]) {
      await env.call("POST", "/v1/members", {
        token: w.token,
        body: { kind: "human", name: "Kim", email: "kim@example.com" },
      });
    }
    const token = await signIn("kim@example.com");
    const inBeta = await env.call("GET", "/v1/me", {
      token,
      headers: { "x-worklog-workspace": b.workspace.id },
    });
    expect(inBeta.body.workspace.name).toBe("Beta");
    const elsewhere = await env.call("GET", "/v1/me", {
      token,
      headers: { "x-worklog-workspace": "ws_nope" },
    });
    expect(elsewhere.status).toBe(403);
  });

  test("signing in with GitHub is enough for GitHub events to be attributed, earlier ones too", async () => {
    const owner = await env.workspace("Attrib");
    await env.call("POST", "/v1/members", {
      token: owner.token,
      body: { kind: "human", name: "Dev", email: "dev@example.com" },
    });
    const token = await signIn("dev@example.com");
    const session = (await env.call("GET", "/v1/session", { token })).body;
    const conn = (
      await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: { provider: "github", secrets: { webhookSecret: "s" } },
      })
    ).body;
    const push = async (n: number) => {
      const raw = JSON.stringify({
        ref: `refs/heads/b${n}`,
        after: `abc${n}`,
        commits: [{ id: String(n), message: "Fix" }],
        repository: { full_name: "acme/api" },
        sender: { login: "renamed-dev", id: 4242 },
      });
      await env.app.request(new URL(conn.webhookUrls.webhook).pathname, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "push",
          "x-github-delivery": `auth-${n}`,
          "x-hub-signature-256": `sha256=${hmacHex("s", raw)}`,
        },
        body: raw,
      });
      await env.drain();
    };
    await push(1);
    await env.ctx.db.insert(account).values({
      id: "acc_test_github",
      accountId: "4242",
      providerId: "github",
      userId: session.user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await push(2);
    const pushes = (
      await env.call("GET", "/v1/activities?kind=code.pushed", {
        token: owner.token,
      })
    ).body;
    expect(pushes.map((p: any) => p.actorId)).toEqual([
      session.memberships[0].member.id,
      session.memberships[0].member.id,
    ]);
  });
});

describe("API keys", () => {
  test("scopes limit what a key can do; ingest-only keys can just report work", async () => {
    const owner = await env.workspace();
    const ci = (
      await env.call("POST", "/v1/members", {
        token: owner.token,
        body: { kind: "agent", name: "CI", agentProvider: "github-actions" },
      })
    ).body.member;
    const key = (
      await env.call("POST", `/v1/members/${ci.id}/tokens`, {
        token: owner.token,
        body: { name: "ci", scopes: ["ingest"] },
      })
    ).body;
    expect(key).toMatchObject({
      scopes: ["ingest"],
      prefix: key.token.slice(0, 10),
    });

    expect(
      (
        await env.call("POST", "/v1/activities", {
          token: key.token,
          body: { kind: "deploy.finished", title: "Deployed api v1.2" },
        })
      ).status
    ).toBe(201);
    const denied = await env.call("GET", "/v1/cards", { token: key.token });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("insufficient_scope");

    const listed = (
      await env.call("GET", `/v1/members/${ci.id}/tokens`, {
        token: owner.token,
      })
    ).body;
    expect(listed[0]).toMatchObject({ name: "ci", scopes: ["ingest"] });
    expect(listed[0].token).toBeUndefined();
  });

  test("expired keys stop working", async () => {
    const owner = await env.workspace();
    const key = (
      await env.call("POST", "/v1/members/me/tokens", {
        token: owner.token,
        body: { name: "short", expiresInDays: 1 },
      })
    ).body;
    expect((await env.call("GET", "/v1/me", { token: key.token })).status).toBe(
      200
    );
    env.ctx.now = () => new Date(Date.now() + 2 * 86_400_000);
    expect((await env.call("GET", "/v1/me", { token: key.token })).status).toBe(
      401
    );
  });
});
