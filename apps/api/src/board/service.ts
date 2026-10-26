import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { recordActivity } from "../activity/service";
import { raiseAttention } from "../attention/service";
import type { AppContext } from "../context";
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
} from "../db/schema";
import type { CardStage } from "../db/schema";
import { returned } from "../lib/assert";
import { badRequest, notFound } from "../lib/errors";
import { newId } from "../lib/ids";
import { DAY_MS } from "../lib/time";

export type Member = typeof members.$inferSelect;
export type Board = typeof boards.$inferSelect;
export type Column = typeof columns.$inferSelect;
export type CardRow = typeof cards.$inferSelect;

export type CardView = CardRow & {
  columnName: string | null;
  assigneeIds: string[];
  tags: string[];
  entropy: {
    days: number;
    autoPostponeAt: Date;
    postponingSoon: boolean;
  } | null;
};

export const ENTROPY_DAYS = [3, 7, 30, 90, 365] as const;

export async function createBoard(
  ctx: AppContext,
  actor: Member,
  input: {
    name: string;
    description?: string | null;
    columns?: string[];
    entropyDays?: number | null;
  }
) {
  const board: Board = {
    id: newId("brd"),
    workspaceId: actor.workspaceId,
    name: input.name,
    description: input.description ?? null,
    entropyDays: input.entropyDays ?? null,
    createdById: actor.id,
    createdAt: ctx.now(),
    archivedAt: null,
  };
  await ctx.db.insert(boards).values(board);
  const names = input.columns ?? ["Doing", "Review"];
  const cols = names.map((name, position) => ({
    id: newId("col"),
    boardId: board.id,
    name,
    position,
    color: "gray",
  }));
  if (cols.length) {
    await ctx.db.insert(columns).values(cols);
  }
  return await getBoard(ctx, actor.workspaceId, board.id);
}

export async function listBoards(ctx: AppContext, workspaceId: string) {
  return await ctx.db
    .select()
    .from(boards)
    .where(and(eq(boards.workspaceId, workspaceId), isNull(boards.archivedAt)))
    .orderBy(asc(boards.createdAt));
}

export async function getBoard(
  ctx: AppContext,
  workspaceId: string,
  boardId: string
) {
  const [board] = await ctx.db
    .select()
    .from(boards)
    .where(and(eq(boards.id, boardId), eq(boards.workspaceId, workspaceId)));
  if (!board) {
    throw notFound("Board");
  }
  const cols = await ctx.db
    .select()
    .from(columns)
    .where(eq(columns.boardId, boardId))
    .orderBy(asc(columns.position));
  return { ...board, columns: cols };
}

export async function updateBoard(
  ctx: AppContext,
  workspaceId: string,
  boardId: string,
  patch: {
    name?: string;
    description?: string | null;
    entropyDays?: number | null;
    archived?: boolean;
  }
) {
  await getBoard(ctx, workspaceId, boardId);
  const { archived, ...rest } = patch;
  await ctx.db
    .update(boards)
    .set({
      ...rest,
      ...(archived === undefined
        ? {}
        : { archivedAt: archived ? ctx.now() : null }),
    })
    .where(eq(boards.id, boardId));
  return await getBoard(ctx, workspaceId, boardId);
}

export async function addColumn(
  ctx: AppContext,
  workspaceId: string,
  boardId: string,
  input: { name: string; color?: string; position?: number }
) {
  const board = await getBoard(ctx, workspaceId, boardId);
  const position = input.position ?? board.columns.length;
  await ctx.db
    .update(columns)
    .set({ position: sql`${columns.position} + 1` })
    .where(
      and(eq(columns.boardId, boardId), sql`${columns.position} >= ${position}`)
    );
  const col = {
    id: newId("col"),
    boardId,
    name: input.name,
    color: input.color ?? "gray",
    position,
    createdAt: ctx.now(),
  };
  await ctx.db.insert(columns).values(col);
  return col;
}

