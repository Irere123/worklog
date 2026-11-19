import { z } from "@hono/zod-openapi";

import type { Member as MemberRow } from "#db/queries/members";
import { API_SCOPES, MEMBER_KINDS, ROLES } from "#db/schema";

import { derived, HH_MM, Timestamp } from "./common";

export const MemberRef = z.object({
  ref: z
    .string()
    .openapi({ description: 'Member id, handle, or "me"', example: "me" }),
});

export const Settings = z
  .object({
    activeHours: z
      .object({
        start: z.string().regex(HH_MM),
        end: z.string().regex(HH_MM),
      })
      .optional(),
    workdays: z.array(z.number().int().min(0).max(6)).optional(),
    notify: z
      .object({
        dailyPushCap: z.number().int().min(0).max(50).optional(),
        minGapMinutes: z
          .number()
          .int()
          .min(0)
          .max(24 * 60)
          .optional(),
        threadCooldownHours: z
          .number()
          .int()
          .min(0)
          .max(24 * 7)
          .optional(),
      })
      .optional()
      .openapi({
        description:
          "Interruption budget for proactive pings (defaults: 4/day, 90 min apart, 4 h per thread)",
      }),
    pins: z.array(z.number().int().positive()).max(50).optional().openapi({
      description:
        "Card numbers pinned to the person's pin stack, newest first; kept on the account so they follow them between devices",
    }),
  })
  .openapi("MemberSettings");

export const Member = z
  .object({
    id: z.string(),
    kind: z.enum(MEMBER_KINDS),
    role: z.enum(ROLES),
    name: z.string().min(1),
    handle: z.string(),
    email: z.string().nullable(),
    title: z.string().nullable(),
    timezone: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    ownerId: z
      .string()
      .nullable()
      .openapi({ description: "For agents: the human they work for" }),
    agentProvider: z.string().nullable().openapi({
      description:
        '"worklog" for personal assistants; e.g. "claude-code" for external agents',
    }),
    signedUp: z.boolean().openapi({
      description:
        "For humans: whether a signed-in account is attached (false = invited, not yet joined)",
    }),
    settings: Settings,
    createdAt: Timestamp,
  })
  .openapi("Member");

export const MemberResponse = derived(Member, (m: MemberRow) => ({
  ...m,
  signedUp: m.userId !== null,
}));

export const ListMembersQuery = z.object({
  kind: z.enum(MEMBER_KINDS).optional(),
});

const AvatarUrl = z
  .string()
  .max(2048)
  .refine(
    (v) => /^https:\/\/[^\s]+$/u.test(v) || /^\/[^/\\\s][^\s]*$/u.test(v),
    {
      message: "Use an https:// address or a path on this site",
    }
  )
  .openapi({ example: "https://avatars.githubusercontent.com/u/1" });

export const UpdateMeRequest = Member.pick({
  name: true,
  title: true,
  timezone: true,
  settings: true,
})
  .partial()
  .extend({
    email: z.email().nullable().optional(),
    avatarUrl: AvatarUrl.nullable().optional(),
  });

export const CreateMemberRequest = z.object({
  kind: z.enum(MEMBER_KINDS),
  name: Member.shape.name,
  handle: z.string().optional(),
  email: z.email().optional(),
  title: z.string().optional(),
  role: z.enum(ROLES).optional(),
  timezone: z.string().optional(),
  ownerId: z
    .string()
    .optional()
    .openapi({ description: "For agents: the human they work for" }),
  agentProvider: z.string().optional().openapi({ example: "claude-code" }),
  issueToken: z.boolean().optional(),
});

export const Workspace = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    timezone: z.string(),
    entropyDays: z.number().int(),
  })
  .openapi("Workspace");

export const CreateWorkspaceRequest = z.object({
  name: z.string().min(1),
  timezone: z.string().optional().openapi({ example: "America/New_York" }),
  handle: z.string().optional(),
});

