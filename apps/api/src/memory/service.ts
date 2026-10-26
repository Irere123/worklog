import { and, desc, eq, gte, ilike, inArray } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { AppContext } from "#context";
import { memories } from "#db/schema";
import type { MemoryKind, Visibility } from "#db/schema";
import { notFound } from "#lib/errors";
import { newId } from "#lib/ids";

export type MemoryRow = typeof memories.$inferSelect;

// Visibility is enforced here, in the query, never by prompt: teammates only ever get `team` rows.
export async function listMemories(
  ctx: AppContext,
  memberId: string,
  opts: {
    kinds?: MemoryKind[];
    includePrivate: boolean;
    since?: string;
    q?: string;
    limit?: number;
  }
) {
  const where: SQL[] = [
    eq(memories.memberId, memberId),
    eq(memories.status, "active"),
  ];
  if (!opts.includePrivate) {
    where.push(eq(memories.visibility, "team"));
  }
  if (opts.kinds && opts.kinds.length > 0) {
    where.push(inArray(memories.kind, opts.kinds));
  }
  if (opts.since) {
    where.push(gte(memories.day, opts.since));
  }
  if (opts.q) {
    where.push(ilike(memories.content, `%${opts.q}%`));
  }
  return await ctx.db
    .select()
    .from(memories)
    .where(and(...where))
    .orderBy(desc(memories.updatedAt))
    .limit(opts.limit ?? 100);
}

export async function addMemory(
  ctx: AppContext,
  input: {
    workspaceId: string;
    memberId: string;
    kind: MemoryKind;
    content: string;
    visibility?: Visibility;
    source: MemoryRow["source"];
    day?: string | null;
    supersedes?: string[];
  }
) {
  const now = ctx.now();
  const row: MemoryRow = {
    id: newId("mmr"),
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    kind: input.kind,
    content: input.content.trim(),
    visibility: input.visibility ?? "team",
    status: "active",
    day: input.day ?? null,
    source: input.source,
    createdAt: now,
    updatedAt: now,
  };
  await ctx.db.insert(memories).values(row);
  if (input.supersedes && input.supersedes.length > 0) {
    await ctx.db
      .update(memories)
      .set({ status: "superseded", updatedAt: now })
      .where(
        and(
          eq(memories.memberId, input.memberId),
          inArray(memories.id, input.supersedes)
        )
      );
  }
  return row;
}

export async function writeJournal(
  ctx: AppContext,
  workspaceId: string,
  memberId: string,
  day: string,
  content: string,
  visibility: Visibility
) {
  const existing = await ctx.db
    .select({ id: memories.id })
    .from(memories)
    .where(
      and(
        eq(memories.memberId, memberId),
        eq(memories.kind, "journal"),
        eq(memories.day, day),
        eq(memories.visibility, visibility),
        eq(memories.status, "active")
      )
    );
  return await addMemory(ctx, {
    workspaceId,
    memberId,
    kind: "journal",
    content,
    day,
    visibility,
    source: "agent",
    supersedes: existing.map((e) => e.id),
  });
}

export async function forgetMemory(
  ctx: AppContext,
  memberId: string,
  id: string
) {
  const [row] = await ctx.db
    .update(memories)
    .set({ status: "superseded", updatedAt: ctx.now() })
    .where(and(eq(memories.id, id), eq(memories.memberId, memberId)))
    .returning();
  if (!row) {
    throw notFound("Memory");
  }
  return row;
}

export async function renderMemory(
  ctx: AppContext,
  memberId: string,
  includePrivate: boolean,
  journalDays = 3
) {
  const [profile, facts, journal] = await Promise.all([
    listMemories(ctx, memberId, {
      kinds: ["profile"],
      includePrivate,
      limit: 40,
    }),
    listMemories(ctx, memberId, { kinds: ["fact"], includePrivate, limit: 60 }),
    listMemories(ctx, memberId, {
      kinds: ["journal"],
      includePrivate,
      limit: journalDays,
    }),
  ]);
  return [
    section("Profile", profile, (r) => `- ${r.content} [${r.id}]`),
    section("Facts", facts, (r) => `- ${r.content} [${r.id}]`),
    section("Recent journal", journal, (r) => `### ${r.day}\n${r.content}`),
  ].join("\n\n");
}

function section(
  title: string,
  rows: MemoryRow[],
  fmt: (r: MemoryRow) => string
) {
  return rows.length
    ? `## ${title}\n${rows.map(fmt).join("\n")}`
    : `## ${title}\n(nothing yet)`;
}
