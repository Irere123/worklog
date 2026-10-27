import { z } from "zod";

import type { AppContext } from "#context";
import { findMemberByIdentity } from "#db/queries/members";
import type { Member } from "#db/queries/members";
import { toSlack } from "#delivery/service";
import type {
  ConnectionView,
  Connector,
  Normalized,
  Signal,
  WorklogEvent,
} from "#ingest/types";
import { hmacHex, safeEqual } from "#lib/crypto";

import {
  HELP,
  leadingHandle,
  needsDeferral,
  parseCommand,
  runCommand,
} from "./commands";

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

const SlackEventSchema = z.object({
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
type SlackEvent = z.infer<typeof SlackEventSchema>;

const EventCallback = z.object({
  event: SlackEventSchema,
  event_id: z.string(),
});

const Envelope = z.object({
  type: z.string(),
  challenge: z.string().optional(),
  event_id: z.string().optional(),
  event: z.looseObject({ type: z.string() }).optional(),
});

const ChannelNames = z.record(z.string(), z.string());

const USER_MENTION = /<@(?<id>[A-Z0-9]+)(?:\|[^>]*)?>/gu;
const WL_REF = /\bWL-(?<number>\d+)\b/giu;
const ACK =
  /^(?:ok(?:ay)?|k|thanks?(?: you)?|thx|ty|cool|nice|great|lol|haha|yes|yep|no|nope|sure|done|\+1|same|agreed|got it|on it|ack)[.!]*$/iu;
const NOISE_CHARS = /<[^>]+>|:[a-z0-9_+-]+:|[\p{Extended_Pictographic}️]/gu;
const SHORT_BUT_NEWS =
  /\b(?:blocked|unblocked|deployed|shipped|merged|released|fixed|reverted|rolled back|on call|down|outage)\b/iu;
const LEADING_MENTION = /^\s*<@[A-Z0-9]+(?:\|[^>]*)?>\s*/u;
const MENTIONED_PERSON = /^<@(?<id>[A-Z0-9]+)(?:\|[^>]*)?>\s*(?<text>.*)$/su;

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

function isChatter(text: string) {
  const substance = text.replaceAll(NOISE_CHARS, "").trim();
  return (
    (substance.length < 12 && !SHORT_BUT_NEWS.test(substance)) ||
    ACK.test(substance)
  );
}

// A deleted message must not linger in what we recorded.
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
    occurredAt: new Date(Number(e.ts) * 1000 || receivedAt.getTime()),
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
    // Private channels stay private to the author; public channels are team-visible.
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
    // Hidden from the stream, but the mention signals still reach people.
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

const Interaction = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("command"),
    form: z.record(z.string(), z.string()),
  }),
  z.object({ kind: z.literal("mention"), event: SlackEventSchema }),
]);

const ApiResult = z.object({ ok: z.boolean(), error: z.string().optional() });

async function runSlackCommand(
  ctx: AppContext,
  conn: ConnectionView,
  author: Member | undefined,
  userId: string,
  input: string
) {
  const { name, rest } = parseCommand(input);
  if (name === "help") {
    return HELP;
  }
  let target: Member | undefined;
  let text = rest;
  const person = MENTIONED_PERSON.exec(rest)?.groups;
  if (person?.id) {
    target = await findMemberByIdentity(ctx.db, {
      workspaceId: conn.workspaceId,
      provider: "slack",
      externalIds: person.id,
    });
    text = person.text ?? "";
    if (!target) {
      return "I don't know that person in Worklog yet — they need to sign in with Slack or link their account.";
    }
  } else if (name === "now" || name === "ask") {
    ({ target, text } = await leadingHandle(ctx, author, rest));
  }
  return await runCommand(ctx, author, "slack", userId, { name, text, target });
}

async function postMessage(
  ctx: AppContext,
  botToken: string,
  channel: string,
  text: string,
  threadTs?: string
) {
  const res = await ctx.fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel,
      text: toSlack(text),
      thread_ts: threadTs,
      unfurl_links: false,
      unfurl_media: false,
    }),
  });
  const body = ApiResult.parse(await res.json());
  if (!body.ok) {
    throw new Error(`Slack chat.postMessage: ${body.error}`);
  }
}

// Slack has already been acknowledged, so failures are only logged.
async function replyInThread(
  ctx: AppContext,
  conn: ConnectionView,
  author: Member | undefined,
  e: SlackEvent,
  text: string
) {
  try {
    const reply = await runSlackCommand(ctx, conn, author, e.user ?? "", text);
    const { botToken } = conn.secrets;
    if (!botToken || !e.channel) {
      console.error("[slack] mention reply failed: no bot token or channel");
      return;
    }
    await postMessage(ctx, botToken, e.channel, reply, e.thread_ts ?? e.ts);
  } catch (error) {
    console.error("[slack] mention reply failed", error);
  }
}

