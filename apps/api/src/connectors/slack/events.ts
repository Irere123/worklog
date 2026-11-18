import { z } from "zod";

import { isChatter } from "#connectors/chat";
import type { Normalized, Signal, WorklogEvent } from "#connectors/types";
import { hmacHex, safeEqual } from "#lib/crypto";

const MAX_SKEW_SECONDS = 60 * 5;

/** Slack signs `v0:<timestamp>:<raw body>` with the app's signing secret. */
export function verifySlack(
  signingSecret: string,
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  now: Date
) {
  if (!timestamp || !signature) {
    return false;
  }
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) {
    return false;
  }
  return safeEqual(
    signature,
    `v0=${hmacHex(signingSecret, `v0:${timestamp}:${rawBody}`)}`
  );
}

export const SlackEventSchema = z.object({
  type: z.string(),
  subtype: z.string().nullish(),
  /** message_changed: the edited message. */
  message: z
    .object({
      user: z.string().nullish(),
      text: z.string().nullish(),
      ts: z.string(),
      thread_ts: z.string().nullish(),
    })
    .nullish(),
  /** message_changed: the message as it was. */
  previous_message: z.object({ text: z.string().nullish() }).nullish(),
  /** message_deleted: which message. */
  deleted_ts: z.string().nullish(),
  user: z.string().nullish(),
  bot_id: z.string().nullish(),
  text: z.string().nullish(),
  channel: z.string().nullish(),
  channel_type: z.string().nullish(),
  ts: z.string(),
  thread_ts: z.string().nullish(),
});
export type SlackEvent = z.infer<typeof SlackEventSchema>;

export const EventCallback = z.object({
  event: SlackEventSchema,
  event_id: z.string(),
});

export const Envelope = z.object({
  type: z.string(),
  challenge: z.string().optional(),
  event_id: z.string().optional(),
  event: z.looseObject({ type: z.string() }).optional(),
});

const ChannelNames = z.record(z.string(), z.string());

const USER_MENTION = /<@(?<id>[A-Z0-9]+)(?:\|[^>]*)?>/gu;
const WL_REF = /\bWL-(?<number>\d+)\b/giu;
export const LEADING_MENTION = /^\s*<@[A-Z0-9]+(?:\|[^>]*)?>\s*/u;
export const MENTIONED_PERSON =
  /^<@(?<id>[A-Z0-9]+)(?:\|[^>]*)?>\s*(?<text>.*)$/su;

function plain(text: string) {
  return text
    .replaceAll(
      /<@(?<id>[A-Z0-9]+)(?:\|(?<name>[^>]*))?>/gu,
      (_match: string, id: string, name?: string) => `@${name ?? id}`
    )
    .replaceAll(
      /<#(?<id>[A-Z0-9]+)(?:\|(?<name>[^>]*))?>/gu,
      (_match: string, id: string, name?: string) => `#${name ?? id}`
    )
    .replaceAll(
      /<(?<url>https?:[^|>]+)(?:\|(?<label>[^>]*))?>/gu,
      (_match: string, url: string, label?: string) => label ?? url
    )
    .trim();
}

function channelNameOf(settings: Record<string, unknown>, channel: string) {
  const names = ChannelNames.safeParse(settings.channelNames);
  return (names.success ? names.data[channel] : undefined) ?? channel;
}

function mentionedUserIds(text: string) {
  const ids = [...text.matchAll(USER_MENTION)].map((m) => m.groups?.id);
  return [...new Set(ids.filter((id) => id !== undefined))];
}

function revisionOf(
  e: SlackEvent,
  settings: Record<string, unknown>,
  receivedAt: Date
): WorklogEvent | null {
  if (e.subtype === "message_deleted" && e.channel && e.deleted_ts) {
    return {
      id: `slack:${e.channel}:${e.deleted_ts}`,
      op: "delete",
      kind: "message.posted",
      occurredAt: receivedAt,
      actor: null,
      title: "deleted",
    };
  }
  if (e.subtype === "message_changed" && e.channel && e.message) {
    const text = plain(e.message.text ?? "");
    return {
      id: `slack:${e.channel}:${e.message.ts}`,
      op: "update",
      kind: "message.posted",
      occurredAt: receivedAt,
      actor: null,
      title: `Posted in #${channelNameOf(settings, e.channel)}: ${text.slice(0, 90)}`,
      body: text.slice(0, 1000),
    };
  }
  return null;
}

function sourceOf(
  e: SlackEvent
): { user: string; channel: string } | { ignored: string } {
  if (e.bot_id || !e.user) {
    return { ignored: "bot or system message" };
  }
  if (e.subtype && e.subtype !== "thread_broadcast") {
    return { ignored: `message.${e.subtype}` };
  }
  if (e.channel_type === "im" || e.channel_type === "mpim") {
    return { ignored: "direct messages are never ingested" };
  }
  if (!e.channel) {
    return { ignored: "no channel" };
  }
  return { user: e.user, channel: e.channel };
}

