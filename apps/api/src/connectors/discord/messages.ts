import { z } from "zod";

import { cardNumbersIn, isChatter } from "#connectors/chat";
import type { Normalized, Signal, WorklogEvent } from "#connectors/types";

const Author = z.object({
  id: z.string(),
  username: z.string().optional(),
  global_name: z.string().nullish(),
  bot: z.boolean().optional(),
});

const DiscordMessage = z.object({
  id: z.string(),
  channel_id: z.string(),
  guild_id: z.string().optional(),
  author: Author.optional(),
  content: z.string().optional(),
  timestamp: z.string().optional(),
  edited_timestamp: z.string().nullish(),
  webhook_id: z.string().optional(),
  mentions: z.array(Author).optional(),
  message_reference: z.object({ message_id: z.string().optional() }).optional(),
});
type Message = z.infer<typeof DiscordMessage>;

const ChannelNames = z.record(z.string(), z.string());
const Ids = z.array(z.string());

function listed(settings: Record<string, unknown>, key: string) {
  const ids = Ids.safeParse(settings[key]);
  return ids.success ? ids.data : [];
}

function channelName(settings: Record<string, unknown>, channel: string) {
  const names = ChannelNames.safeParse(settings.channelNames);
  return (names.success ? names.data[channel] : undefined) ?? channel;
}

// Discord writes people as <@id> and channels as <#id>; custom emoji as <:name:id>.
function plain(m: Message, settings: Record<string, unknown>) {
  const names = new Map(
    (m.mentions ?? []).map((u) => [u.id, u.global_name ?? u.username ?? u.id])
  );
  return (m.content ?? "")
    .replaceAll(
      /<@!?(?<id>\d+)>/gu,
      (_all: string, id: string) => `@${names.get(id) ?? id}`
    )
    .replaceAll(
      /<#(?<id>\d+)>/gu,
      (_all: string, id: string) => `#${channelName(settings, id)}`
    )
    .replaceAll(
      /<a?:(?<name>\w+):\d+>/gu,
      (_all: string, name: string) => `:${name}:`
    )
    .trim();
}

// A time that doesn't parse would make an event Postgres can't store.
function dated(iso: string | null | undefined, fallback: Date) {
  const at = iso ? new Date(iso) : fallback;
  return Number.isNaN(at.getTime()) ? fallback : at;
}

const urlOf = (m: Message) =>
  m.guild_id
    ? `https://discord.com/channels/${m.guild_id}/${m.channel_id}/${m.id}`
    : null;

function revision(
  eventType: string,
  m: Message,
  settings: Record<string, unknown>,
  receivedAt: Date
): WorklogEvent | null {
  const id = `discord:${m.channel_id}:${m.id}`;
  if (eventType === "MESSAGE_DELETE") {
    return {
      id,
      op: "delete",
      kind: "message.posted",
      occurredAt: receivedAt,
      actor: null,
      title: "deleted",
    };
  }
  if (eventType === "MESSAGE_UPDATE" && m.content !== undefined) {
    const text = plain(m, settings);
    return {
      id,
      op: "update",
      kind: "message.posted",
      occurredAt: dated(m.edited_timestamp, receivedAt),
      actor: null,
      title: `Posted in #${channelName(settings, m.channel_id)}: ${text.slice(0, 90)}`,
      body: text.slice(0, 1000),
    };
  }
  return null;
}

// Chat mentions are conversation, not requests: normal priority.
function mentionsOf(m: Message, authorId: string, text: string): Signal[] {
  return (m.mentions ?? [])
    .filter((u) => u.id !== authorId && u.bot !== true)
    .map((u) => ({
      type: "mentioned",
      who: { id: u.id, handle: u.username, name: u.global_name ?? null },
      excerpt: text.slice(0, 280),
      priority: "normal",
    }));
}

/**
 * A Gateway message, by Slack's rules: work updates only from the channels chosen in `channels`
 * and only with substance; mentions reach people wherever the bot can read; replies to one
 * message merge per person; edits and deletions are applied. Bots and webhooks are noise.
 */
export function normalizeDiscordMessage(
  eventType: string,
  payload: unknown,
  settings: Record<string, unknown>,
  receivedAt: Date
): Normalized {
  const parsed = DiscordMessage.safeParse(payload);
  if (!parsed.success) {
    return { events: [], ignored: "malformed Discord message" };
  }
  const m = parsed.data;
  if (!m.guild_id) {
    return { events: [], ignored: "direct messages are never ingested" };
  }
  if (eventType !== "MESSAGE_CREATE") {
    const edit = revision(eventType, m, settings, receivedAt);
    return edit
      ? { events: [edit] }
      : { events: [], ignored: `${eventType} without content` };
  }
  const { author } = m;
  if (!author || author.bot === true || m.webhook_id) {
    return { events: [], ignored: "bot or webhook message" };
  }
  const name = channelName(settings, m.channel_id);
  const text = plain(m, settings);
  const url = urlOf(m);
  const signals = mentionsOf(m, author.id, text);
  const replyTo = m.message_reference?.message_id;
  const base: WorklogEvent = {
    id: `discord:${m.channel_id}:${m.id}`,
    kind: "message.posted",
    occurredAt: dated(m.timestamp, receivedAt),
    actor: {
      id: author.id,
      handle: author.username ?? null,
      name: author.global_name ?? null,
    },
    title: `Posted in #${name}: ${text.slice(0, 90)}`,
    body: text.slice(0, 1000),
    url,
    container: { type: "channel", key: `discord:${m.channel_id}`, name },
    thread: `discord:${m.channel_id}:${replyTo ?? m.id}`,
    object: { type: "message", key: `discord:${m.channel_id}:${m.id}`, url },
    cardRefs: { numbers: cardNumbersIn(text) },
    signals,
    // As in Slack, what only some can read stays the author's own.
    visibility: listed(settings, "privateChannels").includes(m.channel_id)
      ? "private"
      : "team",
  };
  const optedIn = listed(settings, "channels").includes(m.channel_id);
  if (!optedIn || isChatter(m.content ?? "")) {
    if (signals.length === 0) {
      return {
        events: [],
        ignored: optedIn
          ? "too short to be a work update"
          : "channel not opted in",
      };
    }
    return { events: [{ ...base, hidden: true }] };
  }
  if (replyTo) {
    return {
      events: [
        {
          ...base,
          importance: 0.2,
          coalesce: {
            key: `discord:reply:${m.channel_id}:${replyTo}:${author.id}`,
            windowMinutes: 12 * 60,
            units: 1,
            template: `Replied {n} time{s} in #${name}`,
          },
        },
      ],
    };
  }
  return { events: [{ ...base, importance: 0.3 }] };
}