async function answerLater(
  ctx: AppContext,
  conn: ConnectionView,
  author: Member | undefined,
  userId: string,
  input: string,
  responseUrl: string | undefined
) {
  let reply: string;
  try {
    reply = await runSlackCommand(ctx, conn, author, userId, input);
  } catch (error) {
    reply = `Sorry, that failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (!responseUrl) {
    return;
  }
  try {
    await ctx.fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_type: "ephemeral",
        text: toSlack(reply),
      }),
    });
  } catch (error) {
    console.error("[slack] response_url post failed", error);
  }
}

export const slackConnector: Connector = {
  id: "slack",
  name: "Slack",
  description:
    "Work updates from the channels you choose, @mentions as attention items, and the /worklog and /log commands. Mention the bot in a thread to ask someone's assistant without leaving Slack.",
  secrets: [
    {
      key: "signingSecret",
      required: true,
      description: "App credentials → Signing secret",
    },
    {
      key: "botToken",
      required: true,
      description:
        "Bot user OAuth token (xoxb-…), scopes: chat:write, channels:history, app_mentions:read, commands",
    },
  ],
  settings: [
    {
      key: "channels",
      description:
        'Channel ids whose messages count as work updates, e.g. ["C0STANDUP"] (mentions are tracked everywhere the bot is)',
    },
    {
      key: "channelNames",
      description: 'Optional display names, e.g. {"C0STANDUP": "standup"}',
    },
    {
      key: "teamUrl",
      description: "https://yourteam.slack.com — for links back to messages",
    },
  ],
  endpoints: { events: "events", commands: "commands" },
  identityNamespace: () => "slack",
  receive(req, conn) {
    const { signingSecret } = conn.secrets;
    if (!signingSecret) {
      return {
        type: "reject",
        status: 401,
        error: "no signing secret configured",
      };
    }
    if (
      !verifySlack(
        signingSecret,
        req.rawBody,
        req.headers.get("x-slack-request-timestamp"),
        req.headers.get("x-slack-signature"),
        req.receivedAt
      )
    ) {
      return { type: "reject", status: 401, error: "bad signature" };
    }
    if (req.channel === "commands") {
      return {
        type: "interaction",
        payload: {
          kind: "command",
          form: Object.fromEntries(new URLSearchParams(req.rawBody)),
        },
      };
    }
    if (req.channel !== "events") {
      return { type: "reject", status: 404, error: "unknown endpoint" };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(req.rawBody);
    } catch {
      return { type: "reject", status: 400, error: "body is not JSON" };
    }
    const envelope = Envelope.safeParse(payload);
    if (!envelope.success) {
      return { type: "reject", status: 400, error: "not a Slack event" };
    }
    const { type, challenge, event, event_id: eventId } = envelope.data;
    if (type === "url_verification") {
      return { type: "respond", body: { challenge } };
    }
    if (type !== "event_callback") {
      return { type: "respond", body: { ok: true } };
    }
    if (event?.type === "app_mention") {
      // Answering takes longer than Slack's 3 s; we reply in the thread, so Slack's retries must be no-ops.
      if (req.headers.get("x-slack-retry-num")) {
        return { type: "respond", body: { ok: true } };
      }
      return { type: "interaction", payload: { kind: "mention", event } };
    }
    if (!eventId) {
      return { type: "reject", status: 400, error: "no event_id" };
    }
    return {
      type: "event",
      eventType: event?.type ?? "unknown",
      deliveryId: eventId,
      payload,
    };
  },
  normalize({ eventType, payload, receivedAt }, conn) {
    if (eventType !== "message") {
      return { events: [], ignored: `${eventType} (not a work signal)` };
    }
    const callback = EventCallback.safeParse(payload);
    if (!callback.success) {
      return { events: [], ignored: "malformed Slack message event" };
    }
    return normalizeSlackMessage(
      callback.data.event,
      callback.data.event_id,
      conn.settings,
      receivedAt
    );
  },
  async interact(ctx, conn, payload) {
    const interaction = Interaction.parse(payload);
    if (interaction.kind === "mention") {
      const e = interaction.event;
      const author = await findMemberByIdentity(ctx.db, {
        workspaceId: conn.workspaceId,
        provider: "slack",
        externalIds: e.user ?? "",
      });
      const text = (e.text ?? "").replace(LEADING_MENTION, "");
      void replyInThread(ctx, conn, author, e, text);
      return { ok: true };
    }
    const { form } = interaction;
    const userId = form.user_id ?? "";
    const author = await findMemberByIdentity(ctx.db, {
      workspaceId: conn.workspaceId,
      provider: "slack",
      externalIds: userId,
    });
    const input =
      form.command === "/log" ? `log ${form.text ?? ""}` : (form.text ?? "");
    const { name } = parseCommand(input);
    if (!needsDeferral(name)) {
      return {
        response_type: "ephemeral",
        text: toSlack(await runSlackCommand(ctx, conn, author, userId, input)),
      };
    }
    void answerLater(ctx, conn, author, userId, input, form.response_url);
    return {
      response_type: "ephemeral",
      text:
        name === "brief" ? "Putting your brief together…" : "On it — thinking…",
    };
  },
};
