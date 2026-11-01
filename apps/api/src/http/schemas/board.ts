import { z } from "@hono/zod-openapi";

import type { BoardWithColumns } from "#db/queries/boards";
import { CARD_STAGES } from "#db/schema";
import { ENTROPY_DAYS } from "#work/board";

import { derived, Timestamp } from "./common";

export const CardNumber = z.object({
  number: z.coerce.number().int().positive().openapi({ example: 42 }),
});

// One literal per value: the generator publishes a multi-value literal as an enum of its first.
const Entropy = z
  .union(ENTROPY_DAYS.map((days) => z.literal(days)))
  .nullable()
  .openapi({
    description:
      "Days of inactivity before an active card drifts to Not now (3, 7, 30, 90 or 365)",
  });

export const Column = z
  .object({
    id: z.string(),
    boardId: z.string(),
    name: z.string().min(1),
    color: z.string(),
    position: z.number().int(),
  })
  .openapi("Column");

export const CreateColumnRequest = z.object({
  name: Column.shape.name,
  color: z.string().optional(),
  position: z.number().int().min(0).optional(),
});

export const UpdateColumnRequest = Column.pick({
  name: true,
  color: true,
}).partial();

export const Board = z
  .object({
    id: z.string(),
    name: z.string().min(1),
    description: z.string().nullable(),
    entropyDays: z
      .number()
      .int()
      .nullable()
      .openapi({ description: "null = inherit the workspace setting" }),
    archived: z.boolean(),
    createdAt: Timestamp,
    columns: z.array(Column),
  })
  .openapi("Board");

export const BoardResponse = derived(Board, (b: BoardWithColumns) => ({
  ...b,
  archived: b.archivedAt !== null,
}));

export const CreateBoardRequest = z.object({
  name: Board.shape.name,
  description: z.string().optional(),
  columns: z
    .array(z.string().min(1))
    .optional()
    .openapi({ example: ["Doing", "Review"] }),
  entropyDays: Entropy.optional(),
});

export const UpdateBoardRequest = z.object({
  name: Board.shape.name.optional(),
  description: z.string().nullable().optional(),
  entropyDays: Entropy.optional(),
  archived: z.boolean().optional(),
});

export const Card = z
  .object({
    id: z.string(),
    number: z.number().int(),
    boardId: z.string(),
    title: z.string().min(1),
    body: z.string().nullable(),
    stage: z.enum(CARD_STAGES).openapi({
      description:
        "triage = Maybe?, active = in a column, not_now = postponed, done = closed",
    }),
    columnId: z.string().nullable(),
    columnName: z.string().nullable(),
    golden: z.boolean(),
    dueOn: z.string().nullable(),
    assigneeIds: z.array(z.string()),
    tags: z.array(z.string()),
    source: z.string(),
    externalUrl: z.string().nullable(),
    createdById: z.string().nullable(),
    lastActiveAt: Timestamp,
    postponedAt: Timestamp.nullable(),
    autoPostponed: z.boolean(),
    closedAt: Timestamp.nullable(),
    createdAt: Timestamp,
    entropy: z
      .object({
        days: z.number().int(),
        autoPostponeAt: Timestamp,
        postponingSoon: z.boolean(),
      })
      .nullable()
      .openapi({
        description:
          "For active cards: when it drifts to Not now without activity",
      }),
  })
  .openapi("Card");

export const ListCardsQuery = z.object({
  board: z.string().optional(),
  stage: z.enum(CARD_STAGES).optional(),
  assignee: z
    .string()
    .optional()
    .openapi({ description: 'Member id, handle or "me"' }),
  addedBy: z
    .string()
    .optional()
    .openapi({ description: 'Who added the card: member id, handle or "me"' }),
  golden: z.enum(["true", "false"]).optional(),
  tag: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const CreateCardRequest = z.object({
  boardId: z.string(),
  title: Card.shape.title,
  body: z.string().optional(),
  columnId: z.string().optional(),
  assigneeIds: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  golden: z.boolean().optional(),
  dueOn: z.iso.date().optional(),
});

export const UpdateCardRequest = z.object({
  title: Card.shape.title.optional(),
  body: z.string().nullable().optional(),
  dueOn: z.iso.date().nullable().optional(),
  boardId: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const TriageCardRequest = z.object({ columnId: z.string() });

export const AssignCardRequest = z.object({
  memberId: z.string().openapi({ description: "Member id or handle" }),
});

export const Comment = z
  .object({
    id: z.string(),
    authorId: z.string().nullable(),
    body: z.string().min(1),
    createdAt: Timestamp,
  })
  .openapi("Comment");

export const CreateCommentRequest = Comment.pick({ body: true });

export const CardDetailResponse = Card.extend({
  comments: z.array(Comment),
  watcherIds: z.array(z.string()),
}).openapi("CardDetail");
