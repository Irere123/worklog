import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { testEnv } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});
beforeEach(() => {
  env.reset();
});

async function invited(token: string, name: string, email?: string) {
  const res = await env.call("POST", "/v1/members", {
    token,
    body: { kind: "human", name, ...(email ? { email } : {}) },
  });
  expect(res.status).toBe(201);
  return res.body.member;
}

async function linkFor(token: string, ref: string, reset = false) {
  const res = await env.call("POST", `/v1/members/${ref}/invite-link`, {
    token,
    body: reset ? { reset } : {},
  });
  expect(res.status).toBe(200);
  const url = new URL(res.body.url);
  expect(url.origin).toBe("https://worklog.test");
  return url.pathname.replace("/join/", "");
}

describe("invite links", () => {
  test("whoever opens the link joins as the invited person, with whatever account they sign in with", async () => {
    const { token, workspace } = await env.workspace("Link Co");
    const mia = await invited(token, "Mia", "mia@work.test");
    const code = await linkFor(token, mia.id);

    expect((await env.call("GET", `/v1/invites/${code}`)).body).toEqual({
      name: "Mia",
      workspace: { name: "Link Co" },
    });

    const session = await env.signIn("mia.personal@home.test");
    const accepted = await env.call("POST", `/v1/invites/${code}/accept`, {
      token: session,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.workspace.id).toBe(workspace.id);
    expect(accepted.body.member).toMatchObject({
      id: mia.id,
      email: "mia.personal@home.test",
      signedUp: true,
    });

    const me = await env.call("GET", "/v1/me", {
      token: session,
      headers: { "x-worklog-workspace": workspace.id },
    });
    expect(me.body.member.id).toBe(mia.id);
  });

  test("a link works once", async () => {
    const { token } = await env.workspace("Once Co");
    const mia = await invited(token, "Mia");
    const code = await linkFor(token, mia.id);
    const first = await env.signIn("first@once.test");
    expect(
      (await env.call("POST", `/v1/invites/${code}/accept`, { token: first }))
        .status
    ).toBe(200);

    const second = await env.signIn("second@once.test");
    expect(
      (await env.call("POST", `/v1/invites/${code}/accept`, { token: second }))
        .status
    ).toBe(404);
    expect((await env.call("GET", `/v1/invites/${code}`)).status).toBe(404);
    expect(
      (
        await env.call("POST", `/v1/members/${mia.id}/invite-link`, {
          token,
          body: {},
        })
      ).status
    ).toBe(409);
  });

  test("copying the link again gives the same one, and a new link voids the old", async () => {
    const { token } = await env.workspace("Reset Co");
    const mia = await invited(token, "Mia");
    const first = await linkFor(token, mia.id);
    expect(await linkFor(token, mia.id)).toBe(first);

    const fresh = await linkFor(token, mia.id, true);
    expect(fresh).not.toBe(first);
    expect((await env.call("GET", `/v1/invites/${first}`)).status).toBe(404);
    expect((await env.call("GET", `/v1/invites/${fresh}`)).status).toBe(200);
  });

  test("a link someone edited, or one for another person, doesn't open", async () => {
    const { token } = await env.workspace("Tamper Co");
    const mia = await invited(token, "Mia");
    const leo = await invited(token, "Leo");
    const code = await linkFor(token, mia.id);
    const [, signature] = code.split(".");
    for (const bad of [
      `${leo.id}.${signature}`,
      `${mia.id}.${"0".repeat(32)}`,
      mia.id,
      "nonsense",
    ]) {
      expect((await env.call("GET", `/v1/invites/${bad}`)).status).toBe(404);
    }
  });

  test("only admins make links, only for people, and only a person signed in can accept", async () => {
    const { token } = await env.workspace("Rules Co");
    const mia = await invited(token, "Mia");
    const member = await env.teammate(token, "Sam");
    expect(
      (
        await env.call("POST", `/v1/members/${mia.id}/invite-link`, {
          token: member.token,
          body: {},
        })
      ).status
    ).toBe(403);

    const agent = await env.call("POST", "/v1/members", {
      token,
      body: { kind: "agent", name: "Bot" },
    });
    expect(
      (
        await env.call(
          "POST",
          `/v1/members/${agent.body.member.id}/invite-link`,
          { token, body: {} }
        )
      ).status
    ).toBe(400);

    const code = await linkFor(token, mia.id);
    expect(
      (await env.call("POST", `/v1/invites/${code}/accept`, { token })).status
    ).toBe(403);
  });

  test("someone already in the workspace can't take a second seat with a link", async () => {
    const { token, workspace } = await env.workspace("Seat Co");
    const lee = await invited(token, "Lee", "lee@seat.test");
    const session = await env.signIn("lee@seat.test");
    const me = await env.call("GET", "/v1/me", {
      token: session,
      headers: { "x-worklog-workspace": workspace.id },
    });
    expect(me.body.member.id).toBe(lee.id);

    const mia = await invited(token, "Mia");
    const code = await linkFor(token, mia.id);
    expect(
      (await env.call("POST", `/v1/invites/${code}/accept`, { token: session }))
        .status
    ).toBe(409);
  });
});
