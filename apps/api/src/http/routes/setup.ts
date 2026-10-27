import { createRoute, z } from "@hono/zod-openapi";

import { getPersonalAgent, listMemberships } from "#db/queries/members";
import { countWorkspaces, getWorkspaceById } from "#db/queries/workspaces";
import { body, errors, json, respond, router } from "#http/router";
import {
  AuthConfigResponse,
  CreateWorkspaceRequest,
  SessionResponse,
  SetupRequest,
  SetupResponse,
  WorkspaceCreatedResponse,
} from "#http/schemas/members";
import { enabledSocialProviders } from "#lib/auth";
import { safeEqual } from "#lib/crypto";
import { forbidden } from "#lib/errors";
import * as people from "#work/members";

const SetupHeaders = z.object({ "x-setup-secret": z.string().optional() });

export const setupRoutes = router().openapi(
  createRoute({
    method: "post",
    path: "/v1/setup",
    operationId: "setup.create",
    tags: ["Setup"],
    summary:
      "Create a workspace, its owner, the owner's assistant and a first API token",
    description:
      "Open while no workspace exists; afterwards requires the `x-setup-secret` header (SETUP_SECRET).",
    security: [],
    request: {
      headers: SetupHeaders,
      ...body(SetupRequest),
    },
    responses: { 201: json(SetupResponse, "Created"), ...errors },
  }),
  async (c) => {
    const ctx = c.get("ctx");
    const n = await countWorkspaces(ctx.db);
    const secret = c.req.valid("header")["x-setup-secret"];
    if (
      n > 0 &&
      !(
        ctx.config.SETUP_SECRET &&
        secret &&
        safeEqual(secret, ctx.config.SETUP_SECRET)
      )
    ) {
      throw forbidden("Setup is closed: this server already has a workspace");
    }
    const result = await people.setupWorkspace(ctx, c.req.valid("json"));
    return respond(c, SetupResponse, result, 201);
  }
);

export const authConfigRoutes = router().openapi(
  createRoute({
    method: "get",
    path: "/v1/auth/config",
    operationId: "auth.config",
    tags: ["Setup"],
    summary: "How people can sign in to this server",
    description:
      "Sign-in itself is handled by Better Auth under `/api/auth/*`: `POST /api/auth/sign-in/magic-link {email, callbackURL}`, or `POST /api/auth/sign-in/social {provider, callbackURL}`. Web clients get a session cookie; mobile clients read the `set-auth-token` response header and send it as `Authorization: Bearer <token>`.",
    security: [],
    responses: { 200: json(AuthConfigResponse) },
  }),
  (c) =>
    respond(
      c,
      AuthConfigResponse,
      {
        magicLink: true,
        socialProviders: enabledSocialProviders(c.get("ctx").config),
        authBasePath: "/api/auth",
      },
      200
    )
);

export const sessionRoutes = router()
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/session",
      operationId: "session.get",
      tags: ["Setup"],
      summary: "Who is signed in, and which workspaces they belong to",
      description:
        "Choose a workspace for later requests with the `x-worklog-workspace` header (id or slug). Without it, your first workspace is used.",
      responses: { 200: json(SessionResponse), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const user = c.get("user");
      if (!user) {
        const me = c.get("member");
        const workspace = await getWorkspaceById(ctx.db, {
          id: me.workspaceId,
        });
        return respond(
          c,
          SessionResponse,
          {
            user: null,
            memberships: [{ workspace, member: me }],
            via: "api_key",
          },
          200
        );
      }
      const memberships = await listMemberships(ctx.db, { userId: user.id });
      return respond(
        c,
        SessionResponse,
        {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            image:
              "image" in user && typeof user.image === "string"
                ? user.image
                : null,
          },
          memberships,
          via: "session",
        },
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/workspaces",
      operationId: "workspace.create",
      tags: ["Setup"],
      summary: "Create a workspace (signed-in people); you become its owner",
      request: body(CreateWorkspaceRequest),
      responses: {
        201: json(WorkspaceCreatedResponse, "Created"),
        ...errors,
      },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const user = c.get("user");
      if (!user) {
        throw forbidden(
          "Workspaces are created by signed-in people, not API keys"
        );
      }
      const { workspace, member } = await people.createWorkspaceForUser(
        ctx,
        user,
        c.req.valid("json")
      );
      const assistant = await getPersonalAgent(ctx.db, { ownerId: member.id });
      return respond(
        c,
        WorkspaceCreatedResponse,
        { workspace, member, assistant },
        201
      );
    }
  );
