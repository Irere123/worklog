import type { AppContext } from "../context";
import { toSlack } from "../delivery/service";
import type { ConnectionView, Connector, Signal, WorklogEvent } from "../ingest/types";
import { hmacHex, safeEqual } from "../lib/crypto";
import { memberByIdentity, type Member } from "../members/service";
import { HELP, leadingHandle, needsDeferral, parseCommand, runCommand } from "./commands";

const MAX_SKEW_SECONDS = 60 * 5;

/** Slack signs `v0:<timestamp>:<raw body>` with the app's signing secret. */
export function verifySlack(signingSecret: string, rawBody: string, timestamp: string | null, signature: string | null, now: Date) {
  if (!timestamp || !signature) return false;
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
  return safeEqual(signature, `v0=${hmacHex(signingSecret, `v0:${timestamp}:${rawBody}`)}`);
}

type SlackEvent = {
  type: string;
  subtype?: string;
  /** message_changed: the edited message. */
  message?: { user?: string; text?: string; ts: string; thread_ts?: string };
  /** message_deleted: which message. */
  deleted_ts?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  channel?: string;
  channel_type?: string;
  ts: string;
  thread_ts?: string;
};

/** `<@U123>` or `<@U123|name>` → U123 */
const USER_MENTION = /<@([A-Z0-9]+)(?:\|[^>]*)?>/g;
const WL_REF = /\bWL-(\d+)\b/gi;
/** Acknowledgements and chatter that never mean work moved. */
const ACK = /^(ok(ay)?|k|thanks?( you)?|thx|ty|cool|nice|great|lol|haha|yes|yep|no|nope|sure|done|\+1|same|agreed|got it|on it|ack)[.!]*$/i;
const NOISE_CHARS = /<[^>]+>|:[a-z0-9_+-]+:|[\p{Extended_Pictographic}️]/gu;
/** Short, but news: keep these even under the length threshold. */
const SHORT_BUT_NEWS = /\b(blocked|unblocked|deployed|shipped|merged|released|fixed|reverted|rolled back|on call|down|outage)\b/i;

