import { and, eq, inArray } from "drizzle-orm";
import type { AppContext } from "../context";
import { connections, deliveryTargets, type TargetKind } from "../db/schema";
import { badRequest, notFound } from "../lib/errors";
import { newId } from "../lib/ids";
import { toEmailHtml } from "./sanitize";

export type TargetRow = typeof deliveryTargets.$inferSelect;
export type Outgoing = { subject: string; markdown: string; type: string; url?: string };

export async function listTargets(ctx: AppContext, memberId: string) {
  return ctx.db.select().from(deliveryTargets).where(eq(deliveryTargets.memberId, memberId));
}

export async function createTarget(
  ctx: AppContext,
  workspaceId: string,
  memberId: string,
  input: { kind: TargetKind; label?: string; address: string; connectionId?: string | null },
) {
  if ((input.kind === "slack" || (input.kind === "discord" && !input.address.startsWith("https://"))) && !input.connectionId) {
    throw badRequest(`${input.kind} targets need a connectionId (the bot that will post)`);
  }
  if (input.connectionId) {
    const [conn] = await ctx.db
      .select()
      .from(connections)
      .where(and(eq(connections.id, input.connectionId), eq(connections.workspaceId, workspaceId)));
    if (!conn || conn.provider !== input.kind) throw badRequest(`connectionId must be a ${input.kind} connection`);
  }
  if (input.kind === "webhook" && !/^https?:\/\//.test(input.address)) throw badRequest("Webhook address must be a URL");
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
  await ctx.db.insert(deliveryTargets).values(row);
  return row;
}

export async function deleteTarget(ctx: AppContext, memberId: string, id: string) {
  const deleted = await ctx.db
    .delete(deliveryTargets)
    .where(and(eq(deliveryTargets.id, id), eq(deliveryTargets.memberId, memberId)))
    .returning();
  if (!deleted.length) throw notFound("Delivery target");
}

/** Sends to every listed (enabled) target. Failures are collected, not thrown, so one bad channel can't block the rest. */
export async function deliver(ctx: AppContext, memberId: string, targetIds: string[], message: Outgoing) {
  if (!targetIds.length) return { delivered: [] as string[], failed: [] as { id: string; error: string }[] };
  const targets = await ctx.db
    .select()
    .from(deliveryTargets)
    .where(and(eq(deliveryTargets.memberId, memberId), inArray(deliveryTargets.id, targetIds), eq(deliveryTargets.enabled, true)));
  const delivered: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const target of targets) {
    try {
      await sendTo(ctx, target, message);
      delivered.push(target.id);
    } catch (err) {
      failed.push({ id: target.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { delivered, failed };
}

async function botToken(ctx: AppContext, connectionId: string | null): Promise<string> {
  if (!connectionId) throw new Error("No connection configured for this target");
  const [conn] = await ctx.db.select().from(connections).where(eq(connections.id, connectionId));
  if (!conn) throw new Error("Connection no longer exists");
  const token = ctx.secrets.open(conn.secrets).botToken;
  if (!token) throw new Error(`The ${conn.provider} connection has no botToken`);
  return token;
}

async function sendTo(ctx: AppContext, target: TargetRow, message: Outgoing) {
  switch (target.kind) {
    case "email": {
      const html = await toEmailHtml(message.markdown);
      await ctx.mailer.send({ to: target.address, subject: message.subject, text: message.markdown, html });
      return;
    }
    case "slack": {
      const res = await ctx.fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${await botToken(ctx, target.connectionId)}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: target.address,
          text: toSlack(`*${message.subject}*\n\n${message.markdown}`),
          unfurl_links: false,
          unfurl_media: false,
        }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!body.ok) throw new Error(`Slack: ${body.error}`);
      return;
    }
    case "discord": {
      const content = truncate(`**${message.subject}**\n\n${message.markdown}`, 1990, message.url);
      const isWebhook = target.address.startsWith("https://");
      const res = await ctx.fetch(
        isWebhook ? target.address : `https://discord.com/api/v10/channels/${target.address}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(isWebhook ? {} : { Authorization: `Bot ${await botToken(ctx, target.connectionId)}` }),
          },
          // flags 4 = SUPPRESS_EMBEDS: no link previews fetched on our behalf.
          body: JSON.stringify({ content, allowed_mentions: { parse: [] }, flags: 4 }),
        },
      );
      if (!res.ok) throw new Error(`Discord responded ${res.status}`);
      return;
    }
    case "webhook": {
      const res = await ctx.fetch(target.address, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: message.type, subject: message.subject, markdown: message.markdown, url: message.url }),
      });
      if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
      return;
    }
  }
}

/** Markdown → Slack mrkdwn (the common subset). */
export function toSlack(md: string): string {
  return md
    .replace(/^#{1,6}\s+(.*)$/gm, "*$1*")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "<$2|$1>")
    .replace(/^(\s*)[-*]\s+/gm, "$1• ");
}

function truncate(text: string, max: number, url?: string) {
  if (text.length <= max) return text;
  const tail = url ? `\n… ${url}` : "\n…";
  return text.slice(0, max - tail.length) + tail;
}
