import { beforeAll, describe, expect, test } from "bun:test";
import { setTimeout as sleep } from "node:timers/promises";

import type { Db } from "#db";
import type { StoredEvent } from "#db/queries/events";
import { EventBus } from "#events";

import { testEnv } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});

describe("realtime across processes", () => {
  test("an event another process publishes reaches this one's listeners, once", async () => {
    const owner = await env.workspace();
    const workspaceId = owner.workspace.id as string;
    // A second process's bus: its own listeners, the same database.
    const elsewhere = new EventBus(env.ctx.db as Db);
    const got: StoredEvent[] = [];
    // Published before it started listening: history, not news.
    await env.ctx.bus.publish({
      workspaceId,
      type: "activity.created",
      data: { id: "act_old" },
    });
    const stop = await elsewhere.listen();
    const unsubscribe = elsewhere.subscribe((e) => {
      if (e.workspaceId === workspaceId) {
        got.push(e);
      }
    });
    try {
      await env.ctx.bus.publish({
        workspaceId,
        type: "activity.created",
        data: { id: "act_remote" },
      });
      await elsewhere.publish({
        workspaceId,
        type: "activity.created",
        data: { id: "act_local" },
      });
      for (let i = 0; i < 50 && got.length < 2; i += 1) {
        await sleep(50);
      }
      await sleep(200);
    } finally {
      unsubscribe();
      await stop();
    }
    expect(
      got.map((e) => String(e.data.id)).toSorted((x, y) => x.localeCompare(y))
    ).toEqual(["act_local", "act_remote"]);
  });

  test("stopping waits for a read under way, and nothing is sent twice after", async () => {
    const owner = await env.workspace();
    const workspaceId = owner.workspace.id as string;
    const elsewhere = new EventBus(env.ctx.db as Db);
    const got: StoredEvent[] = [];
    const unsubscribe = elsewhere.subscribe((e) => {
      if (e.workspaceId === workspaceId) {
        got.push(e);
      }
    });
    const stop = await elsewhere.listen({ everyMs: 10 });
    // Holds every read of the table until released.
    const blocker = await env.ctx.pool.connect();
    await blocker.query("begin");
    await blocker.query("lock table events in access exclusive mode");
    await sleep(100);
    const stopping = stop();
    const first = await Promise.race([
      stopping.then(() => "stopped"),
      sleep(100).then(() => "still reading"),
    ]);
    expect(first).toBe("still reading");
    await blocker.query("commit");
    blocker.release();
    await stopping;
    try {
      await elsewhere.publish({
        workspaceId,
        type: "activity.created",
        data: { id: "act_after" },
      });
      await sleep(100);
    } finally {
      unsubscribe();
    }
    expect(got.map((e) => String(e.data.id))).toEqual(["act_after"]);
  });
});
