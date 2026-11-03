import { beforeAll, describe, expect, test } from "bun:test";

import { loadConfig } from "#config";
import { exitWhenRunnerStops } from "#jobs/tasks";

import { testEnv } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});

const SECRETS = {
  WORKLOG_SECRET_KEY: "a".repeat(64),
  AUTH_SECRET: "b".repeat(64),
};

describe("production settings", () => {
  test("production names everything it's missing instead of starting half set up", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(
      "WORKLOG_SECRET_KEY, AUTH_SECRET, PUBLIC_URL required in production"
    );
    expect(() =>
      loadConfig({ NODE_ENV: "production", ...SECRETS, PUBLIC_URL: "" })
    ).toThrow("PUBLIC_URL required in production");
  });

  test("on Railway, the public address and the release come from the deployment", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      ...SECRETS,
      RAILWAY_PUBLIC_DOMAIN: "worklog-production.up.railway.app",
      RAILWAY_GIT_COMMIT_SHA: "9fceb02",
    });
    expect(config.PUBLIC_URL).toBe("https://worklog-production.up.railway.app");
    expect(config.WORKLOG_RELEASE).toBe("9fceb02");
  });

  test("what's set explicitly wins over what the platform provides", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      ...SECRETS,
      PUBLIC_URL: "https://worklog.example.com",
      RAILWAY_PUBLIC_DOMAIN: "worklog-production.up.railway.app",
      WORKLOG_RELEASE: "v1.2.0",
      RAILWAY_GIT_COMMIT_SHA: "9fceb02",
    });
    expect(config.PUBLIC_URL).toBe("https://worklog.example.com");
    expect(config.WORKLOG_RELEASE).toBe("v1.2.0");
  });
});

describe("health", () => {
  test("says the database answers, and which release is running", async () => {
    const res = await env.app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      db: true,
      release: env.ctx.config.WORKLOG_RELEASE,
    });
  });

  test("answers 503 once the database stops answering", async () => {
    const { db } = env.ctx;
    const broken = Object.create(db) as typeof db;
    broken.execute = (async () => {
      await Promise.resolve();
      throw new Error("connection terminated");
    }) as unknown as typeof db.execute;
    const res = await env.app.request("/health");
    expect(res.status).toBe(200);
    env.ctx.db = broken;
    try {
      const down = await env.app.request("/health");
      expect(down.status).toBe(503);
      expect(await down.json()).toMatchObject({ ok: false, db: false });
    } finally {
      env.ctx.db = db;
    }
  });
});

describe("a process whose job runner stops", () => {
  test("exits when the runner stops on its own or fails", async () => {
    let exits = 0;
    const exit = async () => {
      await Promise.resolve();
      exits += 1;
    };
    await exitWhenRunnerStops(Promise.resolve(), {
      stopping: () => false,
      exit,
    });
    await exitWhenRunnerStops(Promise.reject(new Error("lost the database")), {
      stopping: () => false,
      exit,
    });
    expect(exits).toBe(2);
  });

  test("doesn't when it was asked to stop", async () => {
    let exits = 0;
    await exitWhenRunnerStops(Promise.resolve(), {
      stopping: () => true,
      exit: async () => {
        await Promise.resolve();
        exits += 1;
      },
    });
    expect(exits).toBe(0);
  });
});
