import { expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import type { AppContext } from "#context";
import type { StoredEvent } from "#db/queries/events";
import { insertMembers } from "#db/queries/members";
import { getWorkspaceById, insertWorkspace } from "#db/queries/workspaces";
import { events } from "#db/schema";
import { transact } from "#db/transact";
import { ApiError } from "#lib/errors";
import { newId } from "#lib/ids";

import { testEnv } from "./harness";

async function failure(promise: Promise<unknown>) {
  return await promise.then(
    () => null,
    (error_: unknown) => error_
  );
}

function workspaceRow(ctx: AppContext) {
  const id = newId("ws");
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
      id: newId("mem"),
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
