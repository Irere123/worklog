import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { body, errors, Id, json, Ok, respond, router } from "#api/router";
import type { Env } from "#api/router";
import {
  AssignCardRequest,
  Board,
  BoardResponse,
  Card,
  CardDetailResponse,
  CardNumber,
  Column,
  Comment,
  CreateBoardRequest,
  CreateCardRequest,
  CreateColumnRequest,
  CreateCommentRequest,
  ListCardsQuery,
  TriageCardRequest,
  UpdateBoardRequest,
  UpdateCardRequest,
  UpdateColumnRequest,
} from "#api/schemas/board";
import { getBoardWithColumns, listBoardsWithColumns } from "#db/queries/boards";
import { getCardByNumber } from "#db/queries/cards";
import * as board from "#work/board";
import { resolveMember } from "#work/members";

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
    responses: { 200: json(Card), ...errors },
  });
}

export const boardRoutes = router()
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/boards",
      operationId: "board.list",
      tags: ["Board"],
      responses: { 200: json(z.array(Board)), ...errors },
    }),
    async (c) => {
      const rows = await listBoardsWithColumns(c.get("ctx").db, {
        workspaceId: ws(c),
      });
      return respond(c, z.array(BoardResponse), rows, 200);
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
      request: body(CreateBoardRequest),
      responses: { 201: json(Board, "Created"), ...errors },
    }),
    async (c) =>
      respond(
        c,
        BoardResponse,
        await board.createBoard(
          c.get("ctx"),
          c.get("member"),
          c.req.valid("json")
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
      request: { params: Id },
      responses: { 200: json(Board), ...errors },
    }),
    async (c) =>
      respond(
        c,
        BoardResponse,
        await getBoardWithColumns(c.get("ctx").db, {
          workspaceId: ws(c),
          id: c.req.valid("param").id,
        }),
        200
      )
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/v1/boards/{id}",
      operationId: "board.update",
      tags: ["Board"],
      request: { params: Id, ...body(UpdateBoardRequest) },
      responses: { 200: json(Board), ...errors },
    }),
    async (c) =>
      respond(
        c,
        BoardResponse,
        await board.updateBoard(
          c.get("ctx"),
          ws(c),
          c.req.valid("param").id,
          c.req.valid("json")
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
      request: { params: Id, ...body(CreateColumnRequest) },
      responses: { 201: json(Column, "Created"), ...errors },
    }),
    async (c) =>
      respond(
        c,
        Column,
        await board.addColumn(
          c.get("ctx"),
          ws(c),
          c.req.valid("param").id,
          c.req.valid("json")
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
      request: { params: Id, ...body(UpdateColumnRequest) },
      responses: { 200: json(Column), ...errors },
    }),
    async (c) =>
      respond(
        c,
        Column,
        await board.updateColumn(
          c.get("ctx"),
          ws(c),
          c.req.valid("param").id,
          c.req.valid("json")
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
      request: { params: Id },
      responses: { 200: json(Ok), ...errors },
    }),
    async (c) => {
      await board.deleteColumn(c.get("ctx"), ws(c), c.req.valid("param").id);
      return respond(c, Ok, { ok: true }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/cards",
      operationId: "card.list",
      tags: ["Board"],
      summary: "Cards — golden tickets first, then most recently active",
      request: { query: ListCardsQuery },
      responses: { 200: json(z.array(Card)), ...errors },
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
      return respond(c, z.array(Card), rows, 200);
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/cards",
      operationId: "card.create",
      tags: ["Board"],
      summary: "Create a card. Without a column it lands in Maybe? for triage.",
      request: body(CreateCardRequest),
      responses: { 201: json(Card, "Created"), ...errors },
    }),
    async (c) => {
      const me = c.get("member");
      const card = await board.createCard(c.get("ctx"), me, me.workspaceId, {
        ...c.req.valid("json"),
        source: me.kind === "agent" ? "agent" : "worklog",
      });
      return respond(c, Card, card, 201);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/cards/{number}",
      operationId: "card.get",
      tags: ["Board"],
      request: { params: CardNumber },
      responses: { 200: json(CardDetailResponse), ...errors },
    }),
    async (c) =>
      respond(
        c,
        CardDetailResponse,
        await board.getCardDetail(
          c.get("ctx"),
          ws(c),
          c.req.valid("param").number
        ),
        200
      )
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/v1/cards/{number}",
      operationId: "card.update",
      tags: ["Board"],
      request: { params: CardNumber, ...body(UpdateCardRequest) },
      responses: { 200: json(Card), ...errors },
    }),
    async (c) =>
      respond(
        c,
        Card,
        await board.updateCard(
          c.get("ctx"),
          c.get("member"),
          c.req.valid("param").number,
          c.req.valid("json")
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
      request: { params: CardNumber, ...body(TriageCardRequest) },
      responses: { 200: json(Card), ...errors },
    }),
    async (c) => {
      const me = c.get("member");
      const { columnId } = c.req.valid("json");
      return respond(
        c,
        Card,
        await board.triage(
          c.get("ctx"),
          me,
          me.workspaceId,
          c.req.valid("param").number,
          columnId
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
      return respond(
        c,
        Card,
        await board.sendBackToTriage(
          c.get("ctx"),
          me,
          me.workspaceId,
          c.req.valid("param").number
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
      return respond(
        c,
        Card,
        await board.postpone(
          c.get("ctx"),
          me,
          me.workspaceId,
          c.req.valid("param").number
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
      return respond(
        c,
        Card,
        await board.resume(
          c.get("ctx"),
          me,
          me.workspaceId,
          c.req.valid("param").number
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
      return respond(
        c,
        Card,
        await board.close(
          c.get("ctx"),
          me,
          me.workspaceId,
          c.req.valid("param").number
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
      return respond(
        c,
        Card,
        await board.reopen(
          c.get("ctx"),
          me,
          me.workspaceId,
          c.req.valid("param").number
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
      respond(
        c,
        Card,
        await board.setGolden(
          c.get("ctx"),
          c.get("member"),
          c.req.valid("param").number,
          true
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
      respond(
        c,
        Card,
        await board.setGolden(
          c.get("ctx"),
          c.get("member"),
          c.req.valid("param").number,
          false
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
      request: { params: CardNumber, ...body(AssignCardRequest) },
      responses: { 200: json(Card), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const { memberId } = c.req.valid("json");
      const assignee = await resolveMember(ctx, me, memberId);
      return respond(
        c,
        Card,
        await board.assign(
          ctx,
          me,
          me.workspaceId,
          c.req.valid("param").number,
          assignee.id
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
      responses: { 200: json(Card), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const { number, memberId } = c.req.valid("param");
      const assignee = await resolveMember(ctx, me, memberId);
      return respond(
        c,
        Card,
        await board.unassign(ctx, me, number, assignee.id),
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
      request: { params: CardNumber, ...body(CreateCommentRequest) },
      responses: { 201: json(Comment, "Created"), ...errors },
    }),
    async (c) =>
      respond(
        c,
        Comment,
        await board.addComment(
          c.get("ctx"),
          c.get("member"),
          c.req.valid("param").number,
          c.req.valid("json").body
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
      const card = await getCardByNumber(ctx.db, {
        workspaceId: ws(c),
        number: c.req.valid("param").number,
      });
      await board.watch(ctx, card.id, c.get("member").id);
      return respond(c, Ok, { ok: true }, 200);
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
      const card = await getCardByNumber(ctx.db, {
        workspaceId: ws(c),
        number: c.req.valid("param").number,
      });
      await board.unwatch(ctx, card.id, c.get("member").id);
      return respond(c, Ok, { ok: true }, 200);
    }
  );
