import { createHash } from "node:crypto";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, magicLink } from "better-auth/plugins";

import type { Config } from "#config";
import { signInEmail } from "#emails";
import { log } from "#telemetry/log";

import { generateId } from "./ids";
import type { Mailer } from "./mailer";

export type SocialProvider = "github" | "discord" | "slack";

export function enabledSocialProviders(config: Config): SocialProvider[] {
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

export function webOrigins(config: Config): string[] {
  return [
    config.PUBLIC_URL,
    ...(config.WEB_ORIGINS?.split(",")
      .map((o) => o.trim())
      .filter(Boolean) ?? []),
  ];
}

// Agents can't be Better Auth users, and keeping tenancy in our members table avoids coupling
// workspaces to the organization plugin's lifecycle.
export function createAuth(
  db: Parameters<typeof drizzleAdapter>[0],
  config: Config,
  mailer: Mailer,
  hooks: { onSignIn?: (userId: string) => Promise<void> } = {}
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
    secret:
      config.AUTH_SECRET ??
      createHash("sha256")
        .update("worklog-insecure-dev-auth-secret")
        .digest("hex"),
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
    // Signing in with GitHub after an email link (same verified address) lands on the same person.
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["github", "discord", "slack"],
      },
    },
    session: { cookieCache: { enabled: true, maxAge: 60 } },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => await hooks.onSignIn?.(session.userId),
        },
      },
    },
    plugins: [
      magicLink({
        // Not awaited: response timing must not reveal whether the address exists.
        sendMagicLink: ({ email, url }) => {
          void sendSignInLink(mailer, { email, url, home: config.PUBLIC_URL });
        },
      }),
      bearer(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

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