export const Token = z
  .object({
    id: z.string(),
    name: z.string(),
    token: z.string().openapi({
      description: "Shown once. Send as `Authorization: Bearer <token>`.",
    }),
    prefix: z.string(),
    scopes: z.array(z.enum(API_SCOPES)),
    expiresAt: Timestamp.nullable(),
  })
  .openapi("ApiKey");

export const TokenInfo = z
  .object({
    id: z.string(),
    name: z.string(),
    prefix: z.string(),
    scopes: z.array(z.enum(API_SCOPES)),
    expiresAt: Timestamp.nullable(),
    lastUsedAt: Timestamp.nullable(),
    createdAt: Timestamp,
  })
  .openapi("ApiKeyInfo");

export const CreateTokenRequest = z.object({
  name: z.string().min(1),
  scopes: z
    .array(z.enum(API_SCOPES))
    .min(1)
    .optional()
    .openapi({ description: 'Default ["read","write"]' }),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});

export const MemberCreatedResponse = z.object({
  member: MemberResponse,
  token: Token.nullable(),
  invited: z.boolean(),
});

export const MeResponse = z.object({
  member: MemberResponse,
  workspace: Workspace,
  assistant: MemberResponse.nullable(),
  ai: z.boolean().openapi({
    description:
      "Whether this server has a model. Without one, AI features fall back: dictation uses the browser's own recognition, briefs use templates.",
  }),
  uploads: z.boolean().openapi({
    description:
      "Whether this server stores files. Without it, `PUT /v1/me/avatar` answers 503 and a picture can only be a link.",
  }),
});

export const SetupRequest = z.object({
  workspaceName: z.string().min(1),
  name: z.string().min(1),
  email: z.email().optional(),
  handle: z.string().optional(),
  timezone: z.string().optional().openapi({ example: "America/New_York" }),
});

export const SetupResponse = z.object({
  workspace: Workspace,
  member: MemberResponse,
  assistant: MemberResponse,
  token: Token,
});

export const AuthConfigResponse = z.object({
  magicLink: z.boolean(),
  socialProviders: z.array(z.enum(["github", "discord", "slack"])),
  authBasePath: z.string(),
  setupOpen: z.boolean().openapi({
    description: "No workspace exists yet, so `POST /v1/setup` is open",
  }),
  signupOpen: z.boolean().openapi({
    description:
      "Anyone who signs in may start a workspace with `POST /v1/workspaces`; otherwise people join by invite",
  }),
  mcpUrl: z.string().nullable().openapi({
    description:
      "Where coding agents connect over MCP; they sign in through Worklog on their own. Null when the server isn't on HTTPS",
    example: "https://worklog.example.com/mcp",
  }),
});

const Membership = z.object({ workspace: Workspace, member: MemberResponse });

export const SessionResponse = z.object({
  user: z
    .object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      image: z.string().nullable().optional(),
    })
    .nullable(),
  memberships: z.array(Membership),
  via: z.enum(["session", "api_key"]),
});

export const WorkspaceCreatedResponse = Membership.extend({
  assistant: MemberResponse,
});

export const Identity = z
  .object({
    id: z.string(),
    memberId: z.string().nullable().openapi({
      description: "null = seen in events but not matched to anyone yet",
    }),
    provider: z.string().openapi({
      description:
        'Identity namespace, e.g. "github", "slack", "gitea:git.example.com", "gitlab:gitlab.com"',
    }),
    externalId: z.string(),
    externalHandle: z.string().nullable(),
    displayName: z.string().nullable(),
    isBot: z.boolean(),
    avatarUrl: z.string().nullable(),
    eventCount: z.number().int(),
    lastSeenAt: Timestamp.nullable(),
  })
  .openapi("Identity");

export const ListIdentitiesQuery = z.object({
  unlinked: z.enum(["true", "false"]).optional(),
});

export const LinkIdentityRequest = z
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
  );

export const IdentityLinkedResponse = Identity.extend({
  reattributed: z.number().int(),
});

export const AssignIdentityRequest = z.object({
  member: z
    .string()
    .nullable()
    .openapi({ description: "Member id or handle; null to unlink" }),
});

export const IdentityAssignedResponse = z.object({
  identity: Identity,
  reattributed: z.number().int(),
});
