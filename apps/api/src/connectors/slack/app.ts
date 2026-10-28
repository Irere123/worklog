import { z } from "zod";

import type { AppSpec } from "#connectors/types";
import { badRequest } from "#lib/errors";

import { slackApi, slackOAuth } from "./api";

/**
 * Bot scopes: reading the channels it's in (history for backfill), posting answers, the
 * commands, and the user directory, whose emails link people to their members.
 */
export const BOT_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "groups:history",
  "channels:read",
  "groups:read",
  "chat:write",
  "commands",
  "users:read",
  "users:read.email",
  "team:read",
];

const Installation = z.object({
  is_enterprise_install: z.union([z.boolean(), z.string()]).optional(),
  enterprise_id: z.string().nullish(),
  team_id: z.string().nullish(),
});

/** An org-wide install is one connection for the whole Enterprise Grid org. */
export function installationOf(raw: unknown): string | null {
  const parsed = Installation.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const i = parsed.data;
  const enterprise =
    i.is_enterprise_install === true || i.is_enterprise_install === "true";
  return (enterprise ? i.enterprise_id : i.team_id) ?? null;
}

const Access = z.object({
  access_token: z.string(),
  bot_user_id: z.string().optional(),
  team: z.object({ id: z.string(), name: z.string() }).nullish(),
  enterprise: z.object({ id: z.string(), name: z.string() }).nullish(),
  is_enterprise_install: z.boolean().optional(),
});

const Auth = z.object({ url: z.string().optional() });

// Interactions carry the installation they came from, worked out in `receive`.
const Routed = z.object({ install: z.string().nullish() });

const Lifecycle = z.object({
  event: z.object({
    type: z.string(),
    tokens: z.object({ bot: z.array(z.string()).optional() }).optional(),
  }),
});

export const slackApp: AppSpec = {
  credentials: [
    {
      key: "clientId",
      required: true,
      description: "Basic Information → Client ID",
    },
    {
      key: "clientSecret",
      required: true,
      description: "Basic Information → Client Secret",
    },
    {
      key: "signingSecret",
      required: true,
      description: "Basic Information → Signing Secret",
    },
  ],
  endpoints: { events: "events", commands: "commands" },
  fromEnv: (config) =>
    config.SLACK_CLIENT_ID &&
    config.SLACK_CLIENT_SECRET &&
    config.SLACK_SIGNING_SECRET
      ? {
          appId: config.SLACK_APP_ID ?? null,
          slug: null,
          name: "Slack",
          credentials: {
            clientId: config.SLACK_CLIENT_ID,
            clientSecret: config.SLACK_CLIENT_SECRET,
            signingSecret: config.SLACK_SIGNING_SECRET,
          },
        }
      : null,
  route(received) {
    if (received.type === "event") {
      return installationOf(received.payload);
    }
    const routed = Routed.safeParse(received.payload);
    return routed.success ? (routed.data.install ?? null) : null;
  },
  // `app_uninstalled` and `tokens_revoked` arrive in no set order; either one ends it.
  lifecycle(eventType, payload) {
    if (eventType !== "app_uninstalled" && eventType !== "tokens_revoked") {
      return null;
    }
    const parsed = Lifecycle.safeParse(payload);
    if (
      eventType === "tokens_revoked" &&
      (!parsed.success || (parsed.data.event.tokens?.bot ?? []).length === 0)
    ) {
      return null;
    }
    return {
      type: "status",
      status: "revoked",
      reason: "Worklog was removed from the Slack workspace",
    };
  },
  installUrl: (app, state, callbackUrl) =>
    `https://slack.com/oauth/v2/authorize?${new URLSearchParams({
      client_id: app.credentials.clientId ?? "",
      scope: BOT_SCOPES.join(","),
      redirect_uri: callbackUrl,
      state,
    }).toString()}`,
  // The code is exchanged with the app's secret, so the team it returns is the one the admin
  // approved on Slack's own page.
  async completeInstall(ctx, app, query, callbackUrl) {
    if (!query.code) {
      throw badRequest(
        query.error
          ? `Slack didn't install the app: ${query.error}`
          : "Slack sent no code"
      );
    }
    const access = Access.parse(
      await slackOAuth(ctx, "oauth.v2.access", {
        client_id: app.credentials.clientId ?? "",
        client_secret: app.credentials.clientSecret ?? "",
        code: query.code,
        redirect_uri: callbackUrl,
      })
    );
    const org =
      access.is_enterprise_install === true ? access.enterprise : access.team;
    if (!org) {
      throw badRequest("Slack didn't say which workspace installed the app");
    }
    const auth = Auth.parse(
      await slackApi(ctx, access.access_token, "auth.test")
    );
    return {
      externalId: org.id,
      name: `Slack · ${org.name}`,
      secrets: { botToken: access.access_token },
      settings: {
        ...(auth.url ? { teamUrl: auth.url.replace(/\/$/u, "") } : {}),
        ...(access.bot_user_id ? { botUserId: access.bot_user_id } : {}),
      },
    };
  },
};
