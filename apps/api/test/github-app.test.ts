import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createPublicKey,
  generateKeyPairSync,
  randomInt,
  verify,
} from "node:crypto";

import { sql } from "drizzle-orm";

import {
  convertManifest,
  forgetToken,
  githubManifest,
} from "#connectors/github/app";
import { forgetCachedApps, loadApp } from "#ingest/apps";
import { withAppSignIn } from "#ingest/sign-in";
import { hmacHex } from "#lib/crypto";

import { routedFetch, testEnv } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});
beforeEach(() => {
  env.reset();
});

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
const publicKey = createPublicKey(privateKey);
const SETUP = { "x-setup-secret": "test-secret" };
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const user = (login: string, databaseId: number) => ({
  __typename: "User",
  login,
  databaseId,
  name: null,
});
const emma = user("emma-gh", 101);
const sam = user("sam-gh", 202);

async function registerApp(owner: { token: string }) {
  const res = await env.call("PUT", "/v1/apps/github", {
    token: owner.token,
    headers: SETUP,
    body: {
      appId: "4242",
      slug: "worklog-test",
      credentials: {
        clientId: "Iv1.test",
        clientSecret: "client-secret",
        privateKey: pem,
        webhookSecret: "app-hook-secret",
      },
      replace: true,
    },
  });
  expect(res.status).toBe(200);
}

function jwtIsValid(authorization: string | null) {
  const [header = "", payload = "", signature = ""] = (authorization ?? "")
    .replace("Bearer ", "")
    .split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  return (
    claims.iss === "4242" &&
    claims.exp - claims.iat <= 600 &&
    verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, "base64url")
    )
  );
}

const pulls = [
  {
    number: 7,
    title: "Retry payments",
    url: "https://github.com/acme/api/pull/7",
    body: "Adds backoff",
    isDraft: false,
    createdAt: ago(11 * 24 * HOUR),
    updatedAt: ago(10 * 24 * HOUR),
    closedAt: ago(10 * 24 * HOUR),
    mergedAt: ago(10 * 24 * HOUR),
    author: emma,
    mergedBy: emma,
    reviewRequests: { nodes: [] },
    reviews: {
      nodes: [
        {
          databaseId: 9001,
          state: "APPROVED",
          body: "LGTM",
          url: "https://github.com/acme/api/pull/7#r1",
          submittedAt: ago(10.5 * 24 * HOUR),
          author: sam,
        },
      ],
    },
    comments: { nodes: [] },
    timelineItems: { nodes: [] },
  },
  {
    number: 8,
    title: "Cap the backoff",
    url: "https://github.com/acme/api/pull/8",
    body: null,
    isDraft: false,
    createdAt: ago(HOUR),
    updatedAt: ago(HOUR),
    closedAt: null,
    mergedAt: null,
    author: emma,
    mergedBy: null,
    reviewRequests: { nodes: [{ requestedReviewer: sam }] },
    reviews: { nodes: [] },
    comments: { nodes: [] },
    timelineItems: { nodes: [] },
  },
];

const releases = [
  {
    databaseId: 77,
    tagName: "v1.2.0",
    name: "v1.2.0",
    url: "https://github.com/acme/api/releases/v1.2.0",
    description: "Retries",
    isDraft: false,
    isPrerelease: false,
    publishedAt: ago(3 * 24 * HOUR),
    author: emma,
  },
];

function graphql(body: { query: string }) {
  let nodes: unknown[] = [];
  if (body.query.includes("pullRequests")) {
    nodes = pulls;
  } else if (body.query.includes("releases(")) {
    nodes = releases;
  }
  return {
    data: {
      repository: {
        databaseId: 501,
        items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes },
      },
    },
  };
}

