import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { DbOrTx } from "#db";
import { memories } from "#db/schema";
import type { MemoryKind, Visibility } from "#db/schema";

export type MemoryRow = typeof memories.$inferSelect;

const TYPO_TOLERANCE = 0.3;
const MAX_TERMS = 8;
const MAX_LINEAGE = 200;

const searchable = sql`${memories.content} || ' ' || array_to_string(${memories.aliases}, ' ')`;

export async function listMemories(
  db: DbOrTx,
  params: {
    memberId: string;
    includePrivate: boolean;
    now: Date;
    kinds?: MemoryKind[];
    since?: string;
    createdAfter?: Date;
    confirmedOnly?: boolean;
    q?: string;
    limit?: number;
  }
) {
  const where: (SQL | undefined)[] = [
    eq(memories.memberId, params.memberId),
    eq(memories.status, "active"),
    current(params.now),
  ];
  if (params.createdAfter) {
    where.push(gt(memories.createdAt, params.createdAfter));
  }
  if (!params.includePrivate) {
    where.push(eq(memories.visibility, "team"));
  }
  if (params.confirmedOnly === true) {
    where.push(eq(memories.confirmed, true));
  }
  if (params.kinds && params.kinds.length > 0) {
    where.push(inArray(memories.kind, params.kinds));
  }
  if (params.since) {
    where.push(gte(memories.day, params.since));
  }
  const terms = searchTerms(params.q);
  const loose = terms.map((t) => sql`word_similarity(${t}, ${searchable})`);
  const strict = terms.map(
    (t) => sql`strict_word_similarity(${t}, ${searchable})`
  );
  if (terms.length) {
    where.push(or(...loose.map((s) => sql`${s} >= ${TYPO_TOLERANCE}`)));
  }
  return await db
    .select()
    .from(memories)
    .where(and(...where))
    .orderBy(
      ...(terms.length
        ? [desc(sql.join(strict, sql` + `)), desc(sql.join(loose, sql` + `))]
        : []),
      desc(memories.updatedAt)
    )
    .limit(params.limit ?? 100);
}

export async function listActiveMemoryIds(
  db: DbOrTx,
  params: {
    memberId: string;
    kind: MemoryKind;
    visibility: Visibility;
    day?: string;
  }
) {
  const rows = await db
    .select({ id: memories.id })
    .from(memories)
    .where(
      and(
        eq(memories.memberId, params.memberId),
        eq(memories.kind, params.kind),
        eq(memories.visibility, params.visibility),
        params.day ? eq(memories.day, params.day) : undefined,
        eq(memories.status, "active")
      )
    );
  return rows.map((r) => r.id);
}

export async function findDigest(
  db: DbOrTx,
  params: { memberId: string; visibility: Visibility }
) {
  const [row] = await db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.memberId, params.memberId),
        eq(memories.kind, "digest"),
        eq(memories.visibility, params.visibility),
        eq(memories.status, "active")
      )
    )
    .orderBy(desc(memories.createdAt))
    .limit(1);
  return row;
}

export async function listForgottenSince(
  db: DbOrTx,
  params: {
    memberId: string;
    includePrivate: boolean;
    since: Date;
    limit: number;
  }
) {
  return await db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.memberId, params.memberId),
        eq(memories.status, "superseded"),
        isNull(memories.supersededBy),
        inArray(memories.kind, ["profile", "fact"]),
        gt(memories.updatedAt, params.since),
        params.includePrivate ? undefined : eq(memories.visibility, "team")
      )
    )
    .orderBy(desc(memories.updatedAt))
    .limit(params.limit);
}

export async function listReconcilable(
  db: DbOrTx,
  params: { memberId: string; visibility: Visibility; now: Date }
) {
  return await db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.memberId, params.memberId),
        eq(memories.visibility, params.visibility),
        inArray(memories.kind, ["profile", "fact"]),
        eq(memories.status, "active"),
        current(params.now)
      )
    )
    .orderBy(asc(memories.createdAt))
    .limit(300);
}

export async function insertMemory(db: DbOrTx, row: MemoryRow) {
  await db.insert(memories).values(row);
}

export async function setMemoriesSuperseded(
  db: DbOrTx,
  params: { memberId: string; ids: string[]; supersededBy?: string; now: Date }
) {
  if (!params.ids.length) {
    return [];
  }
  return await db
    .update(memories)
    .set({
      status: "superseded",
      supersededBy: params.supersededBy ?? null,
      updatedAt: params.now,
    })
    .where(
      and(
        eq(memories.memberId, params.memberId),
        inArray(memories.id, params.ids),
        eq(memories.status, "active")
      )
    )
    .returning();
}

export async function setMemoriesConfirmed(
  db: DbOrTx,
  params: { memberId: string; ids: string[]; now: Date }
) {
  if (!params.ids.length) {
    return [];
  }
  return await db
    .update(memories)
    .set({ confirmed: true, updatedAt: params.now })
    .where(
      and(
        eq(memories.memberId, params.memberId),
        inArray(memories.id, params.ids),
        eq(memories.status, "active"),
        eq(memories.confirmed, false)
      )
    )
    .returning();
}

export async function listMemoryLineage(
  db: DbOrTx,
  params: { memberId: string; id: string }
) {
  const lineage = sql`
    with recursive
      earlier(id) as (
        select ${params.id}::text
        union
        select m.id from memories m join earlier e on m.superseded_by = e.id
        where m.member_id = ${params.memberId}
      ),
      later(id) as (
        select ${params.id}::text
        union
        select m.superseded_by from memories m join later l on m.id = l.id
        where m.member_id = ${params.memberId} and m.superseded_by is not null
      )
    select id from earlier union select id from later`;
  return await db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.memberId, params.memberId),
        sql`${memories.id} in (${lineage})`
      )
    )
    .orderBy(asc(memories.createdAt), asc(memories.id))
    .limit(MAX_LINEAGE);
}

function current(now: Date) {
  return or(isNull(memories.expiresAt), gt(memories.expiresAt, now));
}

function searchTerms(q: string | undefined) {
  const words = (q ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1);
  return [...new Set(words)].slice(0, MAX_TERMS);
}
