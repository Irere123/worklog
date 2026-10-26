import { createRoute, z } from "@hono/zod-openapi";

import { workSnapshot } from "#activity/snapshot";
import {
  body,
  errors,
  json,
  Ok,
  requireAdmin,
  requireSelfOrAdmin,
  router,
} from "#api/router";
import {
  IdentitySchema,
  MemberSchema,
  SettingsSchema,
  SnapshotSchema,
  TokenInfoSchema,
  TokenSchema,
  toIdentity,
  toToken,
  toTokenInfo,
  toMember,
  toSnapshot,
  toWorkspace,
  WorkspaceSchema,
} from "#api/schemas";
import { enabledSocialProviders } from "#auth/auth";
import type { AppContext } from "#context";
import { API_SCOPES, workspaces, MEMBER_KINDS, ROLES } from "#db/schema";
import {
  linkByHandle,
  linkIdentityToMember,
  listIdentities,
} from "#ingest/identity";
import { safeEqual } from "#lib/crypto";
import { forbidden, notFound } from "#lib/errors";
import * as people from "#members/service";

const Ref = z.object({
  ref: z
    .string()
    .openapi({ description: 'Member id, handle, or "me"', example: "me" }),
});

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
      headers: z.object({ "x-setup-secret": z.string().optional() }),
      ...body(
        z.object({
          workspaceName: z.string().min(1),
          name: z.string().min(1),
          email: z.email().optional(),
          handle: z.string().optional(),
          timezone: z.string().optional().openapi({ example: "Africa/Kigali" }),
        })
      ),
    },
    responses: {
      201: json(
        z.object({
          workspace: WorkspaceSchema,
          member: MemberSchema,
          assistant: MemberSchema,
          token: TokenSchema,
        }),
        "Created"
      ),
      ...errors,
    },
  }),
  async (c) => {
    const ctx = c.get("ctx");
    const n = await ctx.db.$count(workspaces);
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
    return c.json(
      {
        workspace: toWorkspace(result.workspace),
        member: toMember(result.member),
        assistant: toMember(result.assistant),
        token: toToken(result.token),
      },
      201
    );
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
    responses: {
      200: json(
        z.object({
          magicLink: z.boolean(),
          socialProviders: z.array(z.enum(["github", "discord", "slack"])),
          authBasePath: z.string(),
        })
      ),
    },
  }),
  (c) =>
    c.json(
      {
        magicLink: true,
        socialProviders: enabledSocialProviders(c.get("ctx").config),
        authBasePath: "/api/auth",
      },
      200
    )
);

const MembershipSchema = z.object({
  workspace: WorkspaceSchema,
  member: MemberSchema,
});

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
      responses: {
        200: json(
          z.object({
            user: z
              .object({
                id: z.string(),
                name: z.string(),
                email: z.string(),
                image: z.string().nullable().optional(),
              })
              .nullable(),
            memberships: z.array(MembershipSchema),
            via: z.enum(["session", "api_key"]),
          })
        ),
        ...errors,
      },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const user = c.get("user");
      if (!user) {
        const me = c.get("member");
        return c.json(
          {
            user: null,
            memberships: [
              {
                workspace: toWorkspace(
                  await people.getWorkspace(ctx, me.workspaceId)
                ),
                member: toMember(me),
              },
            ],
            via: "api_key" as const,
          },
          200
        );
      }
      const memberships = await people.membershipsOf(ctx, user.id);
      return c.json(
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
          memberships: memberships.map((m) => ({
            workspace: toWorkspace(m.workspace),
            member: toMember(m.member),
          })),
          via: "session" as const,
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
      request: body(
        z.object({
          name: z.string().min(1),
          timezone: z.string().optional().openapi({ example: "Africa/Kigali" }),
          handle: z.string().optional(),
        })
      ),
      responses: {
        201: json(
          MembershipSchema.extend({ assistant: MemberSchema }),
          "Created"
        ),
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
      return c.json(
        {
          workspace: toWorkspace(workspace),
          member: toMember(member),
          assistant: toMember(await people.personalAgentOf(ctx, member.id)),
        },
        201
      );
    }
  );

