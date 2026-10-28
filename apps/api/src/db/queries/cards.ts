import { and, asc, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { DbOrTx } from "#db";
import { violates } from "#db/errors";
import {
  boards,
  cardAssignees,
  cards,
  cardTags,
  cardWatchers,
  columns,
  comments,
  members,
  tags,
  workspaces,
} from "#db/schema";
import type { CardStage } from "#db/schema";
import { returned } from "#lib/assert";
import { conflict, notFound } from "#lib/errors";
import { generateId } from "#lib/ids";

export type CardRow = typeof cards.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;

export type CardFilters = {
  boardId?: string;
  stage?: CardStage;
  assigneeId?: string;
  golden?: boolean;
  tag?: string;
  q?: string;
  limit?: number;
};

export async function insertCard(db: DbOrTx, row: CardRow) {
  try {
    await db.insert(cards).values(row);
  } catch (error) {
    if (violates(error, "cards_external_uq")) {
      throw conflict("A card already tracks that external item");
    }
    throw error;
  }
}

// The workspace row is the counter. Take a number outside `transact`: inside, the row stays locked
// until commit, so every other card created in the workspace waits. A failed card leaves a gap.
export async function nextCardNumber(
  db: DbOrTx,
  params: { workspaceId: string }
) {
  const rows = await db
    .update(workspaces)
    .set({ cardSeq: sql`${workspaces.cardSeq} + 1` })
    .where(eq(workspaces.id, params.workspaceId))
    .returning({ number: workspaces.cardSeq });
  return returned(rows, "card number").number;
}

export async function getCardByNumber(
  db: DbOrTx,
  params: { workspaceId: string; number: number }
) {
  const [card] = await db
    .select()
    .from(cards)
    .where(
      and(
        eq(cards.workspaceId, params.workspaceId),
        eq(cards.number, params.number)
      )
    );
  if (!card) {
    throw notFound(`Card #${params.number}`);
  }
  return card;
}

export async function updateCardById(
  db: DbOrTx,
  params: { id: string; set: Partial<CardRow> }
) {
  await db.update(cards).set(params.set).where(eq(cards.id, params.id));
}

// Never backwards: activity read back from history is older than what the card has seen since.
export async function setCardActiveAt(
  db: DbOrTx,
  params: { id: string; at: Date }
) {
  await db
    .update(cards)
    .set({ lastActiveAt: sql`greatest(${cards.lastActiveAt}, ${params.at})` })
    .where(eq(cards.id, params.id));
}

export async function updateCardsByColumn(
  db: DbOrTx,
  params: { columnId: string; set: Partial<CardRow> }
) {
  await db
    .update(cards)
    .set(params.set)
    .where(eq(cards.columnId, params.columnId));
}

export async function listCardRows(
  db: DbOrTx,
  params: CardFilters & { workspaceId: string }
): Promise<CardRow[]> {
  const where: (SQL | undefined)[] = [
    eq(cards.workspaceId, params.workspaceId),
  ];
  if (params.boardId) {
    where.push(eq(cards.boardId, params.boardId));
  }
  if (params.stage) {
    where.push(eq(cards.stage, params.stage));
  }
  if (params.golden !== undefined) {
    where.push(eq(cards.golden, params.golden));
  }
  if (params.q) {
    where.push(
      or(
        ilike(cards.title, `%${params.q}%`),
        ilike(cards.body, `%${params.q}%`)
      )
    );
  }
  if (params.assigneeId) {
    where.push(
      inArray(
        cards.id,
        db
          .select({ id: cardAssignees.cardId })
          .from(cardAssignees)
          .where(eq(cardAssignees.memberId, params.assigneeId))
      )
    );
  }
  if (params.tag) {
    where.push(
      inArray(
        cards.id,
        db
          .select({ id: cardTags.cardId })
          .from(cardTags)
          .innerJoin(tags, eq(tags.id, cardTags.tagId))
          .where(
            and(
              eq(tags.workspaceId, params.workspaceId),
              eq(tags.name, params.tag.toLowerCase())
            )
          )
      )
    );
  }
  return await db
    .select()
    .from(cards)
    .where(and(...where))
    .orderBy(desc(cards.golden), desc(cards.lastActiveAt))
    .limit(params.limit ?? 200);
}

// Ecto's preload: one query per relation for a page of cards, never one per card. Sequential, not
// Promise.all: inside `transact` they share one connection, which can't run two queries at once.
export async function listCardRelations(
  db: DbOrTx,
  params: {
    workspaceId: string;
    cards: Pick<CardRow, "id" | "boardId">[];
  }
) {
  const ids = params.cards.map((c) => c.id);
  const boardIds = [...new Set(params.cards.map((c) => c.boardId))];
  const assignees = await db
    .select()
    .from(cardAssignees)
    .where(inArray(cardAssignees.cardId, ids));
  const tagRows = await db
    .select({ cardId: cardTags.cardId, name: tags.name })
    .from(cardTags)
    .innerJoin(tags, eq(tags.id, cardTags.tagId))
    .where(inArray(cardTags.cardId, ids));
  const columnRows = await db
    .select()
    .from(columns)
    .where(inArray(columns.boardId, boardIds));
  const boardRows = await db
    .select()
    .from(boards)
    .where(inArray(boards.id, boardIds));
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, params.workspaceId));
  return {
    assignees,
    tags: tagRows,
    columns: columnRows,
    boards: boardRows,
    workspace,
  };
}

export async function listComments(db: DbOrTx, params: { cardId: string }) {
  return await db
    .select()
    .from(comments)
    .where(eq(comments.cardId, params.cardId))
    .orderBy(asc(comments.createdAt));
}

