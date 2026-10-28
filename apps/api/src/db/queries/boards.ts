import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import type { DbOrTx } from "#db";
import { boards, columns } from "#db/schema";
import { returned } from "#lib/assert";
import { notFound } from "#lib/errors";

export type Board = typeof boards.$inferSelect;
export type Column = typeof columns.$inferSelect;
export type BoardWithColumns = Board & { columns: Column[] };

export async function insertBoard(db: DbOrTx, row: Board) {
  await db.insert(boards).values(row);
}

export async function updateBoardById(
  db: DbOrTx,
  params: {
    id: string;
    set: Partial<
      Pick<Board, "name" | "description" | "entropyDays" | "archivedAt">
    >;
  }
) {
  await db.update(boards).set(params.set).where(eq(boards.id, params.id));
}

export async function listBoards(db: DbOrTx, params: { workspaceId: string }) {
  return await db
    .select()
    .from(boards)
    .where(
      and(eq(boards.workspaceId, params.workspaceId), isNull(boards.archivedAt))
    )
    .orderBy(asc(boards.createdAt));
}

// Archived boards take no new cards.
export async function findActiveBoard(
  db: DbOrTx,
  params: { workspaceId: string; id: string }
) {
  const [row] = await db
    .select({ id: boards.id })
    .from(boards)
    .where(
      and(
        eq(boards.workspaceId, params.workspaceId),
        eq(boards.id, params.id),
        isNull(boards.archivedAt)
      )
    );
  return row;
}

// One columns query for every board, not one per board.
export async function listBoardsWithColumns(
  db: DbOrTx,
  params: { workspaceId: string }
): Promise<BoardWithColumns[]> {
  const rows = await listBoards(db, params);
  if (!rows.length) {
    return [];
  }
  const cols = await db
    .select()
    .from(columns)
    .where(
      inArray(
        columns.boardId,
        rows.map((b) => b.id)
      )
    )
    .orderBy(asc(columns.position));
  return rows.map((b) => ({
    ...b,
    columns: cols.filter((c) => c.boardId === b.id),
  }));
}

export async function getBoardWithColumns(
  db: DbOrTx,
  params: { workspaceId: string; id: string }
): Promise<BoardWithColumns> {
  const [board] = await db
    .select()
    .from(boards)
    .where(
      and(eq(boards.id, params.id), eq(boards.workspaceId, params.workspaceId))
    );
  if (!board) {
    throw notFound("Board");
  }
  const cols = await db
    .select()
    .from(columns)
    .where(eq(columns.boardId, board.id))
    .orderBy(asc(columns.position));
  return { ...board, columns: cols };
}

export async function insertColumns(
  db: DbOrTx,
  rows: (typeof columns.$inferInsert)[]
) {
  if (!rows.length) {
    return;
  }
  await db.insert(columns).values(rows);
}

// Columns belong to a workspace through their board.
export async function getColumnById(
  db: DbOrTx,
  params: { workspaceId: string; id: string }
) {
  const [row] = await db
    .select({ column: columns })
    .from(columns)
    .innerJoin(boards, eq(boards.id, columns.boardId))
    .where(
      and(eq(columns.id, params.id), eq(boards.workspaceId, params.workspaceId))
    );
  if (!row) {
    throw notFound("Column");
  }
  return row.column;
}

export async function updateColumnById(
  db: DbOrTx,
  params: { id: string; set: Partial<Pick<Column, "name" | "color">> }
) {
  const rows = await db
    .update(columns)
    .set(params.set)
    .where(eq(columns.id, params.id))
    .returning();
  return returned(rows, "column");
}

export async function deleteColumnById(db: DbOrTx, params: { id: string }) {
  await db.delete(columns).where(eq(columns.id, params.id));
}

// Keeps positions dense: `by: 1` opens a gap at `from`, `by: -1` closes the one just below it.
export async function updateColumnPositions(
  db: DbOrTx,
  params: { boardId: string; from: number; by: 1 | -1 }
) {
  await db
    .update(columns)
    .set({ position: sql`${columns.position} + ${params.by}` })
    .where(
      and(
        eq(columns.boardId, params.boardId),
        gte(columns.position, params.from)
      )
    );
}
