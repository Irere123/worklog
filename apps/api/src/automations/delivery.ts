import { z } from "zod";

import { API as DISCORD_API, botGet } from "#connectors/discord/app";
import { call, ProviderError } from "#connectors/http";
import { slackApi } from "#connectors/slack/api";
import type { AppContext } from "#context";
import { findConnectionById } from "#db/queries/connections";
import { findConnectorApp } from "#db/queries/connector-apps";
import {
  deleteDeliveryTarget,
  insertDeliveryTarget,
  listEnabledTargets,
  updateDeliveryTargetById,
} from "#db/queries/delivery-targets";
import type { TargetRow } from "#db/queries/delivery-targets";
import { listIdentities } from "#db/queries/identities";
import type { Member } from "#db/queries/members";
import type { TargetKind, Visibility } from "#db/schema";
import { briefEmail } from "#emails";
import { handleProviderError } from "#ingest/lifecycle";
import { badRequest, notFound } from "#lib/errors";
import { generateId } from "#lib/ids";

export type Outgoing = {
  subject: string;
  markdown: string;
  type: string;
  url?: string;
};

export async function createTarget(
  ctx: AppContext,
  member: Member,
  input: {
    kind: TargetKind;
    label?: string;
    address: string;
    connectionId?: string | null;
    visibility?: Visibility;
  }
) {
  const { workspaceId } = member;
  if (
    (input.kind === "slack" ||
      (input.kind === "discord" && !input.address.startsWith("https://"))) &&
    !input.connectionId
  ) {
    throw badRequest(
      `${input.kind} targets need a connectionId (the bot that will post)`
    );
  }
  if (input.connectionId) {
    const conn = await findConnectionById(ctx.db, {
      id: input.connectionId,
      workspaceId,
    });
    if (!conn || conn.provider !== input.kind) {
      throw badRequest(`connectionId must be a ${input.kind} connection`);
    }
    if (
      input.kind === "discord" &&
      conn.externalId &&
      !input.address.startsWith("https://")
    ) {
      await requireOwnChannel(
        ctx,
        conn.provider,
        conn.externalId,
        input.address
      );
    }
  }
  if (input.kind === "webhook" && !/^https?:\/\//u.test(input.address)) {
    throw badRequest("Webhook address must be a URL");
  }
  const row: TargetRow = {
    id: generateId(),
    workspaceId,
    memberId: member.id,
    kind: input.kind,
    label: input.label ?? `${input.kind}: ${input.address}`,
    address: input.address,
    connectionId: input.connectionId ?? null,
    visibility: input.visibility ?? (await readBy(ctx, member, input)),
    enabled: true,
    createdAt: ctx.now(),
  };
  await insertDeliveryTarget(ctx.db, row);
  return row;
}

const Channel = z.object({ guild_id: z.string().optional() });