async function getColumn(
  ctx: AppContext,
  workspaceId: string,
  columnId: string
) {
  const [row] = await ctx.db
    .select({ column: columns })
    .from(columns)
    .innerJoin(boards, eq(boards.id, columns.boardId))
    .where(and(eq(columns.id, columnId), eq(boards.workspaceId, workspaceId)));
  if (!row) {
    throw notFound("Column");
  }
  return row.column;
}

export async function updateColumn(
  ctx: AppContext,
  workspaceId: string,
  columnId: string,
  patch: { name?: string; color?: string }
) {
  await getColumn(ctx, workspaceId, columnId);
  const rows = await ctx.db
    .update(columns)
    .set(patch)
    .where(eq(columns.id, columnId))
    .returning();
  return returned(rows, "column");
}

export async function deleteColumn(
  ctx: AppContext,
  workspaceId: string,
  columnId: string
) {
  const col = await getColumn(ctx, workspaceId, columnId);
  await ctx.db
    .update(cards)
    .set({ stage: "triage", columnId: null })
    .where(eq(cards.columnId, columnId));
  await ctx.db.delete(columns).where(eq(columns.id, columnId));
  await ctx.db
    .update(columns)
    .set({ position: sql`${columns.position} - 1` })
    .where(
      and(
        eq(columns.boardId, col.boardId),
        sql`${columns.position} > ${col.position}`
      )
    );
}

export type CardInput = {
  boardId: string;
  title: string;
  body?: string | null;
  columnId?: string | null;
  assigneeIds?: string[];
  tags?: string[];
  golden?: boolean;
  dueOn?: string | null;
  source?: string;
  externalKey?: string | null;
  externalUrl?: string | null;
};

// `silent` skips the activity write when the ingested event is itself the record.
export type EffectOpts = { silent?: boolean };

export async function createCard(
  ctx: AppContext,
  actor: Member | null,
  workspaceId: string,
  input: CardInput,
  opts: EffectOpts = {}
) {
  const board = await getBoard(ctx, workspaceId, input.boardId);
  if (input.columnId && !board.columns.some((c) => c.id === input.columnId)) {
    throw badRequest("columnId is not on this board");
  }

  const number = await nextCardNumber(ctx, workspaceId);
  const card = newCardRow(ctx, workspaceId, number, actor, input);
  await ctx.db.insert(cards).values(card);
  if (actor) {
    await watch(ctx, card.id, actor.id);
  }
  if (input.tags && input.tags.length > 0) {
    await setTags(ctx, workspaceId, card.id, input.tags);
  }

  if (opts.silent !== true) {
    await recordActivity(ctx, {
      workspaceId,
      actorId: actor?.id ?? null,
      source: card.source,
      kind: "card.created",
      title: `#${card.number} ${card.title}`,
      cardId: card.id,
      data: { boardId: board.id, stage: card.stage },
    });
  }
  for (const memberId of input.assigneeIds ?? []) {
    await assign(ctx, actor, workspaceId, card.number, memberId, opts);
  }
  return await getCard(ctx, workspaceId, card.number);
}

async function nextCardNumber(ctx: AppContext, workspaceId: string) {
  const rows = await ctx.db
    .update(workspaces)
    .set({ cardSeq: sql`${workspaces.cardSeq} + 1` })
    .where(eq(workspaces.id, workspaceId))
    .returning({ number: workspaces.cardSeq });
  return returned(rows, "card number").number;
}

function newCardRow(
  ctx: AppContext,
  workspaceId: string,
  number: number,
  actor: Member | null,
  input: CardInput
): CardRow {
  const now = ctx.now();
  return {
    id: newId("crd"),
    workspaceId,
    boardId: input.boardId,
    number,
    title: input.title,
    body: input.body ?? null,
    stage: input.columnId ? "active" : "triage",
    columnId: input.columnId ?? null,
    golden: input.golden ?? false,
    dueOn: input.dueOn ?? null,
    createdById: actor?.id ?? null,
    source: input.source ?? "worklog",
    externalKey: input.externalKey ?? null,
    externalUrl: input.externalUrl ?? null,
    lastActiveAt: now,
    postponedAt: null,
    autoPostponed: false,
    closedAt: null,
    closedById: null,
    createdAt: now,
    updatedAt: now,
  };
}

