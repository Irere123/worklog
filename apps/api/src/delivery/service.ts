import { z } from "zod";

import type { AppContext } from "#context";
import { findConnectionById } from "#db/queries/connections";
import {
  deleteDeliveryTarget,
  insertDeliveryTarget,
  listEnabledTargets,
} from "#db/queries/delivery-targets";
import type { TargetRow } from "#db/queries/delivery-targets";
import type { TargetKind } from "#db/schema";
import { badRequest, notFound } from "#lib/errors";
import { newId } from "#lib/ids";

import { toEmailHtml } from "./sanitize";

export type Outgoing = {
  subject: string;
  markdown: string;
  type: string;
  url?: string;
};

export async function createTarget(
  ctx: AppContext,
  workspaceId: string,
  memberId: string,
  input: {
    kind: TargetKind;
    label?: string;
    address: string;
    connectionId?: string | null;
  }
) {
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
  }
  if (input.kind === "webhook" && !/^https?:\/\//u.test(input.address)) {
    throw badRequest("Webhook address must be a URL");
  }
  const row: TargetRow = {
    id: newId("tgt"),
    workspaceId,
    memberId,
    kind: input.kind,
    label: input.label ?? `${input.kind}: ${input.address}`,
    address: input.address,
    connectionId: input.connectionId ?? null,
    enabled: true,
    createdAt: ctx.now(),
  };
  await insertDeliveryTarget(ctx.db, row);
  return row;
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

// Failures are collected, not thrown, so one bad channel can't block the rest.
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

async function botToken(
  ctx: AppContext,
  connectionId: string | null
): Promise<string> {
  if (!connectionId) {
    throw new Error("No connection configured for this target");
  }
  const conn = await findConnectionById(ctx.db, { id: connectionId });
  if (!conn) {
    throw new Error("Connection no longer exists");
  }
  const token = ctx.secrets.open(conn.secrets).botToken;
  if (!token) {
    throw new Error(`The ${conn.provider} connection has no botToken`);
  }
  return token;
}

const SlackReply = z.object({ ok: z.boolean(), error: z.string().optional() });

async function sendTo(ctx: AppContext, target: TargetRow, message: Outgoing) {
  switch (target.kind) {
    case "email": {
      const html = await toEmailHtml(message.markdown);
      await ctx.mailer.send({
        to: target.address,
        subject: message.subject,
        text: message.markdown,
        html,
      });
      return;
    }
    case "slack": {
      const res = await ctx.fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await botToken(ctx, target.connectionId)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: target.address,
          text: toSlack(`*${message.subject}*\n\n${message.markdown}`),
          unfurl_links: false,
          unfurl_media: false,
        }),
      });
      const reply = SlackReply.parse(await res.json());
      if (!reply.ok) {
        throw new Error(`Slack: ${reply.error ?? "unknown error"}`);
      }
      return;
    }
    case "discord": {
      const content = truncate(
        `**${message.subject}**\n\n${message.markdown}`,
        1990,
        message.url
      );
      const isWebhook = target.address.startsWith("https://");
      const res = await ctx.fetch(
        isWebhook
          ? target.address
          : `https://discord.com/api/v10/channels/${target.address}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(isWebhook
              ? {}
              : {
                  Authorization: `Bot ${await botToken(ctx, target.connectionId)}`,
                }),
          },
          // flags 4 = SUPPRESS_EMBEDS: no link previews fetched on our behalf.
          body: JSON.stringify({
            content,
            allowed_mentions: { parse: [] },
            flags: 4,
          }),
        }
      );
      if (!res.ok) {
        throw new Error(`Discord responded ${res.status}`);
      }
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