function github(
  installationId: string,
  extra: [string, (r: any) => unknown][] = []
) {
  return routedFetch([
    ...extra,
    [
      "POST https://github.com/login/oauth/access_token",
      () => ({ access_token: "user-token" }),
    ],
    [
      "GET https://api.github.com/user/installations",
      () => ({ installations: [{ id: Number(installationId) }] }),
    ],
    [
      "POST https://api.github.com/app/installations/",
      (r) =>
        jwtIsValid(r.headers.get("authorization"))
          ? {
              token: "installation-token",
              expires_at: new Date(Date.now() + HOUR).toISOString(),
            }
          : new Response("bad jwt", { status: 401 }),
    ],
    [
      "GET https://api.github.com/app/installations/",
      () => ({ id: Number(installationId), account: { login: "acme" } }),
    ],
    [
      "GET https://api.github.com/installation/repositories",
      () => ({ repositories: [{ full_name: "acme/api" }] }),
    ],
    ["POST https://api.github.com/graphql", (r) => graphql(r.body)],
    [
      "GET https://api.github.com/repos/acme/api/activity",
      () => [
        {
          before: "a".repeat(40),
          after: "b".repeat(40),
          ref: "refs/heads/retry",
          timestamp: ago(2 * HOUR),
          activity_type: "push",
          actor: { login: "emma-gh", id: 101, type: "User" },
        },
        {
          before: "b".repeat(40),
          after: "c".repeat(40),
          ref: "refs/heads/retry",
          timestamp: ago(HOUR),
          activity_type: "force_push",
          actor: { login: "emma-gh", id: 101, type: "User" },
        },
      ],
    ],
    [
      "GET https://api.github.com/repos/acme/api/compare/",
      () => ({
        total_commits: 2,
        commits: [
          { sha: "1", commit: { message: "Add jitter" } },
          { sha: "2", commit: { message: "Cap at 5" } },
        ],
      }),
    ],
    [
      "GET https://api.github.com/repos/acme/api",
      () => ({ id: 501, full_name: "acme/api", default_branch: "main" }),
    ],
  ]);
}

async function installed() {
  const owner = await env.workspace();
  const teammate = await env.teammate(owner.token, "Sam");
  await env.call("POST", "/v1/members/me/identities", {
    token: owner.token,
    body: { provider: "github", externalId: "101" },
  });
  await env.call("POST", `/v1/members/${teammate.member.id}/identities`, {
    token: teammate.token,
    body: { provider: "github", externalId: "202" },
  });
  await registerApp(owner);
  const installationId = String(randomInt(1_000_000, 900_000_000));
  env.ctx.fetch = github(installationId);
  const link = await env.call("POST", "/v1/apps/github/install", {
    token: owner.token,
  });
  expect(link.body.url).toStartWith(
    "https://github.com/apps/worklog-test/installations/new?state="
  );
  const state = new URL(link.body.url).searchParams.get("state") ?? "";
  const callback = `/oauth/github/callback?code=c1&installation_id=${installationId}&setup_action=install&state=${encodeURIComponent(state)}`;
  const res = await env.app.request(callback);
  expect(res.status).toBe(200);
  await env.drain();
  const [conn] = (
    await env.call("GET", "/v1/connections", { token: owner.token })
  ).body;
  const hook = async (event: string, payload: object, id = installationId) => {
    const raw = JSON.stringify({
      installation: { id: Number(id) },
      repository: { id: 501, full_name: "acme/api", default_branch: "main" },
      ...payload,
    });
    const r = await env.app.request("/hooks/apps/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": event,
        "x-github-delivery": `d-${Math.random()}`,
        "x-hub-signature-256": `sha256=${hmacHex("app-hook-secret", raw)}`,
      },
      body: raw,
    });
    await env.drain();
    return r;
  };
  return { owner, teammate, conn, installationId, callback, hook };
}