export type CardFilters = {
  boardId?: string;
  stage?: CardStage;
  assigneeId?: string;
  golden?: boolean;
  tag?: string;
  q?: string;
  limit?: number;
};

export async function listCards(
  ctx: AppContext,
  workspaceId: string,
  filters: CardFilters = {}
): Promise<CardView[]> {
  const where: (SQL | undefined)[] = [eq(cards.workspaceId, workspaceId)];
  if (filters.boardId) {
    where.push(eq(cards.boardId, filters.boardId));
  }
  if (filters.stage) {
    where.push(eq(cards.stage, filters.stage));
  }
  if (filters.golden !== undefined) {
    where.push(eq(cards.golden, filters.golden));
  }
  if (filters.q) {
    where.push(
      or(
        ilike(cards.title, `%${filters.q}%`),
        ilike(cards.body, `%${filters.q}%`)
      )
    );
  }
  if (filters.assigneeId) {
    where.push(
      inArray(
        cards.id,
        ctx.db
          .select({ id: cardAssignees.cardId })
          .from(cardAssignees)
          .where(eq(cardAssignees.memberId, filters.assigneeId))
      )
    );
  }
  if (filters.tag) {
    where.push(
      inArray(
        cards.id,
        ctx.db
          .select({ id: cardTags.cardId })
          .from(cardTags)
          .innerJoin(tags, eq(tags.id, cardTags.tagId))
          .where(
            and(
              eq(tags.workspaceId, workspaceId),
              eq(tags.name, filters.tag.toLowerCase())
            )
          )
      )
    );
  }
  const rows = await ctx.db
    .select()
    .from(cards)
    .where(and(...where))
    .orderBy(desc(cards.golden), desc(cards.lastActiveAt))
    .limit(filters.limit ?? 200);
  return await hydrate(ctx, workspaceId, rows);
}

async function hydrate(
  ctx: AppContext,
  workspaceId: string,
  rows: CardRow[]
): Promise<CardView[]> {
  if (!rows.length) {
    return [];
  }
  const ids = rows.map((r) => r.id);
  const [assigneeRows, tagRows, columnRows, boardRows, [ws]] =
    await Promise.all([
      ctx.db
        .select()
        .from(cardAssignees)
        .where(inArray(cardAssignees.cardId, ids)),
      ctx.db
        .select({ cardId: cardTags.cardId, name: tags.name })
        .from(cardTags)
        .innerJoin(tags, eq(tags.id, cardTags.tagId))
        .where(inArray(cardTags.cardId, ids)),
      ctx.db
        .select()
        .from(columns)
        .where(
          inArray(columns.boardId, [...new Set(rows.map((r) => r.boardId))])
        ),
      ctx.db
        .select()
        .from(boards)
        .where(inArray(boards.id, [...new Set(rows.map((r) => r.boardId))])),
      ctx.db.select().from(workspaces).where(eq(workspaces.id, workspaceId)),
    ]);
  const now = ctx.now().getTime();
  return rows.map((card) => {
    const board = boardRows.find((b) => b.id === card.boardId);
    const days = board?.entropyDays ?? ws?.entropyDays ?? 30;
    const autoPostponeAt = new Date(
      card.lastActiveAt.getTime() + days * DAY_MS
    );
    return {
      ...card,
      columnName: columnRows.find((c) => c.id === card.columnId)?.name ?? null,
      assigneeIds: assigneeRows
        .filter((a) => a.cardId === card.id)
        .map((a) => a.memberId),
      tags: tagRows.filter((t) => t.cardId === card.id).map((t) => t.name),
      entropy:
        card.stage === "active"
          ? {
              days,
              autoPostponeAt,
              postponingSoon:
                now >= card.lastActiveAt.getTime() + 0.75 * days * DAY_MS,
            }
          : null,
    };
  });
}

