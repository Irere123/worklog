import { z } from "zod";

import type { StreamSpec, Streamed } from "#connectors/types";
import { shortHash } from "#lib/crypto";
import { log } from "#telemetry/log";

import { API, botGet } from "./app";

const INTENTS = 1 + 512 + 32_768;

const Frame = z.object({
  op: z.number(),
  d: z.unknown(),
  s: z.number().nullish(),
  t: z.string().nullish(),
});
const Hello = z.object({ heartbeat_interval: z.number() });
const Ready = z.object({
  session_id: z.string(),
  resume_gateway_url: z.string().optional(),
});
const Dispatched = z.object({
  id: z.string().optional(),
  content: z.string().optional(),
  guild_id: z.string().optional(),
  channel_id: z.string().optional(),
  edited_timestamp: z.string().nullish(),
  unavailable: z.boolean().optional(),
});
const GatewayBot = z.object({ url: z.string() });

type Session = {
  sessionId?: string;
  seq?: number;
  stored?: number;
  resumeUrl?: string;
  refused?: string;
};

const REFUSED: Record<number, string> = {
  4004: "the bot token was refused",
  4013: "invalid intents",
  4014: "the Message Content intent isn't enabled for the bot",
};
const FRESH = new Set([4007, 4009]);

const MESSAGES = new Set([
  "MESSAGE_CREATE",
  "MESSAGE_UPDATE",
  "MESSAGE_DELETE",
]);

function deliveryOf(t: string, d: z.infer<typeof Dispatched>) {
  if (t === "MESSAGE_CREATE") {
    return `msg:${d.id}`;
  }
  if (t === "MESSAGE_UPDATE") {
    const version = d.edited_timestamp ?? shortHash(d.content ?? "");
    return `edit:${d.id}:${version}`;
  }
  return `del:${d.id}`;
}

function itemOf(t: string, raw: unknown): Streamed | null {
  const d = Dispatched.safeParse(raw);
  if (!d.success || !d.data.guild_id) {
    return null;
  }
  if (MESSAGES.has(t) && d.data.id && d.data.channel_id) {
    return {
      type: "event",
      externalId: d.data.guild_id,
      deliveryId: deliveryOf(t, d.data),
      eventType: t,
      payload: raw,
      partition: d.data.channel_id,
    };
  }
  if (t === "GUILD_DELETE" && d.data.unavailable !== true) {
    return {
      type: "change",
      externalId: d.data.guild_id,
      change: {
        type: "status",
        status: "revoked",
        reason: "the bot was removed from the server",
      },
    };
  }
  return null;
}

/**
 * The Gateway connection, from Hello to close: identify or resume, heartbeat, hand dispatches to
 * `emit` one at a time and in order. Resolves when the socket closes, for the runner to reconnect.
 */
export const discordGateway: StreamSpec = {
  async run(ctx, app, emit, { signal, state }) {
    const session = state as Session;
    const token = app.credentials.botToken ?? "";
    if (!session.resumeUrl) {
      const bot = GatewayBot.parse(
        await botGet(ctx, "Discord gateway", `${API}/gateway/bot`, token)
      );
      session.resumeUrl = bot.url;
    }
    const ws = new WebSocket(`${session.resumeUrl}/?v=10&encoding=json`);
    let beat: ReturnType<typeof setInterval> | null = null;
    let acked = true;
    let failed = false;
    let pending: Promise<unknown> = Promise.resolve();
    const send = (op: number, d: unknown) => {
      ws.send(JSON.stringify({ op, d }));
    };
    const heartbeat = () => {
      if (!acked) {
        ws.close(4000, "no heartbeat ack");
        return;
      }
      acked = false;
      send(1, session.seq ?? null);
    };
    const onMessage = (data: unknown) => {
      const frame = Frame.safeParse(JSON.parse(String(data)));
      if (!frame.success) {
        return;
      }
      const { op, d, s, t } = frame.data;
      if (typeof s === "number") {
        session.seq = s;
      }
      if (op === 10) {
        const { heartbeat_interval: every } = Hello.parse(d);
        beat = setInterval(heartbeat, every);
        const from = session.stored ?? session.seq;
        if (session.sessionId && from !== undefined) {
          send(6, { token, session_id: session.sessionId, seq: from });
        } else {
          send(2, {
            token,
            intents: INTENTS,
            properties: { os: "linux", browser: "worklog", device: "worklog" },
          });
        }
      } else if (op === 11) {
        acked = true;
      } else if (op === 1) {
        send(1, session.seq ?? null);
      } else if (op === 7) {
        ws.close(4000, "reconnect requested");
      } else if (op === 9) {
        if (d !== true) {
          session.sessionId = undefined;
          session.seq = undefined;
          session.stored = undefined;
        }
        ws.close(4000, "invalid session");
      } else if (op === 0 && t) {
        if (t === "READY") {
          const ready = Ready.parse(d);
          session.sessionId = ready.session_id;
          session.resumeUrl = ready.resume_gateway_url ?? session.resumeUrl;
        }
        const at = session.seq ?? 0;
        const item = itemOf(t, d);
        pending = pending.then(async () => {
          if (failed) {
            return at;
          }
          try {
            if (item) {
              await emit(item);
            }
            session.stored = at;
          } catch (error) {
            failed = true;
            log.error("discord: couldn't store a dispatch", { error });
            ws.close(4000, "couldn't store a dispatch");
          }
          return at;
        });
      }
    };
    // oxlint-disable-next-line promise/avoid-new -- a socket's close event becomes the one thing to await.
    await new Promise<void>((resolve) => {
      const stop = () => {
        ws.close(1000, "stopping");
      };
      signal.addEventListener("abort", stop, { once: true });
      ws.addEventListener("message", (e) => {
        try {
          onMessage(e.data);
        } catch (error) {
          log.error("discord: gateway message failed", { error });
        }
      });
      ws.addEventListener("close", (e) => {
        signal.removeEventListener("abort", stop);
        if (beat) {
          clearInterval(beat);
        }
        if (REFUSED[e.code]) {
          session.refused = REFUSED[e.code];
        }
        if (FRESH.has(e.code)) {
          session.sessionId = undefined;
          session.seq = undefined;
          session.stored = undefined;
        }
        resolve();
      });
    });
    await pending;
  },
};