export const peopleRoutes = router()
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/me",
      operationId: "me.get",
      tags: ["People"],
      summary: "Who am I: member, workspace and personal assistant",
      responses: {
        200: json(
          z.object({
            member: MemberSchema,
            workspace: WorkspaceSchema,
            assistant: MemberSchema.nullable(),
          })
        ),
        ...errors,
      },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const assistant =
        me.kind === "human" ? await people.personalAgentOf(ctx, me.id) : null;
      return c.json(
        {
          member: toMember(me),
          workspace: toWorkspace(
            await people.getWorkspace(ctx, me.workspaceId)
          ),
          assistant: assistant ? toMember(assistant) : null,
        },
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
      request: body(
        z.object({
          name: z.string().min(1).optional(),
          email: z.email().nullable().optional(),
          title: z.string().nullable().optional(),
          timezone: z.string().nullable().optional(),
          settings: SettingsSchema.optional(),
        })
      ),
      responses: { 200: json(MemberSchema), ...errors },
    }),
    async (c) => {
      const updated = await people.updateMember(
        c.get("ctx"),
        c.get("member"),
        c.req.valid("json")
      );
      return c.json(toMember(updated), 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/members",
      operationId: "member.list",
      tags: ["People"],
      summary: "Everyone in the workspace — humans and agents",
      request: { query: z.object({ kind: z.enum(MEMBER_KINDS).optional() }) },
      responses: { 200: json(z.array(MemberSchema)), ...errors },
    }),
    async (c) => {
      const me = c.get("member");
      const rows = await people.listMembers(
        c.get("ctx"),
        me.workspaceId,
        c.req.valid("query").kind
      );
      return c.json(rows.map(toMember), 200);
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
      request: body(
        z.object({
          kind: z.enum(MEMBER_KINDS),
          name: z.string().min(1),
          handle: z.string().optional(),
          email: z.email().optional(),
          title: z.string().optional(),
          role: z.enum(ROLES).optional(),
          timezone: z.string().optional(),
          ownerId: z
            .string()
            .optional()
            .openapi({ description: "For agents: the human they work for" }),
          agentProvider: z
            .string()
            .optional()
            .openapi({ example: "claude-code" }),
          issueToken: z.boolean().optional(),
        })
      ),
      responses: {
        201: json(
          z.object({
            member: MemberSchema,
            token: TokenSchema.nullable(),
            invited: z.boolean(),
          }),
          "Created"
        ),
        ...errors,
      },
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
          ? toToken(await people.createToken(ctx, member, "initial"))
          : null;
      const inviteTo = member.kind === "human" ? member.email : null;
      const invited = Boolean(inviteTo);
      if (inviteTo) {
        const ws = await people.getWorkspace(ctx, me.workspaceId);
        void sendInvite(ctx, inviteTo, me.name, ws.name);
      }
      return c.json({ member: toMember(member), token, invited }, 201);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/members/{ref}",
      operationId: "member.get",
      tags: ["People"],
      request: { params: Ref },
      responses: { 200: json(MemberSchema), ...errors },
    }),
    async (c) => {
      const m = await people.resolveMember(
        c.get("ctx"),
        c.get("member"),
        c.req.valid("param").ref
      );
      return c.json(toMember(m), 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/members/{ref}/now",
      operationId: "member.now",
      tags: ["People"],
      summary: "What this person or agent is working on right now",
      request: {
        params: Ref,
        query: z.object({
          days: z.coerce.number().int().min(1).max(90).optional(),
        }),
      },
      responses: { 200: json(SnapshotSchema), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const person = await people.resolveMember(
        ctx,
        me,
        c.req.valid("param").ref
      );
      const snapshot = await workSnapshot(ctx, person, {
        includePrivate: person.id === me.id,
        days: c.req.valid("query").days,
      });
      return c.json(toSnapshot(snapshot), 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/members/{ref}/identities",
      operationId: "identity.list",
      tags: ["People"],
      summary: "Accounts in connected tools that are this member",
      request: { params: Ref },
      responses: { 200: json(z.array(IdentitySchema)), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const m = await people.resolveMember(
        ctx,
        c.get("member"),
        c.req.valid("param").ref
      );
      const found = await listIdentities(ctx, m.workspaceId, {
        memberId: m.id,
      });
      return c.json(found.map(toIdentity), 200);
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
      request: {
        params: Ref,
        ...body(
          z
            .object({
              provider: z.string().min(1).openapi({ example: "github" }),
              externalId: z.string().min(1).optional().openapi({
                description:
                  "The tool's stable user id (Slack U…, Discord id, GitHub numeric id)",
              }),
              handle: z.string().min(1).optional().openapi({
                description: "Login / username, e.g. a GitHub login",
              }),
            })
            .refine(
              (v) => v.externalId !== undefined || v.handle !== undefined,
              "Give an externalId or a handle"
            )
        ),
      },
      responses: {
        201: json(
          IdentitySchema.extend({ reattributed: z.number().int() }),
          "Linked"
        ),
        ...errors,
      },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const m = await people.resolveMember(ctx, me, c.req.valid("param").ref);
      requireSelfOrAdmin(me, m);
      const { identity, reattributed } = await linkByHandle(
        ctx,
        m.workspaceId,
        m.id,
        c.req.valid("json")
      );
      return c.json({ ...toIdentity(identity), reattributed }, 201);
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/v1/members/{ref}/identities/{id}",
      operationId: "identity.unlink",
      tags: ["People"],
      request: { params: Ref.extend({ id: z.string() }) },
      responses: { 200: json(Ok), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const { ref, id } = c.req.valid("param");
      const m = await people.resolveMember(ctx, me, ref);
      requireSelfOrAdmin(me, m);
      const mine = await listIdentities(ctx, m.workspaceId, { memberId: m.id });
      if (!mine.some((i) => i.id === id)) {
        throw notFound("Identity");
      }
      await linkIdentityToMember(ctx, m.workspaceId, id, null);
      return c.json({ ok: true as const }, 200);
    }
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
      request: {
        params: Ref,
        ...body(
          z.object({
            name: z.string().min(1),
            scopes: z
              .array(z.enum(API_SCOPES))
              .min(1)
              .optional()
              .openapi({ description: 'Default ["read","write"]' }),
            expiresInDays: z.number().int().min(1).max(3650).optional(),
          })
        ),
      },
      responses: { 201: json(TokenSchema, "Created"), ...errors },
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
      return c.json(
        toToken(await people.createToken(ctx, m, name, { scopes, expiresAt })),
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
      request: { params: Ref },
      responses: { 200: json(z.array(TokenInfoSchema)), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const m = await people.resolveMember(ctx, me, c.req.valid("param").ref);
      requireSelfOrAdmin(me, m);
      const tokens = await people.listTokens(ctx, m.id);
      return c.json(tokens.map(toTokenInfo), 200);
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
      return c.json({ ok: true as const }, 200);
    }
  );

/** Not awaited by the route: a slow or failing mail server must not fail the invite. */
async function sendInvite(
  ctx: AppContext,
  to: string,
  inviter: string,
  workspace: string
) {
  const url = ctx.config.PUBLIC_URL;
  try {
    await ctx.mailer.send({
      to,
      subject: `${inviter} invited you to ${workspace} on Worklog`,
      text: `${inviter} added you to ${workspace} on Worklog. Sign in with this email address (or a GitHub, Discord or Slack account that uses it) at ${url} to join.`,
      html: `<p>${inviter} added you to <b>${workspace}</b> on Worklog.</p><p><a href="${url}">Sign in</a> with this email address (or a GitHub, Discord or Slack account that uses it) to join.</p>`,
    });
  } catch (error) {
    console.error("[members] invite email failed", error);
  }
}
