import { createRoute, z } from "@hono/zod-openapi";

import {
  body,
  errors,
  Id,
  json,
  Ok,
  requireAdmin,
  requireSelfOrAdmin,
  respond,
  router,
} from "#api/router";
import {
  AssignIdentityRequest,
  Identity,
  IdentityAssignedResponse,
  IdentityLinkedResponse,
  LinkIdentityRequest,
  ListIdentitiesQuery,
  MemberRef,
} from "#api/schemas/members";
import { listIdentities } from "#db/queries/identities";
import { linkByHandle, linkIdentityToMember } from "#ingest/identity";
import { notFound } from "#lib/errors";
import { resolveMember } from "#work/members";

export const identityRoutes = router()
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/members/{ref}/identities",
      operationId: "identity.list",
      tags: ["People"],
      summary: "Accounts in connected tools that are this member",
      request: { params: MemberRef },
      responses: { 200: json(z.array(Identity)), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const m = await resolveMember(
        ctx,
        c.get("member"),
        c.req.valid("param").ref
      );
      const found = await listIdentities(ctx.db, {
        workspaceId: m.workspaceId,
        memberId: m.id,
      });
      return respond(c, z.array(Identity), found, 200);
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/members/{ref}/identities",
      operationId: "identity.link",
      tags: ["People"],
      summary:
        "Link an account in a connected tool to this member; its past activity is re-attributed",
      description:
        "Signing in with GitHub, Slack or Discord links those accounts automatically. Use this for other tools (self-hosted forges, custom connections) or before someone signs in. `provider` is the identity namespace (`github`, `slack`, `discord`, `gitea:git.example.com`…).",
      request: { params: MemberRef, ...body(LinkIdentityRequest) },
      responses: { 201: json(IdentityLinkedResponse, "Linked"), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const m = await resolveMember(ctx, me, c.req.valid("param").ref);
      requireSelfOrAdmin(me, m);
      const { identity, reattributed } = await linkByHandle(
        ctx,
        m.workspaceId,
        m.id,
        c.req.valid("json")
      );
      return respond(
        c,
        IdentityLinkedResponse,
        { ...identity, reattributed },
        201
      );
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/v1/members/{ref}/identities/{id}",
      operationId: "identity.unlink",
      tags: ["People"],
      request: { params: MemberRef.extend({ id: z.string() }) },
      responses: { 200: json(Ok), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const { ref, id } = c.req.valid("param");
      const m = await resolveMember(ctx, me, ref);
      requireSelfOrAdmin(me, m);
      const mine = await listIdentities(ctx.db, {
        workspaceId: m.workspaceId,
        memberId: m.id,
      });
      if (!mine.some((i) => i.id === id)) {
        throw notFound("Identity");
      }
      await linkIdentityToMember(ctx, m.workspaceId, id, null);
      return respond(c, Ok, { ok: true }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/identities",
      operationId: "identity.listAll",
      tags: ["Connections"],
      summary:
        "Accounts seen in connected tools — filter to the ones not matched to anyone yet",
      request: { query: ListIdentitiesQuery },
      responses: { 200: json(z.array(Identity)), ...errors },
    }),
    async (c) => {
      const rows = await listIdentities(c.get("ctx").db, {
        workspaceId: c.get("member").workspaceId,
        unlinked: c.req.valid("query").unlinked === "true",
      });
      return respond(c, z.array(Identity), rows, 200);
    }
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/v1/identities/{id}",
      operationId: "identity.assign",
      tags: ["Connections"],
      summary:
        "Match an account to a member (admins) — their past activity is re-attributed",
      request: { params: Id, ...body(AssignIdentityRequest) },
      responses: { 200: json(IdentityAssignedResponse), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      requireAdmin(me);
      const ref = c.req.valid("json").member;
      const member = ref ? await resolveMember(ctx, me, ref) : null;
      const { identity, reattributed } = await linkIdentityToMember(
        ctx,
        me.workspaceId,
        c.req.valid("param").id,
        member?.id ?? null
      );
      return respond(
        c,
        IdentityAssignedResponse,
        { identity, reattributed },
        200
      );
    }
  );
