import type { AppContext } from "#context";
import {
  getBoardWithColumns,
  getColumnById,
  insertBoard,
  insertColumns,
  deleteColumnById,
  updateBoardById,
  updateColumnById,
  updateColumnPositions,
} from "#db/queries/boards";
import type { Board } from "#db/queries/boards";
import {
  deleteAssignee,
  deleteWatcher,
  getCardByNumber,
  insertAssignee,
  insertCard,
  insertComment,
  insertWatcher,
  listCardRelations,
  listCardRows,
  listComments,
  listWatchers,
  nextCardNumber,
  setCardTags,
  updateCardById,
  updateCardsByColumn,
} from "#db/queries/cards";
import type { CardFilters, CardRow } from "#db/queries/cards";
import { findMemberById, listMembersByHandles } from "#db/queries/members";
import type { Member } from "#db/queries/members";
import type { CardStage } from "#db/schema";
import { transact } from "#db/transact";
import { badRequest, notFound } from "#lib/errors";
import { generateId } from "#lib/ids";
import { DAY_MS } from "#lib/time";

import { recordActivity } from "./activity";
import { raiseAttention } from "./attention";

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
    id: generateId(),
    workspaceId: actor.workspaceId,
    name: input.name,
    description: input.description ?? null,
    entropyDays: input.entropyDays ?? null,
    createdById: actor.id,
    createdAt: ctx.now(),
    archivedAt: null,
  };
  const names = input.columns ?? ["Doing", "Review"];
  return await transact(ctx, async (tx) => {
    await insertBoard(tx.db, board);
    await insertColumns(
      tx.db,
      names.map((name, position) => ({
        id: generateId(),
        boardId: board.id,
        name,
        position,
        color: "gray",
      }))
    );
    return await getBoardWithColumns(tx.db, {
      workspaceId: actor.workspaceId,
      id: board.id,
    });
  });
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
  await getBoardWithColumns(ctx.db, { workspaceId, id: boardId });
  const { archived, ...rest } = patch;
  await updateBoardById(ctx.db, {
    id: boardId,
    set: {
      ...rest,
      ...(archived === undefined
        ? {}
        : { archivedAt: archived ? ctx.now() : null }),
    },
  });
  return await getBoardWithColumns(ctx.db, { workspaceId, id: boardId });
}

export async function addColumn(
  ctx: AppContext,
  workspaceId: string,
  boardId: string,
  input: { name: string; color?: string; position?: number }
) {
  return await transact(ctx, async (tx) => {
    const board = await getBoardWithColumns(tx.db, {
      workspaceId,
      id: boardId,
    });
    const position = input.position ?? board.columns.length;
    await updateColumnPositions(tx.db, { boardId, from: position, by: 1 });
    const col = {
      id: generateId(),
      boardId,
      name: input.name,
      color: input.color ?? "gray",
      position,
      createdAt: tx.now(),
    };
    await insertColumns(tx.db, [col]);
    return col;
  });
}

export async function updateColumn(
  ctx: AppContext,
  workspaceId: string,
  columnId: string,
  patch: { name?: string; color?: string }
) {
  await getColumnById(ctx.db, { workspaceId, id: columnId });
  return await updateColumnById(ctx.db, { id: columnId, set: patch });
}

