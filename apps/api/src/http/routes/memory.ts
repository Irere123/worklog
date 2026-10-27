import { createRoute, z } from "@hono/zod-openapi";

import { addMemory, forgetMemory } from "#agent/memory";
import { exportMemory } from "#agent/memory/export";
import { listMemories, listMemoryLineage } from "#db/queries/memories";
import { body, errors, Id, json, Ok, respond, router } from "#http/router";
import {
  CreateMemoryRequest,
  ListMemoriesQuery,
  Memory,
  MemoryExport,
} from "#http/schemas/memory";
import { notFound } from "#lib/errors";

export const memoryRoutes = router()
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/memories",
      operationId: "memory.list",
      tags: ["Assistant"],
      summary: "What your assistant has learned about you (you can correct it)",
      request: { query: ListMemoriesQuery },
      responses: { 200: json(z.array(Memory)), ...errors },
    }),
    async (c) => {
      const { kind, q } = c.req.valid("query");
      const ctx = c.get("ctx");
      const rows = await listMemories(ctx.db, {
        memberId: c.get("member").id,
        kinds: kind ? [kind] : undefined,
        q,
        includePrivate: true,
        now: ctx.now(),
      });
      return respond(c, z.array(Memory), rows, 200);
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/memories",
      operationId: "memory.create",
      tags: ["Assistant"],
      summary: "Tell your assistant something about how you work",
      request: body(CreateMemoryRequest),
      responses: { 201: json(Memory, "Saved"), ...errors },
    }),
    async (c) => {
      const me = c.get("member");
      const { expiresAt, ...input } = c.req.valid("json");
      const row = await addMemory(c.get("ctx"), {
        workspaceId: me.workspaceId,
        memberId: me.id,
        source: "self",
        ...input,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      });
      return respond(c, Memory, row, 201);
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/v1/memories/{id}",
      operationId: "memory.forget",
      tags: ["Assistant"],
      request: { params: Id },
      responses: { 200: json(Ok), ...errors },
    }),
    async (c) => {
      await forgetMemory(
        c.get("ctx"),
        c.get("member").id,
        c.req.valid("param").id
      );
      return respond(c, Ok, { ok: true }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/memories/export",
      operationId: "memory.export",
      tags: ["Assistant"],
      summary: "Everything your assistant knows about you, as Markdown files",
      description:
        "Split by visibility, so you can share `team/` and keep `private/` to yourself. The files only change when your memory does, so committing each export to a git repo keeps a history of what your assistant learned.",
      responses: { 200: json(MemoryExport), ...errors },
    }),
    async (c) =>
      respond(
        c,
        MemoryExport,
        { files: await exportMemory(c.get("ctx"), c.get("member")) },
        200
      )
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/memories/{id}/history",
      operationId: "memory.history",
      tags: ["Assistant"],
      summary:
        "Where a memory came from: the lines it replaced and what replaced it",
      description:
        "Oldest first, including the memory itself. Follow `supersededBy` to see which line replaced which.",
      request: { params: Id },
      responses: { 200: json(z.array(Memory)), ...errors },
    }),
    async (c) => {
      const rows = await listMemoryLineage(c.get("ctx").db, {
        memberId: c.get("member").id,
        id: c.req.valid("param").id,
      });
      if (!rows.length) {
        throw notFound("Memory");
      }
      return respond(c, z.array(Memory), rows, 200);
    }
  );
