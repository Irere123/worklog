import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Pool } from "pg";

import { migrate } from "#db/migrate";

import { freshDatabase } from "./harness";

const pools: Pool[] = [];

afterEach(async () => {
  await Promise.all(
    pools.splice(0).map(async (p) => {
      await p.end();
    })
  );
});

function migrations(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "worklog-migrations-"));
  mkdirSync(path.join(dir, "meta"));
  const entries = Object.entries(files).map(([tag, sql], idx) => {
    writeFileSync(path.join(dir, `${tag}.sql`), sql);
    return { idx, version: "7", when: 1000 + idx, tag, breakpoints: true };
  });
  writeFileSync(
    path.join(dir, "meta/_journal.json"),
    JSON.stringify({ version: "7", dialect: "postgresql", entries })
  );
  return dir;
}

function connect(url: string) {
  const p = new Pool({ connectionString: url });
  pools.push(p);
  return p;
}

async function failure(promise: Promise<unknown>) {
  return await promise.then(
    () => null,
    (error_: unknown) => error_
  );
}

async function indexValid(p: Pool, name: string) {
  const { rows } = await p.query(
    "select i.indisvalid as valid from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname = $1",
    [name]
  );
  return rows[0]?.valid;
}

test("processes starting together migrate once, building a concurrent index outside a transaction", async () => {
  const dir = migrations({
    "0000_table": `CREATE TABLE "t" ("id" text PRIMARY KEY, "n" integer);`,
    "0001_index": `CREATE INDEX CONCURRENTLY "t_n_idx" ON "t" USING btree ("n");`,
  });
  const url = await freshDatabase("worklog_test_migrate");
  const api = connect(url);
  const worker = connect(url);
  await Promise.all([migrate(api, dir), migrate(worker, dir)]);
  const { rows } = await api.query(
    "select count(*)::int as n from drizzle.__drizzle_migrations"
  );
  expect(rows[0].n).toBe(2);
  expect(await indexValid(api, "t_n_idx")).toBe(true);
});

test("a migration that mixes a concurrent index with other statements is refused", async () => {
  const dir = migrations({
    "0000_mixed": `CREATE TABLE "t" ("n" integer);\n--> statement-breakpoint\nCREATE INDEX CONCURRENTLY "t_n_idx" ON "t" ("n");`,
  });
  const p = connect(await freshDatabase("worklog_test_migrate"));
  expect(await failure(migrate(p, dir))).toHaveProperty(
    "message",
    expect.stringContaining("generate the index on its own")
  );
});

test("an index left invalid by a failed concurrent build is rebuilt on the next start", async () => {
  const dir = migrations({
    "0000_table": `CREATE TABLE "t" ("n" integer);\n--> statement-breakpoint\nINSERT INTO "t" VALUES (1), (1);`,
    "0001_unique": `CREATE UNIQUE INDEX CONCURRENTLY "t_n_uq" ON "t" ("n");`,
  });
  const p = connect(await freshDatabase("worklog_test_migrate"));
  expect(await failure(migrate(p, dir))).toBeInstanceOf(Error);
  expect(await indexValid(p, "t_n_uq")).toBe(false);

  await p.query(`DELETE FROM "t" WHERE ctid <> (SELECT min(ctid) FROM "t")`);
  await migrate(p, dir);
  expect(await indexValid(p, "t_n_uq")).toBe(true);
});