export async function insertComment(db: DbOrTx, row: CommentRow) {
  await db.insert(comments).values(row);
}

export async function listWatchers(db: DbOrTx, params: { cardId: string }) {
  return await db
    .select()
    .from(cardWatchers)
    .where(eq(cardWatchers.cardId, params.cardId));
}

export async function insertWatcher(
  db: DbOrTx,
  params: { cardId: string; memberId: string }
) {
  await db.insert(cardWatchers).values(params).onConflictDoNothing();
}

export async function deleteWatcher(
  db: DbOrTx,
  params: { cardId: string; memberId: string }
) {
  await db
    .delete(cardWatchers)
    .where(
      and(
        eq(cardWatchers.cardId, params.cardId),
        eq(cardWatchers.memberId, params.memberId)
      )
    );
}

// False when the member was already assigned.
export async function insertAssignee(
  db: DbOrTx,
  params: { cardId: string; memberId: string }
) {
  const inserted = await db
    .insert(cardAssignees)
    .values(params)
    .onConflictDoNothing()
    .returning();
  return inserted.length > 0;
}

export async function deleteAssignee(
  db: DbOrTx,
  params: { cardId: string; memberId: string }
) {
  await db
    .delete(cardAssignees)
    .where(
      and(
        eq(cardAssignees.cardId, params.cardId),
        eq(cardAssignees.memberId, params.memberId)
      )
    );
}

// Several statements: run it inside `transact`. `names` are already trimmed, lowercase and unique.
export async function setCardTags(
  db: DbOrTx,
  params: { workspaceId: string; cardId: string; names: string[] }
) {
  const { workspaceId, cardId, names } = params;
  await db.delete(cardTags).where(eq(cardTags.cardId, cardId));
  if (!names.length) {
    return;
  }
  await db
    .insert(tags)
    .values(names.map((name) => ({ id: generateId(), workspaceId, name })))
    .onConflictDoNothing();
  const rows = await db
    .select()
    .from(tags)
    .where(and(eq(tags.workspaceId, workspaceId), inArray(tags.name, names)));
  // A concurrent call for the same card may have inserted the same pairs.
  await db
    .insert(cardTags)
    .values(rows.map((t) => ({ cardId, tagId: t.id })))
    .onConflictDoNothing();
}

// Active cards three quarters of the way to drifting, once per human assignee.
export async function listDriftingAssignments(
  db: DbOrTx,
  params: { now: Date }
) {
  return await db
    .select({
      card: cards,
      days: sql<number>`coalesce(${boards.entropyDays}, ${workspaces.entropyDays})`.mapWith(
        Number
      ),
      memberId: members.id,
    })
    .from(cards)
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .innerJoin(workspaces, eq(workspaces.id, cards.workspaceId))
    .innerJoin(cardAssignees, eq(cardAssignees.cardId, cards.id))
    .innerJoin(
      members,
      and(eq(members.id, cardAssignees.memberId), eq(members.kind, "human"))
    )
    .where(
      and(
        eq(cards.stage, "active"),
        sql`${cards.lastActiveAt} <= ${params.now.toISOString()}::timestamptz - make_interval(days => coalesce(${boards.entropyDays}, ${workspaces.entropyDays})) * 0.75`
      )
    );
}

export async function findCardByExternalKey(
  db: DbOrTx,
  params: { workspaceId: string; externalKey: string }
) {
  const [card] = await db
    .select()
    .from(cards)
    .where(
      and(
        eq(cards.workspaceId, params.workspaceId),
        eq(cards.externalKey, params.externalKey)
      )
    );
  return card;
}

// Cards an event points at. An activity links to the first id, so exact external-key matches come
// before matches by number.
export async function listCardIdsByRefs(
  db: DbOrTx,
  params: { workspaceId: string; externalKeys: string[]; numbers: number[] }
) {
  const { externalKeys, numbers } = params;
  if (!externalKeys.length && !numbers.length) {
    return [];
  }
  const rows = await db
    .select({ id: cards.id, externalKey: cards.externalKey })
    .from(cards)
    .where(
      and(
        eq(cards.workspaceId, params.workspaceId),
        or(
          externalKeys.length
            ? inArray(cards.externalKey, externalKeys)
            : undefined,
          numbers.length ? inArray(cards.number, numbers) : undefined
        )
      )
    );
  const keyed = new Set(externalKeys);
  const byKey = (r: (typeof rows)[number]) =>
    r.externalKey !== null && keyed.has(r.externalKey) ? 0 : 1;
  return rows.toSorted((a, b) => byKey(a) - byKey(b)).map((r) => r.id);
}

// Active cards past their board's (or the workspace's) entropy period.
export async function listStaleCards(db: DbOrTx, params: { now: Date }) {
  return await db
    .select({ workspaceId: cards.workspaceId, number: cards.number })
    .from(cards)
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .innerJoin(workspaces, eq(workspaces.id, cards.workspaceId))
    .where(
      and(
        eq(cards.stage, "active"),
        sql`${cards.lastActiveAt} <= ${params.now.toISOString()}::timestamptz - make_interval(days => coalesce(${boards.entropyDays}, ${workspaces.entropyDays}))`
      )
    );
}

export async function countCards(
  db: DbOrTx,
  params: {
    workspaceId: string;
    stage: CardStage;
    createdSince?: Date;
    closedSince?: Date;
  }
) {
  return await db.$count(
    cards,
    and(
      eq(cards.workspaceId, params.workspaceId),
      eq(cards.stage, params.stage),
      params.createdSince
        ? gte(cards.createdAt, params.createdSince)
        : undefined,
      params.closedSince ? gte(cards.closedAt, params.closedSince) : undefined
    )
  );
}
