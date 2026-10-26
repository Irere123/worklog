import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { body, errors, json, Ok, router } from "#api/router";
import type { Env } from "#api/router";
import {
  BoardSchema,
  CardDetailSchema,
  CardSchema,
  ColumnSchema,
  toBoard,
  toCard,
  toColumn,
  toComment,
  CommentSchema,
} from "#api/schemas";
import * as board from "#board/service";
import { CARD_STAGES } from "#db/schema";
import { resolveMember } from "#members/service";

const BoardId = z.object({ id: z.string() });
const CardNumber = z.object({
  number: z.coerce.number().int().positive().openapi({ example: 42 }),
});
const Entropy = z
  .literal([...board.ENTROPY_DAYS])
  .nullable()
  .openapi({
    description:
      "Days of inactivity before an active card drifts to Not now (3, 7, 30, 90 or 365)",
  });

const ws = (c: Context<Env>) => c.get("member").workspaceId;

// Card state changes are sub-resources (POST sets, DELETE undoes), like Fizzy's API.
function cardAction(opts: {
  method: "post" | "delete";
  path: string;
  operationId: string;
  summary: string;
}) {
  return createRoute({
    method: opts.method,
    path: `/v1/cards/{number}${opts.path}`,
    operationId: opts.operationId,
    tags: ["Board"],
    summary: opts.summary,
    request: { params: CardNumber },
    responses: { 200: json(CardSchema), ...errors },
  });
}

