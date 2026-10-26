import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { openDb, type Db } from "../src/db";
import { activities, workspaces } from "../src/db/schema";

/**
 * The production driver path (postgres:// → node-postgres, migrations included) over the real
 * Postgres wire protocol, served by PGlite. Guards against drivers that store jsonb as strings.
 */
let server: PGLiteSocketServer;
let pg: PGlite;
let opened: { db: Db; close: () => Promise<void> };

beforeAll(async () => {
  pg = new PGlite();
  server = new PGLiteSocketServer({ db: pg, port: 55433 });
  await server.start();
  opened = await openDb("postgres://postgres:postgres@127.0.0.1:55433/postgres");
});

afterAll(async () => {
  await opened?.close();
  await server?.stop();
  await pg?.close();
});

test("migrations run, and jsonb is stored as JSON (queryable in SQL), not as a string", async () => {
  const { db } = opened;
  await db.insert(workspaces).values({ id: "ws_pg", name: "PG", slug: "pg" });
  await db.insert(activities).values({ id: "act_pg", workspaceId: "ws_pg", actorId: null, source: "github", kind: "pr.merged", title: "t", data: { repo: "acme/api" } });
  const result = await db.execute(sql`select jsonb_typeof(data) as type, data->>'repo' as repo from activities where id = 'act_pg'`);
  const row = (result as unknown as { rows: { type: string; repo: string }[] }).rows[0]!;
  expect(row).toEqual({ type: "object", repo: "acme/api" });
});