export async function deleteColumn(
  ctx: AppContext,
  workspaceId: string,
  columnId: string
) {
  await transact(ctx, async (tx) => {
    const col = await getColumnById(tx.db, { workspaceId, id: columnId });
    await updateCardsByColumn(tx.db, {
      columnId,
      set: { stage: "triage", columnId: null },
    });
    await deleteColumnById(tx.db, { id: columnId });
    await updateColumnPositions(tx.db, {
      boardId: col.boardId,
      from: col.position + 1,
      by: -1,
    });
  });
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

export type EffectOpts = { silent?: boolean };

export async function createCard(
  ctx: AppContext,
  actor: Member | null,
  workspaceId: string,
  input: CardInput,
  opts: EffectOpts = {}
) {
  const board = await getBoardWithColumns(ctx.db, {
    workspaceId,
    id: input.boardId,
  });
  if (input.columnId && !board.columns.some((c) => c.id === input.columnId)) {
    throw badRequest("columnId is not on this board");
  }
  const number = await nextCardNumber(ctx.db, { workspaceId });
  return await transact(ctx, async (tx) => {
    const card = newCardRow(tx, workspaceId, number, actor, input);
    await insertCard(tx.db, card);
    if (actor) {
      await watch(tx, card.id, actor.id);
    }
    if (input.tags && input.tags.length > 0) {
      await setTags(tx, workspaceId, card.id, input.tags);
    }

    if (opts.silent !== true) {
      await recordActivity(tx, {
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
      await assign(tx, actor, workspaceId, card.number, memberId, opts);
    }
    return await getCard(tx, workspaceId, card.number);
  });
}

function newCardRow(
  ctx: AppContext,
  workspaceId: string,
  number: number,
  actor: Member | null,
  input: CardInput
) {
  const now = ctx.now();
  return {
    id: generateId(),
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
  } satisfies CardRow;
}

export async function listCards(
  ctx: AppContext,
  workspaceId: string,
  filters: CardFilters = {}
) {
  const rows = await listCardRows(ctx.db, { ...filters, workspaceId });
  return await hydrate(ctx, workspaceId, rows);
}

async function hydrate(ctx: AppContext, workspaceId: string, rows: CardRow[]) {
  if (!rows.length) {
    return [];
  }
  const related = await listCardRelations(ctx.db, {
    workspaceId,
    cards: rows,
  });
  const now = ctx.now().getTime();
  const views: CardView[] = rows.map((card) => {
    const board = related.boards.find((b) => b.id === card.boardId);
    const days = board?.entropyDays ?? related.workspace?.entropyDays ?? 30;
    const autoPostponeAt = new Date(
      card.lastActiveAt.getTime() + days * DAY_MS
    );
    return {
      ...card,
      columnName:
        related.columns.find((c) => c.id === card.columnId)?.name ?? null,
      assigneeIds: related.assignees
        .filter((a) => a.cardId === card.id)
        .map((a) => a.memberId),
      tags: related.tags.filter((t) => t.cardId === card.id).map((t) => t.name),
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
  return views;
}

export async function getCard(
  ctx: AppContext,
  workspaceId: string,
  number: number
) {
  const card = await getCardByNumber(ctx.db, { workspaceId, number });
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
    listComments(ctx.db, { cardId: card.id }),
    listWatchers(ctx.db, { cardId: card.id }),
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
  return await transact(ctx, async (tx) => {
    const card = await getCardByNumber(tx.db, {
      workspaceId: actor.workspaceId,
      number,
    });
    const { tags: tagNames, boardId, ...fields } = patch;
    const set: Partial<CardRow> = { ...fields, updatedAt: tx.now() };
    if (boardId && boardId !== card.boardId) {
      await getBoardWithColumns(tx.db, {
        workspaceId: actor.workspaceId,
        id: boardId,
      });
      Object.assign(set, {
        boardId,
        columnId: null,
        stage: card.stage === "active" ? "triage" : card.stage,
      });
    }
    await updateCardById(tx.db, { id: card.id, set });
    if (tagNames) {
      await setTags(tx, actor.workspaceId, card.id, tagNames);
    }
    await recordActivity(tx, {
      workspaceId: actor.workspaceId,
      actorId: actor.id,
      source: "worklog",
      kind: "card.updated",
      title: `#${card.number} ${patch.title ?? card.title}`,
      body: describeEdit(patch),
      cardId: card.id,
    });
    return await getCard(tx, actor.workspaceId, number);
  });
}

type Transition = {
  stage: CardStage;
  columnId?: string | null;
  kind: string;
  verb: string;
};

export async function transition(
  ctx: AppContext,
  actor: Member | null,
  workspaceId: string,
  number: number,
  t: Transition,
  opts: EffectOpts = {}
) {
  return await transact(ctx, async (tx) => {
    const card = await getCardByNumber(tx.db, { workspaceId, number });
    const now = tx.now();
    await updateCardById(tx.db, {
      id: card.id,
      set: {
        stage: t.stage,
        columnId: t.stage === "active" ? (t.columnId ?? null) : null,
        postponedAt: t.stage === "not_now" ? now : null,
        autoPostponed: t.kind === "card.auto_postponed",
        closedAt: t.stage === "done" ? now : null,
        closedById: t.stage === "done" ? (actor?.id ?? null) : null,
        updatedAt: now,
        ...(opts.silent === true ? { lastActiveAt: now } : {}),
      },
    });
    if (opts.silent !== true) {
      await recordActivity(tx, {
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
    const view = await getCard(tx, workspaceId, number);
    await tx.bus.publish({
      workspaceId,
      type: "card.updated",
      data: { number, stage: view.stage, columnId: view.columnId },
    });
    return view;
  });
}

export async function triage(
  ctx: AppContext,
  actor: Member | null,
  workspaceId: string,
  number: number,
  columnId: string
) {
  const card = await getCardByNumber(ctx.db, { workspaceId, number });
  const board = await getBoardWithColumns(ctx.db, {
    workspaceId,
    id: card.boardId,
  });
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
  return await transact(ctx, async (tx) => {
    const card = await getCardByNumber(tx.db, {
      workspaceId: actor.workspaceId,
      number,
    });
    await updateCardById(tx.db, {
      id: card.id,
      set: { golden, updatedAt: tx.now() },
    });
    await recordActivity(tx, {
      workspaceId: actor.workspaceId,
      actorId: actor.id,
      source: "worklog",
      kind: golden ? "card.golden" : "card.ungolden",
      title: `#${card.number} ${card.title}`,
      body: golden ? "Made it a golden ticket" : "Removed golden ticket",
      cardId: card.id,
    });
    return await getCard(tx, actor.workspaceId, number);
  });
}

export async function assign(
  ctx: AppContext,
  actor: Member | null,
  workspaceId: string,
  number: number,
  memberId: string,
  opts: EffectOpts = {}
) {
  return await transact(ctx, async (tx) => {
    const card = await getCardByNumber(tx.db, { workspaceId, number });
    const assignee = await findMemberById(tx.db, { id: memberId, workspaceId });
    if (!assignee) {
      throw notFound("Member");
    }
    if (!(await insertAssignee(tx.db, { cardId: card.id, memberId }))) {
      return await getCard(tx, workspaceId, number);
    }
    await watch(tx, card.id, memberId);
    if (opts.silent === true) {
      return await getCard(tx, workspaceId, number);
    }
    const activity = await recordActivity(tx, {
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
      await raiseAttention(tx, {
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
    return await getCard(tx, workspaceId, number);
  });
}

export async function unassign(
  ctx: AppContext,
  actor: Member,
  number: number,
  memberId: string
) {
  return await transact(ctx, async (tx) => {
    const card = await getCardByNumber(tx.db, {
      workspaceId: actor.workspaceId,
      number,
    });
    await deleteAssignee(tx.db, { cardId: card.id, memberId });
    await recordActivity(tx, {
      workspaceId: actor.workspaceId,
      actorId: actor.id,
      source: "worklog",
      kind: "card.unassigned",
      title: `#${card.number} ${card.title}`,
      cardId: card.id,
      data: { assigneeId: memberId },
    });
    return await getCard(tx, actor.workspaceId, number);
  });
}

export async function watch(ctx: AppContext, cardId: string, memberId: string) {
  await insertWatcher(ctx.db, { cardId, memberId });
}

export async function unwatch(
  ctx: AppContext,
  cardId: string,
  memberId: string
) {
  await deleteWatcher(ctx.db, { cardId, memberId });
}

const MENTION = /(?:^|\s)@(?<handle>[a-z0-9][a-z0-9._-]*)/giu;

export async function addComment(
  ctx: AppContext,
  actor: Member,
  number: number,
  body: string
) {
  return await transact(ctx, async (tx) => {
    const card = await getCardByNumber(tx.db, {
      workspaceId: actor.workspaceId,
      number,
    });
    const comment = {
      id: generateId(),
      cardId: card.id,
      authorId: actor.id,
      body,
      createdAt: tx.now(),
    };
    await insertComment(tx.db, comment);
    await watch(tx, card.id, actor.id);
    const activity = await recordActivity(tx, {
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
    const mentioned = await listMembersByHandles(tx.db, {
      workspaceId: actor.workspaceId,
      handles,
    });
    for (const m of mentioned) {
      if (m.id === actor.id) {
        continue;
      }
      await raiseAttention(tx, {
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

    const watchers = await listWatchers(tx.db, { cardId: card.id });
    for (const w of watchers) {
      if (
        w.memberId === actor.id ||
        mentioned.some((m) => m.id === w.memberId)
      ) {
        continue;
      }
      await raiseAttention(tx, {
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
  });
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
  await transact(ctx, async (tx) => {
    await setCardTags(tx.db, { workspaceId, cardId, names: clean });
  });
}

const dueDay = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function describeEdit(patch: Parameters<typeof updateCard>[3]) {
  const said: string[] = [];
  if (patch.title !== undefined) {
    said.push("Renamed it");
  }
  if (patch.body !== undefined) {
    said.push(
      patch.body ? "Edited the description" : "Cleared the description"
    );
  }
  if (patch.tags !== undefined) {
    said.push(
      patch.tags.length > 0
        ? `Tagged ${patch.tags.map((t) => `#${t}`).join(" ")}`
        : "Removed its tags"
    );
  }
  if (patch.dueOn !== undefined) {
    said.push(
      patch.dueOn
        ? `Set it due ${dueDay.format(new Date(`${patch.dueOn}T00:00:00Z`))}`
        : "Cleared the due date"
    );
  }
  if (patch.boardId !== undefined) {
    said.push("Moved it to another board");
  }
  return said.join(" · ");
}
