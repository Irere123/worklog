import { createHash } from "node:crypto";

import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, jwt, magicLink } from "better-auth/plugins";

import type { Config } from "#config";
import { signInEmail } from "#emails";
import { log } from "#telemetry/log";

import { generateId } from "./ids";
import type { Mailer } from "./mailer";

export type SocialProvider = "github" | "discord" | "slack";

export function enabledSocialProviders(config: Config) {
  const out: SocialProvider[] = [];
  if (config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET) {
    out.push("github");
  }
  if (config.DISCORD_CLIENT_ID && config.DISCORD_CLIENT_SECRET) {
    out.push("discord");
  }
  if (config.SLACK_CLIENT_ID && config.SLACK_CLIENT_SECRET) {
    out.push("slack");
  }
  return out;
}

/** Signs sessions, and anything else that should stop working when it changes. */
export function authSecret(config: Config) {
  return (
    config.AUTH_SECRET ??
    createHash("sha256")
      .update("worklog-insecure-dev-auth-secret")
      .digest("hex")
  );
}

/** Where people use the web app: this server when it serves the build, else the first web origin. */
export function webAppUrl(config: Config) {
  const [, first] = webOrigins(config);
  return config.WEB_DIST || first === undefined ? config.PUBLIC_URL : first;
}

/** The MCP endpoint, which is also the audience every agent's access token is bound to. */
export function mcpResource(config: Config) {
  return new URL("/mcp", config.PUBLIC_URL).toString();
}

/**
 * Agents send their tokens to this address, so OAuth requires it to be HTTPS. Plain HTTP is
 * allowed only on this machine, for development. A server on a bare LAN address runs without MCP
 * rather than failing to start.
 */
export function mcpAvailable(config: Config) {
  const url = new URL(config.PUBLIC_URL);
  const host = url.hostname.replaceAll(/^\[|\]$/gu, "");
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" &&
      (host === "localhost" ||
        host.endsWith(".localhost") ||
        host === "::1" ||
        /^127\.\d+\.\d+\.\d+$/u.test(host)))
  );
}

/**
 * What a coding agent may be granted. They mirror an API key's scopes: `ingest` reports its own
 * progress, `read` sees the board, `write` changes cards. `offline_access` lets it refresh its
 * token instead of sending its person back to the browser every hour.
 */
export const AGENT_SCOPES = ["ingest", "read", "write"] as const;
export const AGENT_TOKEN_SCOPES = [...AGENT_SCOPES, "offline_access"];

/** The access-token claim naming the workspace an agent was approved into. */
export const WORKSPACE_CLAIM = "worklog_workspace";

export function webOrigins(config: Config) {
  return [
    config.PUBLIC_URL,
    ...(config.WEB_ORIGINS?.split(",")
      .map((o) => o.trim())
      .filter(Boolean) ?? []),
  ];
}

export function createAuth(
  db: Parameters<typeof drizzleAdapter>[0],
  config: Config,
  mailer: Mailer,
  hooks: {
    onSignIn?: (userId: string) => Promise<void>;
    /**
     * The workspace an agent's approval is for: the one the person picked on the approval page if
     * they belong to it, else their only one. Undefined sends them to the page to pick.
     */
    agentWorkspace?: (
      userId: string,
      picked: string | undefined
    ) => Promise<string | undefined>;
  } = {}
) {
  const github = oauthApp(config.GITHUB_CLIENT_ID, config.GITHUB_CLIENT_SECRET);
  const discord = oauthApp(
    config.DISCORD_CLIENT_ID,
    config.DISCORD_CLIENT_SECRET
  );
  const slack = oauthApp(config.SLACK_CLIENT_ID, config.SLACK_CLIENT_SECRET);
  return betterAuth({
    appName: "Worklog",
    baseURL: config.PUBLIC_URL,
    basePath: "/api/auth",
    secret: authSecret(config),
    trustedOrigins: webOrigins(config),
    database: drizzleAdapter(db, {
      provider: "pg",
      transaction: true,
    }),
    advanced: {
      database: { generateId },
    },
    socialProviders: {
      ...(github ? { github } : {}),
      ...(discord ? { discord } : {}),
      ...(slack ? { slack } : {}),
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["github", "discord", "slack"],
      },
    },
    session: {
      cookieCache: { enabled: true, maxAge: 60 },
      additionalFields: {
        agentWorkspaceId: { type: "string", required: false },
      },
    },
    disabledPaths: ["/token"],
    databaseHooks: {
      session: {
        create: {
          after: async (session) => await hooks.onSignIn?.(session.userId),
        },
      },
    },
    plugins: [
      magicLink({
        sendMagicLink: ({ email, url }) => {
          void sendSignInLink(mailer, { email, url, home: config.PUBLIC_URL });
        },
      }),
      bearer(),
      ...(mcpAvailable(config) ? agentAuthorization(config, hooks) : []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

function agentAuthorization(
  config: Config,
  hooks: Parameters<typeof createAuth>[3]
) {
  return [
    jwt({ disableSettingJwtHeader: true }),
    mcp({
      loginPage: new URL("/connect/sign-in", webAppUrl(config)).toString(),
      consentPage: new URL("/connect", webAppUrl(config)).toString(),
      resource: mcpResource(config),
      scopes: ["openid", "profile", ...AGENT_TOKEN_SCOPES],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultApplicationType: "infer",
      clientRegistrationDefaultScopes: [
        "openid",
        "profile",
        ...AGENT_TOKEN_SCOPES,
      ],
      refreshTokenExpiresIn: 90 * 24 * 60 * 60,
      postLogin: {
        page: new URL("/connect", webAppUrl(config)).toString(),
        shouldRedirect: () => false,
        consentReferenceId: async ({ user, session }) =>
          await hooks?.agentWorkspace?.(
            user.id,
            typeof session.agentWorkspaceId === "string"
              ? session.agentWorkspaceId
              : undefined
          ),
      },
      customAccessTokenClaims: ({ referenceId }) =>
        referenceId ? { [WORKSPACE_CLAIM]: referenceId } : {},
    }),
    cimd({
      fetchClientMetadataResource,
      metadataProfile: "mcp-2026-07-28",
    }),
  ];
}

function oauthApp(
  clientId: string | undefined,
  clientSecret: string | undefined
) {
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

async function sendSignInLink(
  mailer: Mailer,
  link: { email: string; url: string; home: string }
) {
  try {
    await mailer.send({ to: link.email, ...(await signInEmail(link)) });
  } catch (error) {
    log.error("auth: magic link email failed", { error });
  }
}
