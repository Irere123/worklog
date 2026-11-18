import { z } from "zod";

import { call, callJson, ProviderError } from "#connectors/http";
import type { AppSpec, AppView, Source } from "#connectors/types";
import type { AppContext } from "#context";
import { badRequest } from "#lib/errors";

export const API = "https://discord.com/api/v10";

/**
 * A call with the app's one bot token. Refused, it says the app's token is wrong, not that one
 * server's connection went away, so it's a failure to fix, never a revocation.
 */
export async function asApp<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ProviderError && error.kind === "revoked") {
      throw new ProviderError(
        `Discord refused the app's bot token: ${error.message}`,
        "failed",
        null,
        error.status
      );
    }
    throw error;
  }
}

const PERMISSIONS = String(1024 + 2048);

const Token = z.object({
  guild: z.object({ id: z.string(), name: z.string() }).optional(),
});

const Routed = z.object({ guild_id: z.string().optional() });

const Guilds = z.array(z.object({ id: z.string() }));

/** Puts Worklog's slash commands on the application, for every server it's in. */
export async function putCommands(
  ctx: AppContext,
  applicationId: string,
  botToken: string,
  commands: unknown[]
) {
  await asApp(
    async () =>
      await call(
        ctx,
        "Discord commands",
        `${API}/applications/${applicationId}/commands`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bot ${botToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(commands),
        }
      )
  );
}

/** A read with the app's bot token. */
export async function botGet(
  ctx: AppContext,
  what: string,
  url: string,
  botToken: string
) {
  return await asApp(
    async () =>
      await callJson(ctx, what, url, {
        headers: { Authorization: `Bot ${botToken}` },
      })
  );
}

const PermissionOverwrite = z.object({
  id: z.string(),
  type: z.number(),
  allow: z.string(),
  deny: z.string(),
});
type Overwrite = z.infer<typeof PermissionOverwrite>;

const Channels = z.array(
  z.object({
    id: z.string(),
    name: z.string().optional(),
    type: z.number(),
    permission_overwrites: z.array(PermissionOverwrite).optional(),
  })
);

const VIEW_CHANNEL = 1024;
const grants = (bits: string) =>
  Math.floor(Number(bits) / VIEW_CHANNEL) % 2 === 1;

const hiddenFromEveryone = (overwrites: Overwrite[], guildId: string) =>
  overwrites.some((o) => o.type === 0 && o.id === guildId && grants(o.deny));
const rolesLetIn = (overwrites: Overwrite[]) =>
  new Set(
    overwrites.filter((o) => o.type === 0 && grants(o.allow)).map((o) => o.id)
  );

function membersRole(
  hidden: Overwrite[][],
  readable: number
): string | undefined {
  if (hidden.length < 2 || hidden.length <= readable / 2) {
    return undefined;
  }
  const counts = new Map<string, number>();
  for (const overwrites of hidden) {
    for (const role of rolesLetIn(overwrites)) {
      counts.set(role, (counts.get(role) ?? 0) + 1);
    }
  }
  const [role, n] = [...counts].toSorted((a, b) => b[1] - a[1])[0] ?? [];
  return n !== undefined && n > hidden.length / 2 ? role : undefined;
}

const READABLE = new Set([0, 5]);

/** The server's channels the bot can post in and read, for choosing which count as work. */
export async function guildChannels(
  ctx: AppContext,
  guildId: string | null,
  botToken: string | undefined
): Promise<Source[]> {
  if (!guildId || !botToken) {
    throw new ProviderError(
      "Choosing channels needs the server's Discord app",
      "failed"
    );
  }
  const channels = Channels.parse(
    await botGet(
      ctx,
      "Discord channels",
      `${API}/guilds/${guildId}/channels`,
      botToken
    )
  );
  const readable = channels
    .filter((c) => READABLE.has(c.type))
    .map((c) => ({ ...c, overwrites: c.permission_overwrites ?? [] }));
  const hidden = readable.filter((c) =>
    hiddenFromEveryone(c.overwrites, guildId)
  );
  const members = membersRole(
    hidden.map((c) => c.overwrites),
    readable.length
  );
  return readable
    .map((c) => ({
      id: c.id,
      name: c.name ?? c.id,
      private:
        hiddenFromEveryone(c.overwrites, guildId) &&
        !(members !== undefined && rolesLetIn(c.overwrites).has(members)),
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

export function discordApp(commands: unknown[]): AppSpec {
  return {
    credentials: [
      {
        key: "clientId",
        required: true,
        description: "OAuth2 → Client ID (the application id)",
      },
      {
        key: "clientSecret",
        required: true,
        description: "OAuth2 → Client Secret",
      },
      {
        key: "publicKey",
        required: true,
        description: "General Information → Public Key",
      },
      { key: "botToken", required: true, description: "Bot → Token" },
    ],
    endpoints: { interactions: "interactions" },
    fromEnv: (config) =>
      config.DISCORD_CLIENT_ID &&
      config.DISCORD_CLIENT_SECRET &&
      config.DISCORD_PUBLIC_KEY &&
      config.DISCORD_BOT_TOKEN
        ? {
            appId: config.DISCORD_CLIENT_ID,
            slug: null,
            name: "Discord",
            credentials: {
              clientId: config.DISCORD_CLIENT_ID,
              clientSecret: config.DISCORD_CLIENT_SECRET,
              publicKey: config.DISCORD_PUBLIC_KEY,
              botToken: config.DISCORD_BOT_TOKEN,
            },
          }
        : null,
    route(received) {
      const parsed = Routed.safeParse(received.payload);
      return parsed.success ? (parsed.data.guild_id ?? null) : null;
    },
    async installations(ctx, app) {
      const ids = new Set<string>();
      let after = "0";
      for (let page = 0; page < 100; page += 1) {
        const guilds = Guilds.parse(
          await botGet(
            ctx,
            "Discord guilds",
            `${API}/users/@me/guilds?limit=200&after=${after}`,
            app.credentials.botToken ?? ""
          )
        );
        for (const g of guilds) {
          ids.add(g.id);
        }
        const last = guilds.at(-1);
        if (guilds.length < 200 || !last) {
          return ids;
        }
        after = last.id;
      }
      throw new ProviderError(
        "Discord listed more servers than Worklog reads",
        "failed"
      );
    },
    installUrl: (app: AppView, state, callbackUrl) =>
      `https://discord.com/oauth2/authorize?${new URLSearchParams({
        client_id: app.credentials.clientId ?? "",
        scope: "bot applications.commands",
        permissions: PERMISSIONS,
        response_type: "code",
        redirect_uri: callbackUrl,
        state,
      }).toString()}`,
    async completeInstall(ctx, app, query, callbackUrl) {
      if (!query.code) {
        throw badRequest(
          query.error
            ? `Discord didn't add the bot: ${query.error}`
            : "Discord sent no code"
        );
      }
      const token = Token.parse(
        await callJson(ctx, "Discord OAuth", `${API}/oauth2/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: query.code,
            redirect_uri: callbackUrl,
            client_id: app.credentials.clientId ?? "",
            client_secret: app.credentials.clientSecret ?? "",
          }).toString(),
        })
      );
      if (!token.guild) {
        throw badRequest(
          "Discord didn't say which server the bot was added to"
        );
      }
      await putCommands(
        ctx,
        app.credentials.clientId ?? "",
        app.credentials.botToken ?? "",
        commands
      );
      return {
        externalId: token.guild.id,
        name: `Discord · ${token.guild.name}`,
        secrets: {},
        settings: {},
      };
    },
  };
}