export async function findCard(
  ctx: AppContext,
  workspaceId: string,
  number: number
) {
  const [card] = await ctx.db
    .select()
    .from(cards)
    .where(and(eq(cards.workspaceId, workspaceId), eq(cards.number, number)));
  if (!card) {
    throw notFound(`Card #${number}`);
  }
  return card;
}

export async function getCard(
  ctx: AppContext,
  workspaceId: string,
  number: number
) {
  const card = await findCard(ctx, workspaceId, number);
  const [view] = await hydrate(ctx, workspaceId, [card]);
  if (!view) {
    throw notFound(`Card #${number}`);
  }
  return view;
}

export async function getCardDetail(
  ctx: AppContext,
  workspaceId: string,
  number: number
) {
  const card = await getCard(ctx, workspaceId, number);
  const [commentRows, watcherRows] = await Promise.all([
    ctx.db
      .select()
      .from(comments)
      .where(eq(comments.cardId, card.id))
      .orderBy(asc(comments.createdAt)),
    ctx.db.select().from(cardWatchers).where(eq(cardWatchers.cardId, card.id)),
  ]);
  return {
    ...card,
    comments: commentRows,
    watcherIds: watcherRows.map((w) => w.memberId),
  };
}

export async function updateCard(
  ctx: AppContext,
  actor: Member,
  number: number,
  patch: {
    title?: string;
    body?: string | null;
    dueOn?: string | null;
    boardId?: string;
    tags?: string[];
  }
) {
  const card = await findCard(ctx, actor.workspaceId, number);
  const { tags: tagNames, boardId, ...fields } = patch;
  const set: Partial<CardRow> = { ...fields, updatedAt: ctx.now() };
  if (boardId && boardId !== card.boardId) {
    await getBoard(ctx, actor.workspaceId, boardId);
    // Columns are per board: moving boards sends the card back to triage there.
    Object.assign(set, {
      boardId,
      columnId: null,
      stage: card.stage === "active" ? "triage" : card.stage,
    });
  }
  await ctx.db.update(cards).set(set).where(eq(cards.id, card.id));
  if (tagNames) {
    await setTags(ctx, actor.workspaceId, card.id, tagNames);
  }
  const changed = Object.keys(patch).join(", ");
  await recordActivity(ctx, {
    workspaceId: actor.workspaceId,
    actorId: actor.id,
    source: "worklog",
    kind: "card.updated",
    title: `#${card.number} ${patch.title ?? card.title}`,
    body: `Changed ${changed}`,
    cardId: card.id,
  });
  return await getCard(ctx, actor.workspaceId, number);
}

type Transition = {
  stage: CardStage;
  columnId?: string | null;
  kind: string;
  verb: string;
};

async function transition(
  ctx: AppContext,
  actor: Member | null,
  workspaceId: string,
  number: number,
  t: Transition,
  opts: EffectOpts = {}
) {
  const card = await findCard(ctx, workspaceId, number);
  const now = ctx.now();
  await ctx.db
    .update(cards)
    .set({
      stage: t.stage,
      columnId: t.stage === "active" ? (t.columnId ?? null) : null,
      postponedAt: t.stage === "not_now" ? now : null,
      autoPostponed: t.kind === "card.auto_postponed",
      closedAt: t.stage === "done" ? now : null,
      closedById: t.stage === "done" ? (actor?.id ?? null) : null,
      updatedAt: now,
      ...(opts.silent === true ? { lastActiveAt: now } : {}),
    })
    .where(eq(cards.id, card.id));
  if (opts.silent !== true) {
    await recordActivity(ctx, {
      workspaceId,
      actorId: actor?.id ?? null,
      source: "worklog",
      kind: t.kind,
      title: `#${card.number} ${card.title}`,
      body: t.verb,
      cardId: card.id,
      data: { from: card.stage, to: t.stage, columnId: t.columnId ?? null },
    });
  }
  const view = await getCard(ctx, workspaceId, number);
  await ctx.bus.publish({
    workspaceId,
    type: "card.updated",
    data: { number, stage: view.stage, columnId: view.columnId },
  });
  return view;
}

