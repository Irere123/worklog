import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { routedFetch, testEnv, attachBucket } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});
beforeEach(() => {
  env.reset();
});

const BUCKET = "https://acct.r2.cloudflarestorage.com/worklog/";
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d,
]);

function withBucket() {
  const fetch = routedFetch([
    [`PUT ${BUCKET}`, () => new Response(null, { status: 200 })],
    [`DELETE ${BUCKET}`, () => new Response(null, { status: 204 })],
  ]);
  attachBucket(env.ctx, fetch);
  return fetch;
}

async function upload(token: string, image: Uint8Array, type = "image/png") {
  const res = await env.app.request("/v1/me/avatar", {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": type },
    body: image,
  });
  const body: any = await res.json();
  return { status: res.status, body };
}

describe("profile pictures", () => {
  test("a server without file storage says so and refuses uploads", async () => {
    const { token } = await env.workspace("No Bucket Co");
    expect((await env.call("GET", "/v1/me", { token })).body.uploads).toBe(
      false
    );
    expect((await upload(token, PNG)).status).toBe(503);
  });

  test("an upload goes to the bucket, signed, and the profile points at its public address", async () => {
    const fetch = withBucket();
    const { token, member } = await env.workspace("Bucket Co");
    expect((await env.call("GET", "/v1/me", { token })).body.uploads).toBe(
      true
    );

    const res = await upload(token, PNG);
    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toMatch(
      new RegExp(
        `^https://files\\.worklog\\.test/avatars/${member.id}/\\w+\\.png$`,
        "u"
      )
    );
    const [put] = fetch.calls;
    expect(put?.method).toBe("PUT");
    expect(put?.url).toBe(
      res.body.avatarUrl.replace("https://files.worklog.test/", BUCKET)
    );
    expect(put?.headers.get("content-type")).toBe("image/png");
    expect(put?.headers.get("authorization")).toStartWith("AWS4-HMAC-SHA256");
  });

  test("replacing or removing a picture deletes the file it replaces", async () => {
    const fetch = withBucket();
    const { token } = await env.workspace("Replace Co");
    const first = (await upload(token, PNG)).body.avatarUrl as string;
    const second = (await upload(token, PNG)).body.avatarUrl as string;
    expect(second).not.toBe(first);
    await env.call("PATCH", "/v1/me", { token, body: { avatarUrl: null } });

    expect(
      fetch.calls.filter((c) => c.method === "DELETE").map((c) => c.url)
    ).toEqual([
      first.replace("https://files.worklog.test/", BUCKET),
      second.replace("https://files.worklog.test/", BUCKET),
    ]);
  });

  test("a file that only claims to be an image is refused before it reaches the bucket", async () => {
    const fetch = withBucket();
    const { token } = await env.workspace("Sniff Co");
    const html = new TextEncoder().encode("<html><script>alert(1)</script>");
    expect((await upload(token, html)).status).toBe(400);
    expect(fetch.calls).toHaveLength(0);
  });

  test("a picture over 2 MB is refused", async () => {
    withBucket();
    const { token } = await env.workspace("Big Co");
    const big = new Uint8Array(2_000_001);
    big.set(PNG);
    expect((await upload(token, big)).status).toBe(413);
  });

  test("clearing a teammate's address you copied leaves their file alone", async () => {
    const fetch = withBucket();
    const { token } = await env.workspace("Copy Co");
    const mia = await env.teammate(token, "Mia");
    const theirs = (await upload(mia.token, PNG)).body.avatarUrl as string;
    await env.call("PATCH", "/v1/me", { token, body: { avatarUrl: theirs } });
    await env.call("PATCH", "/v1/me", { token, body: { avatarUrl: null } });
    expect(fetch.calls.some((c) => c.method === "DELETE")).toBe(false);
  });
});