/** Slack markup → readable plain text. */
function plain(text: string) {
  return text
    .replace(/<@([A-Z0-9]+)(?:\|([^>]*))?>/g, (_, id, name) => `@${name ?? id}`)
    .replace(/<#([A-Z0-9]+)(?:\|([^>]*))?>/g, (_, id, name) => `#${name ?? id}`)
    .replace(/<(https?:[^|>]+)(?:\|([^>]*))?>/g, (_, url, label) => label ?? url)
    .trim();
}

/**
 * Slack is where most chatter lives, so the rules are strict:
 *  - direct messages are never ingested;
 *  - @mentions of people always become signals (attention), wherever the bot can see them;
 *  - messages become activity only in channels the team opted in to (settings.channels, e.g. #standup),
 *    and only if they carry substance — "ok", "thanks 🙏", emoji-only don't;
 *  - thread replies merge per person per thread into one activity.
 */
export function normalizeSlackMessage(e: SlackEvent, eventId: string, settings: Record<string, unknown>, receivedAt: Date): { events: WorklogEvent[]; ignored?: string } {
  // Edits and deletions are applied to what we recorded — a deleted message must not linger here.
  if (e.subtype === "message_deleted" && e.channel && e.deleted_ts) {
    return { events: [{ id: `slack:${e.channel}:${e.deleted_ts}`, op: "delete", kind: "message.posted", occurredAt: receivedAt, actor: null, title: "deleted" }] };
  }
  if (e.subtype === "message_changed" && e.channel && e.message) {
    const text = plain(e.message.text ?? "");
    const channelName = (settings.channelNames as Record<string, string> | undefined)?.[e.channel] ?? e.channel;
    return {
      events: [
        { id: `slack:${e.channel}:${e.message.ts}`, op: "update", kind: "message.posted", occurredAt: receivedAt, actor: null, title: `Posted in #${channelName}: ${text.slice(0, 90)}`, body: text.slice(0, 1000) },
      ],
    };
  }
  if (e.bot_id || !e.user) return { events: [], ignored: "bot or system message" };
  if (e.subtype && e.subtype !== "thread_broadcast") return { events: [], ignored: `message.${e.subtype}` };
  if (e.channel_type === "im" || e.channel_type === "mpim") return { events: [], ignored: "direct messages are never ingested" };
  if (!e.channel) return { events: [], ignored: "no channel" };

  const text = plain(e.text ?? "");
  const channelName = (settings.channelNames as Record<string, string> | undefined)?.[e.channel] ?? e.channel;
  const signals: Signal[] = [...new Set([...(e.text ?? "").matchAll(USER_MENTION)].map((m) => m[1]!))]
    .filter((id) => id !== e.user)
    .map((id) => ({ type: "mentioned", who: { id }, excerpt: text.slice(0, 280), priority: "normal" }));

  const optedIn = Array.isArray(settings.channels) && (settings.channels as string[]).includes(e.channel);
  const substance = (e.text ?? "").replace(NOISE_CHARS, "").trim();
  const chatter = (substance.length < 12 && !SHORT_BUT_NEWS.test(substance)) || ACK.test(substance);
  const isReply = Boolean(e.thread_ts && e.thread_ts !== e.ts);
  const url = typeof settings.teamUrl === "string" ? `${settings.teamUrl}/archives/${e.channel}/p${e.ts.replace(".", "")}` : null;
  const base: WorklogEvent = {
    id: `slack:${e.channel}:${e.ts}`,
    kind: "message.posted",
    occurredAt: new Date(Number(e.ts) * 1000 || receivedAt.getTime()),
    actor: { id: e.user },
    title: `Posted in #${channelName}: ${text.slice(0, 90)}`,
    body: text.slice(0, 1000),
    url,
    container: { type: "channel", key: `slack:${e.channel}`, name: channelName },
    thread: `slack:${e.channel}:${e.thread_ts ?? e.ts}`,
    object: { type: "message", key: `slack:${e.channel}:${e.ts}`, url },
    cardRefs: { numbers: [...new Set([...text.matchAll(WL_REF)].map((m) => Number(m[1])))] },
    signals,
    // Private channels stay private to the author; public channels are team-visible.
    visibility: e.channel_type === "group" ? "private" : "team",
    data: { eventId },
  };

  if (!optedIn || chatter) {
    if (!signals.length) return { events: [], ignored: optedIn ? "too short to be a work update" : "channel not opted in" };
    return { events: [{ ...base, hidden: true }] }; // mentions still reach people
  }
  if (isReply) {
    return {
      events: [
        {
          ...base,
          importance: 0.2,
          coalesce: { key: `slack:thread:${e.channel}:${e.thread_ts}:${e.user}`, windowMinutes: 12 * 60, units: 1, template: `Replied {n} time{s} in a #${channelName} thread` },
        },
      ],
    };
  }
  return { events: [{ ...base, importance: 0.3 }] };
}

type Interaction = { kind: "command"; form: Record<string, string> } | { kind: "mention"; event: SlackEvent };

async function runSlackCommand(ctx: AppContext, conn: ConnectionView, author: Member | null, userId: string, input: string) {
  const { name, rest } = parseCommand(input);
  if (name === "help") return HELP;
  // A leading Slack mention (<@U123>) or Worklog handle (@sam) names the person.
  let target: Member | null = null;
  let text = rest;
  const slackMention = /^<@([A-Z0-9]+)(?:\|[^>]*)?>\s*(.*)$/s.exec(rest);
  if (slackMention) {
    target = await memberByIdentity(ctx, conn.workspaceId, "slack", slackMention[1]!);
    text = slackMention[2]!;
    if (!target) return "I don't know that person in Worklog yet — they need to sign in with Slack or link their account.";
  } else if (name === "now" || name === "ask") {
    ({ target, text } = await leadingHandle(ctx, author, rest));
  }
  return runCommand(ctx, author, "slack", userId, { name, text, target });
}

async function postMessage(ctx: AppContext, botToken: string, channel: string, text: string, threadTs?: string) {
  const res = await ctx.fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel, text: toSlack(text), thread_ts: threadTs, unfurl_links: false, unfurl_media: false }),
  });
  const body = (await res.json()) as { ok: boolean; error?: string };
  if (!body.ok) throw new Error(`Slack chat.postMessage: ${body.error}`);
}