export async function triage(
  ctx: AppContext,
  actor: Member | null,
  workspaceId: string,
  number: number,
  columnId: string
) {
  const card = await findCard(ctx, workspaceId, number);
  const board = await getBoard(ctx, workspaceId, card.boardId);
  const col = board.columns.find((c) => c.id === columnId);
  if (!col) {
    throw badRequest("columnId is not on this card's board");
  }
  return await transition(ctx, actor, workspaceId, number, {
    stage: "active",
    columnId,
    kind: "card.triaged",
    verb: `Moved to ${col.name}`,
  });
}

export const sendBackToTriage = async (
  ctx: AppContext,
  actor: Member | null,
  ws: string,
  n: number
) =>
  await transition(ctx, actor, ws, n, {
    stage: "triage",
    kind: "card.sent_back_to_triage",
    verb: "Sent back to Maybe?",
  });

export const postpone = async (
  ctx: AppContext,
  actor: Member | null,
  ws: string,
  n: number
) =>
  await transition(ctx, actor, ws, n, {
    stage: "not_now",
    kind: "card.postponed",
    verb: "Moved to Not now",
  });

export const resume = async (
  ctx: AppContext,
  actor: Member | null,
  ws: string,
  n: number
) =>
  await transition(ctx, actor, ws, n, {
    stage: "triage",
    kind: "card.resumed",
    verb: "Brought back from Not now",
  });

export const close = async (
  ctx: AppContext,
  actor: Member | null,
  ws: string,
  n: number,
  opts?: EffectOpts
) =>
  await transition(
    ctx,
    actor,
    ws,
    n,
    { stage: "done", kind: "card.closed", verb: "Marked done" },
    opts
  );

export const reopen = async (
  ctx: AppContext,
  actor: Member | null,
  ws: string,
  n: number,
  opts?: EffectOpts
) =>
  await transition(
    ctx,
    actor,
    ws,
    n,
    { stage: "triage", kind: "card.reopened", verb: "Reopened" },
    opts
  );

export async function setGolden(
  ctx: AppContext,
  actor: Member,
  number: number,
  golden: boolean
) {
  const card = await findCard(ctx, actor.workspaceId, number);
  await ctx.db
    .update(cards)
    .set({ golden, updatedAt: ctx.now() })
    .where(eq(cards.id, card.id));
  await recordActivity(ctx, {
    workspaceId: actor.workspaceId,
    actorId: actor.id,
    source: "worklog",
    kind: golden ? "card.golden" : "card.ungolden",
    title: `#${card.number} ${card.title}`,
    body: golden ? "Made it a golden ticket" : "Removed golden ticket",
    cardId: card.id,
  });
  return await getCard(ctx, actor.workspaceId, number);
}

