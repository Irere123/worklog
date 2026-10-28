import type { Connector } from "#connectors/types";

import { slackApp, installationOf } from "./slack/app";
import { followUpSlack, interactSlack } from "./slack/commands";
import {
  Envelope,
  EventCallback,
  normalizeHistory,
  normalizeSlackMessage,
  verifySlack,
} from "./slack/events";
import { slackAccount, slackChannels, slackHistory } from "./slack/sync";

export { normalizeSlackMessage, verifySlack } from "./slack/events";

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
        "Bot user OAuth token (xoxb-…), scopes: chat:write, channels:history, app_mentions:read, commands; users:read.email links people by email",
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
  receive(req, keys) {
    const { signingSecret } = keys.secrets;
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
      const form = Object.fromEntries(new URLSearchParams(req.rawBody));
      return {
        type: "interaction",
        payload: { kind: "command", form, install: installationOf(form) },
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
      return {
        type: "interaction",
        payload: {
          kind: "mention",
          event,
          eventId,
          install: installationOf(payload),
        },
      };
    }
    if (!eventId) {
      return { type: "reject", status: 400, error: "no event_id" };
    }
    const channel = event?.channel;
    return {
      type: "event",
      eventType: event?.type ?? "unknown",
      deliveryId: eventId,
      payload,
      partition: typeof channel === "string" ? channel : "",
    };
  },
  normalize({ eventType, payload, receivedAt }, conn) {
    if (eventType === "sync.history") {
      return normalizeHistory(payload, conn.settings, receivedAt);
    }
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
  interact: async (ctx, conn, payload) =>
    await interactSlack(ctx, conn, payload),
  followUp: async (ctx, conn, payload) => {
    await followUpSlack(ctx, conn, payload);
  },
  unavailable: (message) => ({ response_type: "ephemeral", text: message }),
  app: slackApp,
  sync: slackHistory,
  sources: {
    list: slackChannels,
    settings: (chosen) => ({
      channels: chosen.map((c) => c.id),
      channelNames: Object.fromEntries(chosen.map((c) => [c.id, c.name])),
    }),
  },
  enrich: slackAccount,
};
