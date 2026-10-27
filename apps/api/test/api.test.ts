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