export async function assign(
  ctx: AppContext,
  actor: Member | null,
  workspaceId: string,
  number: number,
  memberId: string,
  opts: EffectOpts = {}
) {
  const card = await findCard(ctx, workspaceId, number);
  const [assignee] = await ctx.db
    .select()
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.workspaceId, workspaceId)));
  if (!assignee) {
    throw notFound("Member");
  }
  const inserted = await ctx.db
    .insert(cardAssignees)
    .values({ cardId: card.id, memberId })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) {
    return await getCard(ctx, workspaceId, number);
  }
  await watch(ctx, card.id, memberId);
  if (opts.silent === true) {
    return await getCard(ctx, workspaceId, number);
  }
  const activity = await recordActivity(ctx, {
    workspaceId,
    actorId: actor?.id ?? null,
    source: "worklog",
    kind: "card.assigned",
    title: `#${card.number} ${card.title}`,
    body: `Assigned to ${assignee.name}`,
    cardId: card.id,
    data: { assigneeId: memberId },
  });
  if (actor?.id !== memberId) {
    await raiseAttention(ctx, {
      workspaceId,
      memberId,
      kind: "card.assigned",
      title: `${actor?.name ?? "Worklog"} assigned you #${card.number} ${card.title}`,
      cardId: card.id,
      activityId: activity?.id ?? null,
      fromId: actor?.id ?? null,
      priority: "normal",
      dedupeKey: `assigned:${card.id}`,
    });
  }
  return await getCard(ctx, workspaceId, number);
}

export async function unassign(
  ctx: AppContext,
  actor: Member,
  number: number,
  memberId: string
) {
  const card = await findCard(ctx, actor.workspaceId, number);
  await ctx.db
    .delete(cardAssignees)
    .where(
      and(
        eq(cardAssignees.cardId, card.id),
        eq(cardAssignees.memberId, memberId)
      )
    );
  await recordActivity(ctx, {
    workspaceId: actor.workspaceId,
    actorId: actor.id,
    source: "worklog",
    kind: "card.unassigned",
    title: `#${card.number} ${card.title}`,
    cardId: card.id,
    data: { assigneeId: memberId },
  });
  return await getCard(ctx, actor.workspaceId, number);
}

export async function watch(ctx: AppContext, cardId: string, memberId: string) {
  await ctx.db
    .insert(cardWatchers)
    .values({ cardId, memberId })
    .onConflictDoNothing();
}

export async function unwatch(
  ctx: AppContext,
  cardId: string,
  memberId: string
) {
  await ctx.db
    .delete(cardWatchers)
    .where(
      and(eq(cardWatchers.cardId, cardId), eq(cardWatchers.memberId, memberId))
    );
}

const MENTION = /(?:^|\s)@(?<handle>[a-z0-9][a-z0-9._-]*)/giu;

export async function addComment(
  ctx: AppContext,
  actor: Member,
  number: number,
  body: string
) {
  const card = await findCard(ctx, actor.workspaceId, number);
  const comment = {
    id: newId("cmt"),
    cardId: card.id,
    authorId: actor.id,
    body,
    createdAt: ctx.now(),
  };
  await ctx.db.insert(comments).values(comment);
  await watch(ctx, card.id, actor.id);
  const activity = await recordActivity(ctx, {
    workspaceId: actor.workspaceId,
    actorId: actor.id,
    source: "worklog",
    kind: "comment.created",
    title: `#${card.number} ${card.title}`,
    body: body.slice(0, 500),
    cardId: card.id,
  });

  const handles = [...body.matchAll(MENTION)]
    .map((m) => m.groups?.handle?.toLowerCase())
    .filter((handle) => handle !== undefined);
  const mentioned = handles.length
    ? await ctx.db
        .select()
        .from(members)
        .where(
          and(
            eq(members.workspaceId, actor.workspaceId),
            inArray(members.handle, handles)
          )
        )
    : [];
  for (const m of mentioned) {
    if (m.id === actor.id) {
      continue;
    }
    await raiseAttention(ctx, {
      workspaceId: actor.workspaceId,
      memberId: m.id,
      kind: "mention",
      title: `${actor.name} mentioned you on #${card.number} ${card.title}`,
      body: body.slice(0, 280),
      cardId: card.id,
      activityId: activity?.id ?? null,
      fromId: actor.id,
      priority: "high",
      dedupeKey: `mention:${comment.id}`,
    });
  }

  const watchers = await ctx.db
    .select()
    .from(cardWatchers)
    .where(eq(cardWatchers.cardId, card.id));
  for (const w of watchers) {
    if (w.memberId === actor.id || mentioned.some((m) => m.id === w.memberId)) {
      continue;
    }
    await raiseAttention(ctx, {
      workspaceId: actor.workspaceId,
      memberId: w.memberId,
      kind: "card.activity",
      title: `New comments on #${card.number} ${card.title}`,
      body: `${actor.name}: ${body.slice(0, 200)}`,
      cardId: card.id,
      activityId: activity?.id ?? null,
      fromId: actor.id,
      priority: "low",
      dedupeKey: `card:${card.id}`,
    });
  }
  return comment;
}