describe("GitHub App", () => {
  test("installing connects the installation and reads its recent history without pinging about old news", async () => {
    const { owner, teammate, conn } = await installed();
    expect(conn).toMatchObject({
      provider: "github",
      name: "GitHub · acme",
      status: "active",
    });
    const kinds = (
      await env.call("GET", "/v1/activities?source=github", {
        token: owner.token,
      })
    ).body.map((a: any) => a.kind);
    expect(kinds.toSorted()).toEqual([
      "code.pushed",
      "pr.merged",
      "pr.opened",
      "pr.opened",
      "release.published",
      "review.submitted",
    ]);
    expect(
      (await env.call("GET", "/v1/attention", { token: owner.token })).body
    ).toHaveLength(0);
    const [waiting] = (
      await env.call("GET", "/v1/attention", { token: teammate.token })
    ).body;
    expect(waiting).toMatchObject({ kind: "review.requested" });
    expect(waiting.title).toContain("#8");

    const health = (
      await env.call("GET", `/v1/connections/${conn.id}/health`, {
        token: owner.token,
      })
    ).body;
    expect(health.sync).toContainEqual(
      expect.objectContaining({
        stream: "repo:acme/api",
        state: "idle",
        error: null,
      })
    );
  });

  test("webhooks route by installation; what the backfill already read isn't recorded twice", async () => {
    const { owner, teammate, hook } = await installed();
    const merged = {
      action: "closed",
      sender: { login: "emma-gh", id: 101 },
      pull_request: {
        number: 7,
        title: "Retry payments",
        html_url: "https://github.com/acme/api/pull/7",
        user: { login: "emma-gh", id: 101 },
        merged: true,
        closed_at: pulls[0]?.closedAt,
        merged_at: pulls[0]?.mergedAt,
      },
    };
    expect((await hook("pull_request", merged)).status).toBe(200);
    await hook("pull_request", {
      action: "closed",
      sender: { login: "emma-gh", id: 101 },
      pull_request: {
        number: 8,
        title: "Cap the backoff",
        html_url: "https://github.com/acme/api/pull/8",
        user: { login: "emma-gh", id: 101 },
        merged: true,
        closed_at: new Date().toISOString(),
        merged_at: new Date().toISOString(),
      },
    });
    const merges = (
      await env.call("GET", "/v1/activities?kind=pr.merged", {
        token: owner.token,
      })
    ).body;
    expect(merges.map((m: any) => m.title).toSorted()).toEqual([
      "Merged PR acme/api#7: Retry payments",
      "Merged PR acme/api#8: Cap the backoff",
    ]);
    expect(
      (await env.call("GET", "/v1/attention", { token: teammate.token })).body
    ).toHaveLength(0);
  });

  test("a redirect naming someone else's installation connects nothing", async () => {
    const owner = await env.workspace();
    await registerApp(owner);
    env.ctx.fetch = github("1", [
      [
        "GET https://api.github.com/user/installations",
        () => ({ installations: [{ id: 1 }] }),
      ],
    ]);
    const link = await env.call("POST", "/v1/apps/github/install", {
      token: owner.token,
    });
    const state = new URL(link.body.url).searchParams.get("state") ?? "";
    const res = await env.app.request(
      `/oauth/github/callback?code=c&installation_id=31337&setup_action=install&state=${encodeURIComponent(state)}`
    );
    expect(res.status).toBe(403);
    expect(
      (await env.call("GET", "/v1/connections", { token: owner.token })).body
    ).toHaveLength(0);
  });

  test("an install started in the web app comes back to the new connection there", async () => {
    const owner = await env.workspace();
    await registerApp(owner);
    const installationId = String(randomInt(1_000_000, 900_000_000));
    env.ctx.fetch = github(installationId);
    const link = await env.call("POST", "/v1/apps/github/install", {
      token: owner.token,
      body: { returnTo: "https://worklog.test/settings/connections" },
    });
    const state = new URL(link.body.url).searchParams.get("state") ?? "";
    const res = await env.app.request(
      `/oauth/github/callback?code=c&installation_id=${installationId}&setup_action=install&state=${encodeURIComponent(state)}`
    );
    const [conn] = (
      await env.call("GET", "/v1/connections", { token: owner.token })
    ).body;
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `https://worklog.test/settings/connections/${conn.id}`
    );
  });

  test("an install won't send the browser anywhere but the web app", async () => {
    const owner = await env.workspace();
    await registerApp(owner);
    const res = await env.call("POST", "/v1/apps/github/install", {
      token: owner.token,
      body: { returnTo: "https://elsewhere.example" },
    });
    expect(res.status).toBe(400);
  });

  test("editing the installation on GitHub's side comes back to a page that says it's fine", async () => {
    const res = await env.app.request(
      "/oauth/github/callback?code=x&installation_id=1&setup_action=update"
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("reaches Worklog on its own");
  });

  test("an install link outlives GitHub failing to answer, and then works once", async () => {
    const owner = await env.workspace();
    await registerApp(owner);
    const installationId = String(randomInt(1_000_000, 900_000_000));
    const link = await env.call("POST", "/v1/apps/github/install", {
      token: owner.token,
    });
    const state = new URL(link.body.url).searchParams.get("state") ?? "";
    const callback = `/oauth/github/callback?code=c&installation_id=${installationId}&setup_action=install&state=${encodeURIComponent(state)}`;
    env.ctx.fetch = routedFetch([
      ["POST https://", () => new Response("unavailable", { status: 502 })],
      ["GET https://", () => new Response("unavailable", { status: 502 })],
    ]);
    expect((await env.app.request(callback)).status).toBe(400);
    env.ctx.fetch = github(installationId);
    expect((await env.app.request(callback)).status).toBe(200);
    expect((await env.app.request(callback)).status).toBe(400);
  });

  test("an install link works once", async () => {
    const { callback } = await installed();
    const again = await env.app.request(callback);
    expect(again.status).toBe(400);
    expect(await again.text()).toContain("expired or was already used");
  });

  test("deliveries for an installation nobody connected are acknowledged and counted", async () => {
    const { owner, hook } = await installed();
    const res = await hook("push", { ref: "refs/heads/x", commits: [] }, "999");
    expect(await res.json()).toMatchObject({
      ignored: "no connection for this installation",
    });
    const app = (
      await env.call("GET", "/v1/apps", { token: owner.token })
    ).body.find((a: any) => a.provider === "github");
    expect(app.unrouted).toBeGreaterThan(0);

    await env.app.request("/hooks/apps/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "push",
        "x-github-delivery": "forged",
        "x-hub-signature-256": "sha256=nope",
      },
      body: "{}",
    });
    await env.drain();
    const after = (
      await env.call("GET", "/v1/apps", { token: owner.token })
    ).body.find((a: any) => a.provider === "github");
    expect(after).toMatchObject({ lastRejection: "bad signature" });
    expect(after.rejections).toBeGreaterThan(0);
    expect(app.webhookUrls).toEqual({
      webhook: "https://worklog.test/hooks/apps/github",
    });
  });

  test("uninstalling on GitHub revokes the connection and tells whoever installed it", async () => {
    const { owner, conn, hook } = await installed();
    await hook("installation", { action: "deleted" });
    const [after] = (
      await env.call("GET", "/v1/connections", { token: owner.token })
    ).body;
    expect(after).toMatchObject({
      status: "revoked",
      statusReason: "the GitHub App was uninstalled",
    });
    const [notice] = (
      await env.call("GET", "/v1/attention", { token: owner.token })
    ).body;
    expect(notice).toMatchObject({ kind: "connection.status" });
    const res = await hook("push", {
      ref: "refs/heads/x",
      after: "z",
      sender: { login: "emma-gh", id: 101 },
      commits: [{ id: "1", message: "late" }],
    });
    expect(await res.json()).toMatchObject({
      ignored: "connection is revoked",
    });
    const reconnect = await env.call("PATCH", `/v1/connections/${conn.id}`, {
      token: owner.token,
      body: { status: "active" },
    });
    expect(reconnect.status).toBe(400);
  });

  test("reinstalling after an uninstall brings the same connection back", async () => {
    const { owner, conn, hook } = await installed();
    await env.call("PATCH", `/v1/connections/${conn.id}`, {
      token: owner.token,
      body: { name: "Acme code", settings: { repos: ["acme/api"] } },
    });
    await hook("installation", { action: "deleted" });
    const again = String(randomInt(1_000_000, 900_000_000));
    env.ctx.fetch = github(again);
    const link = await env.call("POST", "/v1/apps/github/install", {
      token: owner.token,
    });
    const state = new URL(link.body.url).searchParams.get("state") ?? "";
    await env.app.request(
      `/oauth/github/callback?code=c&installation_id=${again}&state=${encodeURIComponent(state)}`
    );
    const conns = (
      await env.call("GET", "/v1/connections", { token: owner.token })
    ).body;
    expect(conns).toHaveLength(1);
    expect(conns[0]).toMatchObject({
      id: conn.id,
      name: "Acme code",
      status: "active",
      externalId: again,
      settings: { repos: ["acme/api"] },
    });
  });

  test("going through the install page again keeps an admin's pause", async () => {
    const { owner, conn, installationId } = await installed();
    await env.call("PATCH", `/v1/connections/${conn.id}`, {
      token: owner.token,
      body: { status: "paused" },
    });
    env.ctx.fetch = github(installationId);
    const link = await env.call("POST", "/v1/apps/github/install", {
      token: owner.token,
    });
    const state = new URL(link.body.url).searchParams.get("state") ?? "";
    await env.app.request(
      `/oauth/github/callback?code=c&installation_id=${installationId}&setup_action=update&state=${encodeURIComponent(state)}`
    );
    const [after] = (
      await env.call("GET", "/v1/connections", { token: owner.token })
    ).body;
    expect(after.status).toBe("paused");
  });

  test("an app another process registered is seen at once", async () => {
    await env.ctx.db.execute(
      sql`delete from connector_apps where provider = 'github'`
    );
    forgetCachedApps();
    expect(await loadApp(env.ctx, "github")).toBeNull();
    await env.ctx.db.execute(sql`
      insert into connector_apps (provider, app_id, slug, credentials, created_via)
      values ('github', '9', 'elsewhere', ${env.ctx.secrets.seal({ clientId: "x" })}, 'manual')`);
    expect((await loadApp(env.ctx, "github"))?.slug).toBe("elsewhere");
    await env.ctx.db.execute(
      sql`delete from connector_apps where provider = 'github'`
    );
    forgetCachedApps();
  });

  test("a rate-limited sync waits and says why", async () => {
    const owner = await env.workspace();
    await registerApp(owner);
    const installationId = String(randomInt(1_000_000, 900_000_000));
    env.ctx.fetch = github(installationId, [
      [
        "POST https://api.github.com/graphql",
        () =>
          new Response("slow down", {
            status: 429,
            headers: { "retry-after": "120" },
          }),
      ],
    ]);
    const link = await env.call("POST", "/v1/apps/github/install", {
      token: owner.token,
    });
    const state = new URL(link.body.url).searchParams.get("state") ?? "";
    await env.app.request(
      `/oauth/github/callback?code=c&installation_id=${installationId}&state=${encodeURIComponent(state)}`
    );
    await env.drain();
    const [conn] = (
      await env.call("GET", "/v1/connections", { token: owner.token })
    ).body;
    const health = (
      await env.call("GET", `/v1/connections/${conn.id}/health`, {
        token: owner.token,
      })
    ).body;
    expect(
      health.sync.find((c: any) => c.stream === "repo:acme/api")
    ).toMatchObject({
      stream: "repo:acme/api",
      state: "running",
      error: expect.stringContaining("rate limited"),
    });
    expect(conn.status).toBe("active");
  });

  test("GitHub refusing the app's own credentials revokes no installation", async () => {
    const { owner, conn } = await installed();
    env.ctx.fetch = routedFetch([
      [
        "POST https://api.github.com/app/installations/",
        () => new Response("bad credentials", { status: 401 }),
      ],
    ]);
    forgetToken(
      {
        provider: "github",
        appId: "4242",
        slug: null,
        name: null,
        credentials: {},
      },
      conn.externalId
    );
    await env.call("POST", `/v1/connections/${conn.id}/sync`, {
      token: owner.token,
    });
    await env.drain();
    const health = (
      await env.call("GET", `/v1/connections/${conn.id}/health`, {
        token: owner.token,
      })
    ).body;
    expect(health.status).toBe("active");
    expect(health.sync.find((c: any) => c.stream === "*").error).toContain(
      "refused the app's credentials"
    );
  });

  test("an app from the environment follows it when its secrets change there", async () => {
    await env.ctx.db.execute(
      sql`delete from connector_apps where provider = 'github'`
    );
    forgetCachedApps();
    const { config } = env.ctx;
    const fromEnv = {
      GITHUB_APP_ID: "7",
      GITHUB_APP_SLUG: "from-env",
      GITHUB_APP_PRIVATE_KEY: pem,
      GITHUB_APP_WEBHOOK_SECRET: "first",
      GITHUB_CLIENT_ID: "Iv1.env",
      GITHUB_CLIENT_SECRET: "env-secret",
    };
    const saved = Object.fromEntries(
      Object.keys(fromEnv).map((k) => [k, Reflect.get(config, k)])
    );
    Object.assign(config, fromEnv);
    try {
      expect(
        (await loadApp(env.ctx, "github"))?.credentials.webhookSecret
      ).toBe("first");
      config.GITHUB_APP_WEBHOOK_SECRET = "rotated";
      forgetCachedApps();
      expect(
        (await loadApp(env.ctx, "github"))?.credentials.webhookSecret
      ).toBe("rotated");
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        Reflect.set(config, k, v);
      }
      await env.ctx.db.execute(
        sql`delete from connector_apps where provider = 'github'`
      );
      forgetCachedApps();
    }
  });

  test("a registered app signs people in too, unless the environment says otherwise", () => {
    const row = {
      provider: "github",
      appId: "1",
      slug: "s",
      name: "n",
      credentials: env.ctx.secrets.seal({
        clientId: "Iv1.app",
        clientSecret: "app-secret",
      }),
      createdVia: "manual" as const,
      unrouted: 0,
      lastUnroutedAt: null,
      rejections: 0,
      lastRejectedAt: null,
      lastRejection: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const bare = {
      ...env.ctx.config,
      GITHUB_CLIENT_ID: undefined,
      GITHUB_CLIENT_SECRET: undefined,
    };
    expect(withAppSignIn(bare, [row], env.ctx.secrets)).toMatchObject({
      GITHUB_CLIENT_ID: "Iv1.app",
      GITHUB_CLIENT_SECRET: "app-secret",
    });
    const set = {
      ...bare,
      GITHUB_CLIENT_ID: "Iv1.env",
      GITHUB_CLIENT_SECRET: "env",
    };
    expect(withAppSignIn(set, [row], env.ctx.secrets).GITHUB_CLIENT_ID).toBe(
      "Iv1.env"
    );
    const half = withAppSignIn(
      { ...bare, GITHUB_CLIENT_ID: "Iv1.env" },
      [row],
      env.ctx.secrets
    );
    expect(half.GITHUB_CLIENT_ID).toBe("Iv1.env");
    expect(half.GITHUB_CLIENT_SECRET).toBeUndefined();
  });

  test("the app `bun run github-app` creates installs anywhere and points back at the server", async () => {
    const manifest = githubManifest("https://worklog.example", "Worklog", {
      public: true,
      redirectUrl: "http://localhost:4590/done",
    });
    expect(manifest).toMatchObject({
      public: true,
      hook_attributes: {
        url: "https://worklog.example/hooks/apps/github",
        active: true,
      },
      redirect_url: "http://localhost:4590/done",
      callback_urls: [
        "https://worklog.example/oauth/github/callback",
        "https://worklog.example/api/auth/callback/github",
      ],
      request_oauth_on_install: true,
    });
    const app = await convertManifest(
      {
        now: () => new Date(),
        fetch: routedFetch([
          [
            "POST https://api.github.com/app-manifests/m-code/conversions",
            () => ({
              id: 5150,
              slug: "worklog",
              name: "Worklog",
              client_id: "Iv1.new",
              client_secret: "new-secret",
              webhook_secret: "new-hook-secret",
              pem,
            }),
          ],
        ]),
      },
      "m-code"
    );
    expect(app).toMatchObject({
      appId: "5150",
      slug: "worklog",
      credentials: { clientId: "Iv1.new", webhookSecret: "new-hook-secret" },
    });
  });

  test("registering an app on a server with several workspaces takes the setup secret", async () => {
    await env.workspace("Elsewhere");
    const owner = await env.workspace();
    const res = await env.call("PUT", "/v1/apps/github", {
      token: owner.token,
      body: { credentials: {} },
    });
    expect(res.status).toBe(403);
  });
});
