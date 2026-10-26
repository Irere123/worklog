import { expect, test } from "bun:test";

import { sql } from "drizzle-orm";

import { activities } from "../src/db/schema";
import { testEnv } from "./harness";

// Guards against drivers that store jsonb as strings: reads look fine, but SQL can't see inside.
test("jsonb is stored as JSON (queryable in SQL), not as a string", async () => {
  const env = await testEnv();
  const { workspace } = await env.workspace();
  const { db } = env.ctx;
  await db.insert(activities).values({
    id: "act_pg",
    workspaceId: workspace.id,
    actorId: null,
    source: "github",
    kind: "pr.merged",
    title: "t",
    data: { repo: "acme/api" },
  });
  const result = await db.execute<{ type: string; repo: string }>(
    sql`select jsonb_typeof(data) as type, data->>'repo' as repo from activities where id = 'act_pg'`
  );
  expect(result.rows[0]).toEqual({ type: "object", repo: "acme/api" });
});