async function setTags(
  ctx: AppContext,
  workspaceId: string,
  cardId: string,
  names: string[]
) {
  const clean = [
    ...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean)),
  ];
  await ctx.db.delete(cardTags).where(eq(cardTags.cardId, cardId));
  if (!clean.length) {
    return;
  }
  await ctx.db
    .insert(tags)
    .values(clean.map((name) => ({ id: newId("tag"), workspaceId, name })))
    .onConflictDoNothing();
  const rows = await ctx.db
    .select()
    .from(tags)
    .where(and(eq(tags.workspaceId, workspaceId), inArray(tags.name, clean)));
  await ctx.db
    .insert(cardTags)
    .values(rows.map((t) => ({ cardId, tagId: t.id })));
}

export async function keepAlive(
  ctx: AppContext,
  actor: Member,
  number: number
) {
  const card = await findCard(ctx, actor.workspaceId, number);
  await recordActivity(ctx, {
    workspaceId: actor.workspaceId,
    actorId: actor.id,
    source: "worklog",
    kind: "card.kept",
    title: `#${card.number} ${card.title}`,
    body: "Still on it",
    cardId: card.id,
  });
  return await getCard(ctx, actor.workspaceId, number);
}

const DRIFT_ACTIONS = [
  { id: "keep", label: "Still on it" },
  { id: "not_now", label: "Not now" },
  { id: "done", label: "It's done" },
];

// Asks once per quiet spell.
export async function nudgeDrifting(ctx: AppContext): Promise<number> {
  const now = ctx.now();
  const rows = await ctx.db
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
        sql`${cards.lastActiveAt} <= ${now.toISOString()}::timestamptz - make_interval(days => coalesce(${boards.entropyDays}, ${workspaces.entropyDays})) * 0.75`
      )
    );
  let raised = 0;
  for (const { card, days, memberId } of rows) {
    const driftsOn = new Date(card.lastActiveAt.getTime() + days * DAY_MS);
    const item = await raiseAttention(ctx, {
      workspaceId: card.workspaceId,
      memberId,
      kind: "card.drifting",
      title: `#${card.number} ${card.title} drifts to Not now on ${driftsOn.toISOString().slice(0, 10)} — still on it?`,
      cardId: card.id,
      priority: "normal",
      dedupeKey: `drift:${card.id}:${card.lastActiveAt.getTime()}`,
      actions: DRIFT_ACTIONS,
      meta: { cardNumber: card.number },
      onlyIfNew: true,
    });
    if (item) {
      raised += 1;
    }
  }
  return raised;
}

export async function sweepEntropy(ctx: AppContext): Promise<number> {
  const now = ctx.now();
  const stale = await ctx.db
    .select({ workspaceId: cards.workspaceId, number: cards.number })
    .from(cards)
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .innerJoin(workspaces, eq(workspaces.id, cards.workspaceId))
    .where(
      and(
        eq(cards.stage, "active"),
        sql`${cards.lastActiveAt} <= ${now.toISOString()}::timestamptz - make_interval(days => coalesce(${boards.entropyDays}, ${workspaces.entropyDays}))`
      )
    );
  for (const card of stale) {
    await transition(ctx, null, card.workspaceId, card.number, {
      stage: "not_now",
      kind: "card.auto_postponed",
      verb: "Drifted to Not now after no activity",
    });
  }
  return stale.length;
}