export const slackConnector: Connector = {
  id: "slack",
  name: "Slack",
  description:
    "Work updates from the channels you choose, @mentions as attention items, and the /worklog and /log commands. Mention the bot in a thread to ask someone's assistant without leaving Slack.",
  secrets: [
    { key: "signingSecret", required: true, description: "App credentials → Signing secret" },
    { key: "botToken", required: true, description: "Bot user OAuth token (xoxb-…), scopes: chat:write, channels:history, app_mentions:read, commands" },
  ],
  settings: [
    { key: "channels", description: 'Channel ids whose messages count as work updates, e.g. ["C0STANDUP"] (mentions are tracked everywhere the bot is)' },
    { key: "channelNames", description: 'Optional display names, e.g. {"C0STANDUP": "standup"}' },
    { key: "teamUrl", description: "https://yourteam.slack.com — for links back to messages" },
  ],
  endpoints: { events: "events", commands: "commands" },
  identityNamespace: () => "slack",
  receive(req, conn) {
    if (!verifySlack(conn.secrets.signingSecret!, req.rawBody, req.headers.get("x-slack-request-timestamp"), req.headers.get("x-slack-signature"), req.receivedAt)) {
      return { type: "reject", status: 401, error: "bad signature" };
    }
    if (req.channel === "commands") return { type: "interaction", payload: { kind: "command", form: Object.fromEntries(new URLSearchParams(req.rawBody)) } };
    if (req.channel !== "events") return { type: "reject", status: 404, error: "unknown endpoint" };
    const payload = JSON.parse(req.rawBody);
    if (payload.type === "url_verification") return { type: "respond", body: { challenge: payload.challenge } };
    if (payload.type !== "event_callback") return { type: "respond", body: { ok: true } };
    if (payload.event?.type === "app_mention") {
      // Answering takes longer than Slack's 3 s; we reply in the thread, so Slack's retries must be no-ops.
      if (req.headers.get("x-slack-retry-num")) return { type: "respond", body: { ok: true } };
      return { type: "interaction", payload: { kind: "mention", event: payload.event } };
    }
    return { type: "event", eventType: payload.event?.type ?? "unknown", deliveryId: payload.event_id, payload };
  },
  normalize({ eventType, payload, receivedAt }, conn) {
    if (eventType !== "message") return { events: [], ignored: `${eventType} (not a work signal)` };
    const p = payload as { event: SlackEvent; event_id: string };
    return normalizeSlackMessage(p.event, p.event_id, conn.settings, receivedAt);
  },
  async interact(rawCtx, conn, payload) {
    const ctx = rawCtx as AppContext;
    const i = payload as Interaction;
    if (i.kind === "mention") {
      const e = i.event;
      const author = await memberByIdentity(ctx, conn.workspaceId, "slack", e.user ?? "");
      const text = (e.text ?? "").replace(/^\s*<@[A-Z0-9]+(?:\|[^>]*)?>\s*/, "");
      void runSlackCommand(ctx, conn, author, e.user ?? "", text)
        .then((reply) => postMessage(ctx, conn.secrets.botToken!, e.channel!, reply, e.thread_ts ?? e.ts))
        .catch((err) => console.error("[slack] mention reply failed", err));
      return { ok: true };
    }
    const form = i.form;
    const userId = form.user_id ?? "";
    const author = await memberByIdentity(ctx, conn.workspaceId, "slack", userId);
    const input = form.command === "/log" ? `log ${form.text ?? ""}` : (form.text ?? "");
    const { name } = parseCommand(input);
    if (!needsDeferral(name)) return { response_type: "ephemeral", text: toSlack(await runSlackCommand(ctx, conn, author, userId, input)) };
    const responseUrl = form.response_url;
    void runSlackCommand(ctx, conn, author, userId, input)
      .catch((err) => `Sorry, that failed: ${err instanceof Error ? err.message : err}`)
      .then((reply) =>
        responseUrl
          ? ctx.fetch(responseUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ response_type: "ephemeral", text: toSlack(reply) }),
            })
          : undefined,
      )
      .catch((err) => console.error("[slack] response_url post failed", err));
    return { response_type: "ephemeral", text: name === "brief" ? "Putting your brief together…" : "On it — thinking…" };
  },
};
