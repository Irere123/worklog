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

// word_similarity is 1 for a word that appears as written and about 0.33 for a one-letter typo in a
// short word ("pazta" against "pasta"); unrelated words score 0. It matches; strict_word_similarity,
// which respects word boundaries, ranks, so "pazta" puts pasta above payment though both match.
const TYPO_TOLERANCE = 0.3;
const MAX_TERMS = 8;

const searchable = sql`${memories.content} || ' ' || array_to_string(${memories.aliases}, ' ')`;

// Visibility is enforced here, in the query, never by prompt: teammates only ever get `team` rows.
// `q` matches word by word, so "who owns payments" finds "Owns the payment service" and a
// misspelling still finds its memory. A member's memories are few, so it scans them without an index.
export async function listMemories(
  db: DbOrTx,
  params: {
    memberId: string;
    includePrivate: boolean;
    now: Date;
    kinds?: MemoryKind[];
    since?: string;
    q?: string;
    limit?: number;
  }
) {
  const where: (SQL | undefined)[] = [
    eq(memories.memberId, params.memberId),
    eq(memories.status, "active"),
    current(params.now),
  ];
  if (!params.includePrivate) {
    where.push(eq(memories.visibility, "team"));
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

// The active entries of one kind and visibility (and day, for journals) that a new one replaces.
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

// Exactly one visibility, so tidying team memory never reads private lines.
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

// Scoped to the member, so ids from another member's memory match nothing.
export async function setMemoriesSuperseded(
  db: DbOrTx,
  params: { memberId: string; ids: string[]; now: Date }
) {
  if (!params.ids.length) {
    return [];
  }
  return await db
    .update(memories)
    .set({ status: "superseded", updatedAt: params.now })
    .where(
      and(
        eq(memories.memberId, params.memberId),
        inArray(memories.id, params.ids)
      )
    )
    .returning();
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
