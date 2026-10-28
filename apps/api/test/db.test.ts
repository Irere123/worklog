import { describe, expect, setSystemTime, test } from "bun:test";

import { eq, sql } from "drizzle-orm";

import type { AppContext } from "#context";
import type { StoredEvent } from "#db/queries/events";
import { insertMembers } from "#db/queries/members";
import { getWorkspaceById, insertWorkspace } from "#db/queries/workspaces";
import { events } from "#db/schema";
import { transact } from "#db/transact";
import { SecretBox } from "#lib/crypto";
import { ApiError } from "#lib/errors";
import { generateId } from "#lib/ids";

import { testEnv } from "./harness";

async function failure(promise: Promise<unknown>) {
  return await promise.then(
    () => null,
    (error_: unknown) => error_
  );
}

function workspaceRow(ctx: AppContext) {
  const id = generateId();
  return {
    id,
    name: "Rollback",
    slug: id,
    timezone: "UTC",
    entropyDays: 30,
    cardSeq: 0,
    createdAt: ctx.now(),
  };
}

test("transact rolls back every write when the callback throws", async () => {
  const { ctx } = await testEnv();
  const row = workspaceRow(ctx);
  const failed = transact(ctx, async (tx) => {
    await insertWorkspace(tx.db, row);
    throw new Error("boom");
  });
  expect(await failure(failed)).toHaveProperty("message", "boom");
  expect(
    await failure(getWorkspaceById(ctx.db, { id: row.id }))
  ).toHaveProperty("status", 404);
});

test("a nested transact joins the outer transaction", async () => {
  const { ctx } = await testEnv();
  const row = workspaceRow(ctx);
  const failed = transact(ctx, async (outer) => {
    await transact(outer, async (inner) => {
      await insertWorkspace(inner.db, row);
    });
    throw new Error("outer failed");
  });
  expect(await failure(failed)).toHaveProperty("message", "outer failed");
  expect(
    await failure(getWorkspaceById(ctx.db, { id: row.id }))
  ).toHaveProperty("status", 404);
});

test("a write that committed stays a success when its events can't be published", async () => {
  const { ctx } = await testEnv();
  const row = workspaceRow(ctx);
  await ctx.db.execute(
    sql.raw(`
      create function test_events_down() returns trigger language plpgsql
        as $$ begin raise exception 'events down'; end $$;
      create trigger test_events_down before insert on events
        execute function test_events_down();
    `)
  );
  try {
    await transact(ctx, async (tx) => {
      await insertWorkspace(tx.db, row);
      await tx.bus.publish({
        workspaceId: row.id,
        type: "card.updated",
        data: {},
      });
    });
  } finally {
    await ctx.db.execute(
      sql.raw(`
        drop trigger test_events_down on events;
        drop function test_events_down();
      `)
    );
  }
  expect((await getWorkspaceById(ctx.db, { id: row.id })).id).toBe(row.id);
});

test("events publish after the commit, and not at all after a rollback", async () => {
  const env = await testEnv();
  const { workspace } = await env.workspace();
  const seen: StoredEvent[] = [];
  const unsubscribe = env.ctx.bus.subscribe((e) => {
    if (e.workspaceId === workspace.id) {
      seen.push(e);
    }
  });
  try {
    await transact(env.ctx, async (tx) => {
      await tx.bus.publish({
        workspaceId: workspace.id,
        type: "card.updated",
        data: { committed: true },
      });
      expect(seen).toHaveLength(0);
    });
    expect(seen.map((e) => e.data)).toEqual([{ committed: true }]);

    await transact(env.ctx, async (tx) => {
      await tx.bus.publish({
        workspaceId: workspace.id,
        type: "card.updated",
        data: { committed: false },
      });
      throw new Error("rolled back");
    }).catch(() => null);
    const stored = await env.ctx.db
      .select()
      .from(events)
      .where(eq(events.workspaceId, workspace.id));
    expect(stored.map((e) => e.data)).toEqual([{ committed: true }]);
    expect(seen).toHaveLength(1);
  } finally {
    unsubscribe();
  }
});

test("a taken handle is a conflict, not a database error", async () => {
  const env = await testEnv();
  const { workspace, member } = await env.workspace();
  const duplicate = insertMembers(env.ctx.db, [
    {
      id: generateId(),
      workspaceId: workspace.id,
      kind: "human",
      name: "Twin",
      handle: member.handle,
      createdAt: env.ctx.now(),
    },
  ]);
  const error = await failure(duplicate);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toHaveProperty("status", 409);
});

describe("secret keys", () => {
  const a = "a".repeat(64);
  const b = "b".repeat(64);

  test("a rotated key still opens what it sealed, and says it's stale", () => {
    const sealed = new SecretBox(a).seal({ token: "t1" });
    const rotated = new SecretBox(b, [a]);
    expect(rotated.open(sealed)).toEqual({ token: "t1" });
    expect(rotated.stale(sealed)).toBe(true);
    const resealed = rotated.seal(rotated.open(sealed));
    expect(rotated.stale(resealed)).toBe(false);
    expect(() => new SecretBox(b).open(sealed)).toThrow("isn't configured");
  });

  test("values sealed before key ids still open", () => {
    const box = new SecretBox(a);
    const v2 = box.seal({ token: "t2" });
    const legacy = v2.split(".").slice(2).join(".");
    expect(new SecretBox(b, [a]).open(legacy)).toEqual({ token: "t2" });
  });
});

describe("ids", () => {
  test("are KSUIDs, ordered by the second they were made", () => {
    try {
      setSystemTime(new Date("2026-10-28T12:00:00.900Z"));
      const first = generateId();
      setSystemTime(new Date("2026-10-28T12:00:01.000Z"));
      const later = generateId();
      expect(first).toMatch(/^[0-9A-Za-z]{27}$/u);
      expect(first < later).toBe(true);
    } finally {
      setSystemTime();
    }
  });
});
