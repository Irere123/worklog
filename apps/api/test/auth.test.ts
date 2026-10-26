import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { account } from "../src/db/auth-schema";
import type { ConsoleMailer } from "../src/delivery/mailer";
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

const mailbox = () => (env.ctx.mailer as ConsoleMailer).sent;

/** Signs in through the real magic-link flow and returns the session token (as a mobile client would). */
async function signIn(email: string) {
  const start = await env.app.request("/api/auth/sign-in/magic-link", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://worklog.test",
    },
    body: JSON.stringify({ email, callbackURL: "/" }),
  });
  expect(start.status).toBe(200);
  // The email is sent without awaiting (timing safety)
  await Bun.sleep(20);
  const mail = mailbox().findLast((m) => m.to === email)!;
  const link = new URL(/https?:\/\/\S+/u.exec(mail.text)![0]);
  const verify = await env.app.request(link.pathname + link.search);
  const token = verify.headers.get("set-auth-token");
  expect(token).toBeTruthy();
  return token!;
}

describe("signing in", () => {
  test("advertises how to sign in", async () => {
    const res = await env.call("GET", "/v1/auth/config");
    expect(res.body).toEqual({
      magicLink: true,
      socialProviders: [],
      authBasePath: "/api/auth",
    });
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
    expect(
      mailbox().some(
        (m) => m.to === "Sam@Example.com" && m.subject.includes("Invites Co")
      )
    ).toBe(true);

    const token = await signIn("sam@example.com");
    const session = (await env.call("GET", "/v1/session", { token })).body;
    expect(session.memberships.map((m: any) => m.workspace.name)).toEqual([
      "Invites Co",
    ]);
    const me = (await env.call("GET", "/v1/me", { token })).body;
    expect(me.member).toMatchObject({ name: "Sam", signedUp: true });
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

  test("signing in with GitHub is enough for GitHub events to be attributed", async () => {
    const owner = await env.workspace("Attrib");
    await env.call("POST", "/v1/members", {
      token: owner.token,
      body: { kind: "human", name: "Dev", email: "dev@example.com" },
    });
    const token = await signIn("dev@example.com");
    const session = (await env.call("GET", "/v1/session", { token })).body;
    // What Better Auth stores after "Sign in with GitHub": the numeric GitHub user id.
    await env.ctx.db.insert(account).values({
      id: "acc_test_github",
      accountId: "4242",
      providerId: "github",
      userId: session.user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const conn = (
      await env.call("POST", "/v1/connections", {
        token: owner.token,
        body: { provider: "github", secrets: { webhookSecret: "s" } },
      })
    ).body;
    const raw = JSON.stringify({
      ref: "refs/heads/main",
      after: "abc",
      commits: [{ id: "1", message: "Fix" }],
      repository: { full_name: "acme/api" },
      sender: { login: "renamed-dev", id: 4242 },
    });
    await env.app.request(new URL(conn.webhookUrls.webhook).pathname, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "push",
        "x-github-delivery": "auth-1",
        "x-hub-signature-256": `sha256=${hmacHex("s", raw)}`,
      },
      body: raw,
    });
    await env.drain();
    const [push] = (
      await env.call("GET", "/v1/activities?kind=code.pushed", {
        token: owner.token,
      })
    ).body;
    expect(push.actorId).toBe(session.memberships[0].member.id);
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