function messageEvent(
  e: SlackEvent,
  source: { user: string; channel: string; channelName: string },
  eventId: string,
  settings: Record<string, unknown>,
  receivedAt: Date
): WorklogEvent {
  const { user, channel, channelName } = source;
  const text = plain(e.text ?? "");
  const signals: Signal[] = mentionedUserIds(e.text ?? "")
    .filter((id) => id !== user)
    .map((id) => ({
      type: "mentioned",
      who: { id },
      excerpt: text.slice(0, 280),
      priority: "normal",
    }));
  const url =
    typeof settings.teamUrl === "string"
      ? `${settings.teamUrl}/archives/${channel}/p${e.ts.replace(".", "")}`
      : null;
  return {
    id: `slack:${channel}:${e.ts}`,
    kind: "message.posted",
    occurredAt: sentAt(e.ts, receivedAt),
    actor: { id: user },
    title: `Posted in #${channelName}: ${text.slice(0, 90)}`,
    body: text.slice(0, 1000),
    url,
    container: {
      type: "channel",
      key: `slack:${channel}`,
      name: channelName,
    },
    thread: `slack:${channel}:${e.thread_ts ?? e.ts}`,
    object: { type: "message", key: `slack:${channel}:${e.ts}`, url },
    cardRefs: {
      numbers: [
        ...new Set(
          [...text.matchAll(WL_REF)].map((m) => Number(m.groups?.number))
        ),
      ],
    },
    signals,
    visibility: e.channel_type === "group" ? "private" : "team",
    data: { eventId },
  };
}

export function normalizeSlackMessage(
  e: SlackEvent,
  eventId: string,
  settings: Record<string, unknown>,
  receivedAt: Date
): Normalized {
  if (unchangedEdit(e)) {
    return { events: [], ignored: "changed without its text changing" };
  }
  const revision = revisionOf(e, settings, receivedAt);
  if (revision) {
    return { events: [revision] };
  }
  const source = sourceOf(e);
  if ("ignored" in source) {
    return { events: [], ignored: source.ignored };
  }
  const channelName = channelNameOf(settings, source.channel);
  const base = messageEvent(
    e,
    { ...source, channelName },
    eventId,
    settings,
    receivedAt
  );
  if (addressedToBot(e.text ?? "", settings.botUserId)) {
    return { events: [], ignored: "addressed to Worklog" };
  }
  const optedIn =
    Array.isArray(settings.channels) &&
    settings.channels.includes(source.channel);

  if (!optedIn || isChatter(e.text ?? "")) {
    if ((base.signals ?? []).length === 0) {
      return {
        events: [],
        ignored: optedIn
          ? "too short to be a work update"
          : "channel not opted in",
      };
    }
    return { events: [{ ...base, hidden: true }] };
  }
  if (e.thread_ts && e.thread_ts !== e.ts) {
    return {
      events: [
        {
          ...base,
          importance: 0.2,
          coalesce: {
            key: `slack:thread:${source.channel}:${e.thread_ts}:${source.user}`,
            windowMinutes: 12 * 60,
            units: 1,
            template: `Replied {n} time{s} in a #${channelName} thread`,
          },
        },
      ],
    };
  }
  return { events: [{ ...base, importance: 0.3 }] };
}

/** A page of `conversations.history`, as the sync stores it. */
export const HistoryPage = z.object({
  channel: z.string(),
  private: z.boolean(),
  messages: z.array(z.looseObject({ ts: z.string() })),
});

function unchangedEdit(e: SlackEvent) {
  return (
    e.subtype === "message_changed" &&
    Boolean(e.previous_message) &&
    (e.previous_message?.text ?? "") === (e.message?.text ?? "")
  );
}

const LEADING_ID = /^\s*<@(?<id>[A-Z0-9]+)[|>]/u;

function addressedToBot(text: string, botUserId: unknown) {
  return (
    typeof botUserId === "string" &&
    LEADING_ID.exec(text)?.groups?.id === botUserId
  );
}

function sentAt(ts: string, receivedAt: Date) {
  const at = new Date(Number(ts) * 1000);
  return at.getTime() > 0 ? at : receivedAt;
}

export function normalizeHistory(
  payload: unknown,
  settings: Record<string, unknown>,
  receivedAt: Date
): Normalized {
  const page = HistoryPage.safeParse(payload);
  if (!page.success) {
    return { events: [], ignored: "malformed history page" };
  }
  const { channel } = page.data;
  const events: WorklogEvent[] = [];
  let skipped = 0;
  for (const message of page.data.messages) {
    const e = SlackEventSchema.safeParse({
      type: "message",
      ...message,
      channel,
      channel_type: page.data.private ? "group" : "channel",
    });
    if (!e.success) {
      skipped += 1;
      continue;
    }
    const out = normalizeSlackMessage(
      e.data,
      `history:${channel}:${e.data.ts}`,
      settings,
      receivedAt
    );
    events.push(...out.events);
    skipped += out.events.length === 0 ? 1 : 0;
  }
  return {
    events,
    ignored: events.length === 0 ? "messages without work updates" : undefined,
    skipped,
  };
}
