import { createRoute, z } from "@hono/zod-openapi";

import type { AppContext } from "#context";
import { listActiveTokens } from "#db/queries/api-tokens";
import { getPersonalAgent, listMembers } from "#db/queries/members";
import { getWorkspaceById } from "#db/queries/workspaces";
import { inviteEmail } from "#emails";
import {
  body,
  errors,
  json,
  Ok,
  requireAdmin,
  requireSelfOrAdmin,
  respond,
  router,
} from "#http/router";
import {
  CreateMemberRequest,
  CreateTokenRequest,
  ListMembersQuery,
  MeResponse,
  MemberCreatedResponse,
  MemberRef,
  MemberResponse,
  Token,
  TokenInfo,
  UpdateMeRequest,
} from "#http/schemas/members";
import { log } from "#telemetry/log";
import * as people from "#work/members";

export const memberRoutes = router()
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/me",
      operationId: "me.get",
      tags: ["People"],
      summary: "Who am I: member, workspace and personal assistant",
      responses: { 200: json(MeResponse), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const assistant =
        me.kind === "human"
          ? await getPersonalAgent(ctx.db, { ownerId: me.id })
          : null;
      const workspace = await getWorkspaceById(ctx.db, { id: me.workspaceId });
      return respond(
        c,
        MeResponse,
        { member: me, workspace, assistant, ai: ctx.models !== null },
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/v1/me",
      operationId: "me.update",
      tags: ["People"],
      summary: "Update your profile, time zone and working hours",
      request: body(UpdateMeRequest),
      responses: { 200: json(MemberResponse), ...errors },
    }),
    async (c) =>
      respond(
        c,
        MemberResponse,
        await people.updateMember(
          c.get("ctx"),
          c.get("member"),
          c.req.valid("json")
        ),
        200
      )
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/members",
      operationId: "member.list",
      tags: ["People"],
      summary: "Everyone in the workspace — humans and agents",
      request: { query: ListMembersQuery },
      responses: { 200: json(z.array(MemberResponse)), ...errors },
    }),
    async (c) => {
      const me = c.get("member");
      const rows = await listMembers(c.get("ctx").db, {
        workspaceId: me.workspaceId,
        kind: c.req.valid("query").kind,
      });
      return respond(c, z.array(MemberResponse), rows, 200);
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/members",
      operationId: "member.create",
      tags: ["People"],
      summary: "Add a teammate or an agent",
      description:
        "Humans get a personal assistant and default automations; if you give an email, they're invited — when they sign in with that address (email link, GitHub, Discord or Slack) they join this workspace. For agents (e.g. a coding agent that reports its work), set `issueToken` to receive an API key for it.",
      request: body(CreateMemberRequest),
      responses: { 201: json(MemberCreatedResponse, "Created"), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const { issueToken, ...input } = c.req.valid("json");
      // Anyone may register an agent that works for them; adding people or other agents is for admins.
      if (!(input.kind === "agent" && input.ownerId === me.id)) {
        requireAdmin(me);
      }
      if (input.role === "owner") {
        requireAdmin(me);
      }
      const member = await people.createMember(ctx, me.workspaceId, input);
      const token =
        issueToken === true
          ? await people.createToken(ctx, member, "initial")
          : null;
      const inviteTo = member.kind === "human" ? member.email : null;
      const invited = Boolean(inviteTo);
      if (inviteTo) {
        const ws = await getWorkspaceById(ctx.db, { id: me.workspaceId });
        void sendInvite(ctx, inviteTo, me.name, ws.name);
      }
      return respond(c, MemberCreatedResponse, { member, token, invited }, 201);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/members/{ref}",
      operationId: "member.get",
      tags: ["People"],
      request: { params: MemberRef },
      responses: { 200: json(MemberResponse), ...errors },
    }),
    async (c) =>
      respond(
        c,
        MemberResponse,
        await people.resolveMember(
          c.get("ctx"),
          c.get("member"),
          c.req.valid("param").ref
        ),
        200
      )
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/members/{ref}/tokens",
      operationId: "token.create",
      tags: ["People"],
      summary:
        "Create an API key that acts as this member (yourself, an agent you own, or — admins — anyone)",
      description:
        "Keys are for agents, bots, scripts and integrations. Scopes: `read` (GET), `write` (any change), `ingest` (only report activity and logs — ideal for CI and custom connectors).",
      request: { params: MemberRef, ...body(CreateTokenRequest) },
      responses: { 201: json(Token, "Created"), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const m = await people.resolveMember(ctx, me, c.req.valid("param").ref);
      requireSelfOrAdmin(me, m);
      const { name, scopes, expiresInDays } = c.req.valid("json");
      const expiresAt =
        expiresInDays === undefined
          ? null
          : new Date(ctx.now().getTime() + expiresInDays * 86_400_000);
      return respond(
        c,
        Token,
        await people.createToken(ctx, m, name, { scopes, expiresAt }),
        201
      );
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/members/{ref}/tokens",
      operationId: "token.list",
      tags: ["People"],
      summary:
        "API keys that act as this member (secrets are never shown again)",
      request: { params: MemberRef },
      responses: { 200: json(z.array(TokenInfo)), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const m = await people.resolveMember(ctx, me, c.req.valid("param").ref);
      requireSelfOrAdmin(me, m);
      const tokens = await listActiveTokens(ctx.db, { memberId: m.id });
      return respond(c, z.array(TokenInfo), tokens, 200);
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/v1/tokens/{id}",
      operationId: "token.revoke",
      tags: ["People"],
      request: { params: z.object({ id: z.string() }) },
      responses: { 200: json(Ok), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      await people.revokeToken(ctx, me, c.req.valid("param").id);
      return respond(c, Ok, { ok: true }, 200);
    }
  );

/** Not awaited by the route: a slow or failing mail server must not fail the invite. */
async function sendInvite(
  ctx: AppContext,
  to: string,
  inviter: string,
  workspace: string
) {
  try {
    await ctx.mailer.send({
      to,
      ...(await inviteEmail({
        inviter,
        workspace,
        home: ctx.config.PUBLIC_URL,
      })),
    });
  } catch (error) {
    log.error("members: invite email failed", { error });
  }
}