export const boardRoutes = router()
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/boards",
      operationId: "board.list",
      tags: ["Board"],
      responses: { 200: json(z.array(BoardSchema)), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const rows = await board.listBoards(ctx, ws(c));
      return c.json(
        await Promise.all(
          rows.map(async (b) => toBoard(await board.getBoard(ctx, ws(c), b.id)))
        ),
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/boards",
      operationId: "board.create",
      tags: ["Board"],
      summary:
        "Create a board. Every board has Maybe?, Not now and Done built in; you name the columns in between.",
      request: body(
        z.object({
          name: z.string().min(1),
          description: z.string().optional(),
          columns: z
            .array(z.string().min(1))
            .optional()
            .openapi({ example: ["Doing", "Review"] }),
          entropyDays: Entropy.optional(),
        })
      ),
      responses: { 201: json(BoardSchema, "Created"), ...errors },
    }),
    async (c) =>
      c.json(
        toBoard(
          await board.createBoard(
            c.get("ctx"),
            c.get("member"),
            c.req.valid("json")
          )
        ),
        201
      )
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/boards/{id}",
      operationId: "board.get",
      tags: ["Board"],
      request: { params: BoardId },
      responses: { 200: json(BoardSchema), ...errors },
    }),
    async (c) =>
      c.json(
        toBoard(
          await board.getBoard(c.get("ctx"), ws(c), c.req.valid("param").id)
        ),
        200
      )
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/v1/boards/{id}",
      operationId: "board.update",
      tags: ["Board"],
      request: {
        params: BoardId,
        ...body(
          z.object({
            name: z.string().min(1).optional(),
            description: z.string().nullable().optional(),
            entropyDays: Entropy.optional(),
            archived: z.boolean().optional(),
          })
        ),
      },
      responses: { 200: json(BoardSchema), ...errors },
    }),
    async (c) =>
      c.json(
        toBoard(
          await board.updateBoard(
            c.get("ctx"),
            ws(c),
            c.req.valid("param").id,
            c.req.valid("json")
          )
        ),
        200
      )
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/boards/{id}/columns",
      operationId: "column.create",
      tags: ["Board"],
      request: {
        params: BoardId,
        ...body(
          z.object({
            name: z.string().min(1),
            color: z.string().optional(),
            position: z.number().int().min(0).optional(),
          })
        ),
      },
      responses: { 201: json(ColumnSchema, "Created"), ...errors },
    }),
    async (c) =>
      c.json(
        toColumn(
          await board.addColumn(
            c.get("ctx"),
            ws(c),
            c.req.valid("param").id,
            c.req.valid("json")
          )
        ),
        201
      )
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/v1/columns/{id}",
      operationId: "column.update",
      tags: ["Board"],
      request: {
        params: BoardId,
        ...body(
          z.object({
            name: z.string().min(1).optional(),
            color: z.string().optional(),
          })
        ),
      },
      responses: { 200: json(ColumnSchema), ...errors },
    }),
    async (c) =>
      c.json(
        toColumn(
          await board.updateColumn(
            c.get("ctx"),
            ws(c),
            c.req.valid("param").id,
            c.req.valid("json")
          )
        ),
        200
      )
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/v1/columns/{id}",
      operationId: "column.delete",
      tags: ["Board"],
      summary: "Delete a column; its cards go back to Maybe?",
      request: { params: BoardId },
      responses: { 200: json(Ok), ...errors },
    }),
    async (c) => {
      await board.deleteColumn(c.get("ctx"), ws(c), c.req.valid("param").id);
      return c.json({ ok: true as const }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/cards",
      operationId: "card.list",
      tags: ["Board"],
      summary: "Cards — golden tickets first, then most recently active",
      request: {
        query: z.object({
          board: z.string().optional(),
          stage: z.enum(CARD_STAGES).optional(),
          assignee: z
            .string()
            .optional()
            .openapi({ description: 'Member id, handle or "me"' }),
          golden: z.enum(["true", "false"]).optional(),
          tag: z.string().optional(),
          q: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(500).optional(),
        }),
      },
      responses: { 200: json(z.array(CardSchema)), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const q = c.req.valid("query");
      const assignee = q.assignee
        ? await resolveMember(ctx, c.get("member"), q.assignee)
        : null;
      const rows = await board.listCards(ctx, ws(c), {
        boardId: q.board,
        stage: q.stage,
        assigneeId: assignee?.id,
        golden: q.golden === undefined ? undefined : q.golden === "true",
        tag: q.tag,
        q: q.q,
        limit: q.limit,
      });
      return c.json(rows.map(toCard), 200);
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/cards",
      operationId: "card.create",
      tags: ["Board"],
      summary: "Create a card. Without a column it lands in Maybe? for triage.",
      request: body(
        z.object({
          boardId: z.string(),
          title: z.string().min(1),
          body: z.string().optional(),
          columnId: z.string().optional(),
          assigneeIds: z.array(z.string()).optional(),
          tags: z.array(z.string()).optional(),
          golden: z.boolean().optional(),
          dueOn: z.iso.date().optional(),
        })
      ),
      responses: { 201: json(CardSchema, "Created"), ...errors },
    }),
    async (c) => {
      const me = c.get("member");
      const card = await board.createCard(c.get("ctx"), me, me.workspaceId, {
        ...c.req.valid("json"),
        source: me.kind === "agent" ? "agent" : "worklog",
      });
      return c.json(toCard(card), 201);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/cards/{number}",
      operationId: "card.get",
      tags: ["Board"],
      request: { params: CardNumber },
      responses: { 200: json(CardDetailSchema), ...errors },
    }),
    async (c) => {
      const detail = await board.getCardDetail(
        c.get("ctx"),
        ws(c),
        c.req.valid("param").number
      );
      return c.json(
        {
          ...toCard(detail),
          comments: detail.comments.map(toComment),
          watcherIds: detail.watcherIds,
        },
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/v1/cards/{number}",
      operationId: "card.update",
      tags: ["Board"],
      request: {
        params: CardNumber,
        ...body(
          z.object({
            title: z.string().min(1).optional(),
            body: z.string().nullable().optional(),
            dueOn: z.iso.date().nullable().optional(),
            boardId: z.string().optional(),
            tags: z.array(z.string()).optional(),
          })
        ),
      },
      responses: { 200: json(CardSchema), ...errors },
    }),
    async (c) =>
      c.json(
        toCard(
          await board.updateCard(
            c.get("ctx"),
            c.get("member"),
            c.req.valid("param").number,
            c.req.valid("json")
          )
        ),
        200
      )
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/cards/{number}/triage",
      operationId: "card.triage",
      tags: ["Board"],
      summary: "Move into a column",
      request: {
        params: CardNumber,
        ...body(z.object({ columnId: z.string() })),
      },
      responses: { 200: json(CardSchema), ...errors },
    }),
    async (c) => {
      const me = c.get("member");
      const { columnId } = c.req.valid("json");
      return c.json(
        toCard(
          await board.triage(
            c.get("ctx"),
            me,
            me.workspaceId,
            c.req.valid("param").number,
            columnId
          )
        ),
        200
      );
    }
  )
  .openapi(
    cardAction({
      method: "delete",
      path: "/triage",
      operationId: "card.untriage",
      summary: "Send back to Maybe?",
    }),
    async (c) => {
      const me = c.get("member");
      return c.json(
        toCard(
          await board.sendBackToTriage(
            c.get("ctx"),
            me,
            me.workspaceId,
            c.req.valid("param").number
          )
        ),
        200
      );
    }
  )
  .openapi(
    cardAction({
      method: "post",
      path: "/not_now",
      operationId: "card.postpone",
      summary: "Move to Not now",
    }),
    async (c) => {
      const me = c.get("member");
      return c.json(
        toCard(
          await board.postpone(
            c.get("ctx"),
            me,
            me.workspaceId,
            c.req.valid("param").number
          )
        ),
        200
      );
    }
  )
  .openapi(
    cardAction({
      method: "delete",
      path: "/not_now",
      operationId: "card.resume",
      summary: "Bring back from Not now (to Maybe?)",
    }),
    async (c) => {
      const me = c.get("member");
      return c.json(
        toCard(
          await board.resume(
            c.get("ctx"),
            me,
            me.workspaceId,
            c.req.valid("param").number
          )
        ),
        200
      );
    }
  )
  .openapi(
    cardAction({
      method: "post",
      path: "/closure",
      operationId: "card.close",
      summary: "Mark done",
    }),
    async (c) => {
      const me = c.get("member");
      return c.json(
        toCard(
          await board.close(
            c.get("ctx"),
            me,
            me.workspaceId,
            c.req.valid("param").number
          )
        ),
        200
      );
    }
  )
  .openapi(
    cardAction({
      method: "delete",
      path: "/closure",
      operationId: "card.reopen",
      summary: "Reopen (to Maybe?)",
    }),
    async (c) => {
      const me = c.get("member");
      return c.json(
        toCard(
          await board.reopen(
            c.get("ctx"),
            me,
            me.workspaceId,
            c.req.valid("param").number
          )
        ),
        200
      );
    }
  )
  .openapi(
    cardAction({
      method: "post",
      path: "/goldness",
      operationId: "card.gild",
      summary: "Make it a golden ticket",
    }),
    async (c) =>
      c.json(
        toCard(
          await board.setGolden(
            c.get("ctx"),
            c.get("member"),
            c.req.valid("param").number,
            true
          )
        ),
        200
      )
  )
  .openapi(
    cardAction({
      method: "delete",
      path: "/goldness",
      operationId: "card.ungild",
      summary: "Remove golden ticket",
    }),
    async (c) =>
      c.json(
        toCard(
          await board.setGolden(
            c.get("ctx"),
            c.get("member"),
            c.req.valid("param").number,
            false
          )
        ),
        200
      )
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/cards/{number}/assignments",
      operationId: "card.assign",
      tags: ["Board"],
      summary: "Assign someone (human or agent)",
      request: {
        params: CardNumber,
        ...body(
          z.object({
            memberId: z
              .string()
              .openapi({ description: "Member id or handle" }),
          })
        ),
      },
      responses: { 200: json(CardSchema), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const { memberId } = c.req.valid("json");
      const assignee = await resolveMember(ctx, me, memberId);
      return c.json(
        toCard(
          await board.assign(
            ctx,
            me,
            me.workspaceId,
            c.req.valid("param").number,
            assignee.id
          )
        ),
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/v1/cards/{number}/assignments/{memberId}",
      operationId: "card.unassign",
      tags: ["Board"],
      request: { params: CardNumber.extend({ memberId: z.string() }) },
      responses: { 200: json(CardSchema), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const { number, memberId } = c.req.valid("param");
      const assignee = await resolveMember(ctx, me, memberId);
      return c.json(
        toCard(await board.unassign(ctx, me, number, assignee.id)),
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/cards/{number}/comments",
      operationId: "card.comment",
      tags: ["Board"],
      summary:
        "Comment; @handles notify people, watchers get a collapsed heads-up",
      request: {
        params: CardNumber,
        ...body(z.object({ body: z.string().min(1) })),
      },
      responses: { 201: json(CommentSchema, "Created"), ...errors },
    }),
    async (c) =>
      c.json(
        toComment(
          await board.addComment(
            c.get("ctx"),
            c.get("member"),
            c.req.valid("param").number,
            c.req.valid("json").body
          )
        ),
        201
      )
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/cards/{number}/watch",
      operationId: "card.watch",
      tags: ["Board"],
      request: { params: CardNumber },
      responses: { 200: json(Ok), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const card = await board.findCard(
        ctx,
        ws(c),
        c.req.valid("param").number
      );
      await board.watch(ctx, card.id, c.get("member").id);
      return c.json({ ok: true as const }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/v1/cards/{number}/watch",
      operationId: "card.unwatch",
      tags: ["Board"],
      request: { params: CardNumber },
      responses: { 200: json(Ok), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const card = await board.findCard(
        ctx,
        ws(c),
        c.req.valid("param").number
      );
      await board.unwatch(ctx, card.id, c.get("member").id);
      return c.json({ ok: true as const }, 200);
    }
  );