async function requireOwnChannel(
  ctx: AppContext,
  provider: string,
  guildId: string,
  channelId: string
) {
  const app = await findConnectorApp(ctx.db, { provider });
  const token = app ? ctx.secrets.open(app.credentials).botToken : undefined;
  if (!token) {
    throw badRequest("The Discord app has no bot token");
  }
  let found: unknown;
  try {
    found = await botGet(
      ctx,
      "Discord channel",
      `${DISCORD_API}/channels/${encodeURIComponent(channelId)}`,
      token
    );
  } catch (error) {
    if (
      error instanceof ProviderError &&
      (error.status === 403 || error.status === 404)
    ) {
      throw badRequest(
        "That channel isn't in this connection's Discord server"
      );
    }
    throw badRequest(
      `Couldn't check the channel with Discord: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const channel = Channel.safeParse(found);
  if (!channel.success || channel.data.guild_id !== guildId) {
    throw badRequest("That channel isn't in this connection's Discord server");
  }
}

export async function updateTarget(
  ctx: AppContext,
  memberId: string,
  id: string,
  set: { label?: string; visibility?: Visibility }
) {
  const row = await updateDeliveryTargetById(ctx.db, { id, memberId, set });
  if (!row) {
    throw notFound("Delivery target");
  }
  return row;
}

/**
 * Of `ids`, the member's enabled targets by who reads them. Private data only goes to the private
 * ones; team ones get a version built from team-visible data, so a brief posted to a channel can't
 * carry a private note into it.
 */
export async function splitTargets(
  ctx: AppContext,
  memberId: string,
  ids: string[]
) {
  const targets = ids.length
    ? await listEnabledTargets(ctx.db, { memberId, ids })
    : [];
  const of = (visibility: Visibility) =>
    targets.filter((t) => t.visibility === visibility).map((t) => t.id);
  return { private: of("private"), team: of("team") };
}

export async function deleteTarget(
  ctx: AppContext,
  memberId: string,
  id: string
) {
  const deleted = await deleteDeliveryTarget(ctx.db, { id, memberId });
  if (!deleted.length) {
    throw notFound("Delivery target");
  }
}

export async function deliver(
  ctx: AppContext,
  memberId: string,
  targetIds: string[],
  message: Outgoing
) {
  if (!targetIds.length) {
    return {
      delivered: [] as string[],
      failed: [] as { id: string; error: string }[],
    };
  }
  const targets = await listEnabledTargets(ctx.db, {
    memberId,
    ids: targetIds,
  });
  const delivered: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const target of targets) {
    try {
      await sendTo(ctx, target, message);
      delivered.push(target.id);
    } catch (error) {
      failed.push({
        id: target.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { delivered, failed };
}

async function readBy(
  ctx: AppContext,
  member: Member,
  input: { kind: TargetKind; address: string }
): Promise<Visibility> {
  if (input.kind === "email") {
    return member.email?.toLowerCase() === input.address.toLowerCase()
      ? "private"
      : "team";
  }
  if (input.kind === "slack") {
    const own = await listIdentities(ctx.db, {
      workspaceId: member.workspaceId,
      memberId: member.id,
    });
    return own.some(
      (i) => i.provider === "slack" && i.externalId === input.address
    )
      ? "private"
      : "team";
  }
  return "team";
}

async function botToken(
  ctx: AppContext,
  connectionId: string | null
): Promise<{ connectionId: string; token: string; own: boolean }> {
  if (!connectionId) {
    throw new Error("No connection configured for this target");
  }
  const conn = await findConnectionById(ctx.db, { id: connectionId });
  if (!conn) {
    throw new Error("Connection no longer exists");
  }
  if (conn.status === "revoked" || conn.status === "suspended") {
    throw new Error(`The ${conn.provider} connection is ${conn.status}`);
  }
  const app = conn.externalId
    ? await findConnectorApp(ctx.db, { provider: conn.provider })
    : undefined;
  const own = ctx.secrets.open(conn.secrets).botToken;
  const token =
    own ?? (app ? ctx.secrets.open(app.credentials).botToken : undefined);
  if (!token) {
    throw new Error(`The ${conn.provider} connection has no botToken`);
  }
  return { connectionId, token, own: own !== undefined };
}

async function asBot(
  ctx: AppContext,
  bot: { connectionId: string; own: boolean },
  send: () => Promise<unknown>
) {
  try {
    await send();
  } catch (error) {
    if (bot.own) {
      await handleProviderError(ctx, bot.connectionId, error);
    }
    throw error;
  }
}

async function sendTo(ctx: AppContext, target: TargetRow, message: Outgoing) {
  switch (target.kind) {
    case "email": {
      await ctx.mailer.send({
        to: target.address,
        ...(await briefEmail({
          subject: message.subject,
          markdown: message.markdown,
          home: ctx.config.PUBLIC_URL,
        })),
      });
      return;
    }
    case "slack": {
      const bot = await botToken(ctx, target.connectionId);
      await asBot(
        ctx,
        bot,
        async () =>
          await slackApi(
            ctx,
            bot.token,
            "chat.postMessage",
            {},
            {
              json: {
                channel: target.address,
                text: toSlack(`*${message.subject}*\n\n${message.markdown}`),
                unfurl_links: false,
                unfurl_media: false,
              },
            }
          )
      );
      return;
    }
    case "discord": {
      const content = truncate(
        `**${message.subject}**\n\n${message.markdown}`,
        1990,
        message.url
      );
      const body = JSON.stringify({
        content,
        allowed_mentions: { parse: [] },
        flags: 4,
      });
      if (target.address.startsWith("https://")) {
        const res = await ctx.fetch(target.address, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        if (!res.ok) {
          throw new Error(`Discord responded ${res.status}`);
        }
        return;
      }
      const bot = await botToken(ctx, target.connectionId);
      await asBot(
        ctx,
        bot,
        async () =>
          await call(
            ctx,
            "Discord",
            `${DISCORD_API}/channels/${target.address}/messages`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bot ${bot.token}`,
              },
              body,
            }
          )
      );
      return;
    }
    case "webhook": {
      const res = await ctx.fetch(target.address, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: message.type,
          subject: message.subject,
          markdown: message.markdown,
          url: message.url,
        }),
      });
      if (!res.ok) {
        throw new Error(`Webhook responded ${res.status}`);
      }
      return;
    }
    default: {
      throw new Error(
        `Unknown target kind: ${String(target.kind satisfies never)}`
      );
    }
  }
}

export function toSlack(md: string): string {
  return md
    .replaceAll(/^#{1,6}\s+(?<text>.*)$/gmu, "*$<text>*")
    .replaceAll(/\*\*(?<text>.+?)\*\*/gu, "*$<text>*")
    .replaceAll(
      /\[(?<text>[^\]]+)\]\((?<url>https?:[^)]+)\)/gu,
      "<$<url>|$<text>>"
    )
    .replaceAll(/^(?<indent>\s*)[-*]\s+/gmu, "$<indent>• ");
}

function truncate(text: string, max: number, url?: string) {
  if (text.length <= max) {
    return text;
  }
  const tail = url ? `\n… ${url}` : "\n…";
  return text.slice(0, max - tail.length) + tail;
}
