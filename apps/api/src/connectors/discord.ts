import { createPublicKey, verify } from "node:crypto";

import { z } from "zod";

import { needsDeferral, runCommand } from "#connectors/commands";
import { call } from "#connectors/http";
import type { ConnectionView, Connector, Interacted } from "#connectors/types";
import type { AppContext } from "#context";
import { findMemberByIdentity } from "#db/queries/members";

import { API, discordApp, guildChannels, putCommands } from "./discord/app";
import { discordGateway } from "./discord/gateway";
import { normalizeDiscordMessage } from "./discord/messages";

const Ping = z.object({ type: z.literal(1) });

/** Discord signs `timestamp + raw body` with Ed25519; the app's public key is hex. */
export function verifyDiscord(
  publicKeyHex: string,
  rawBody: string,
  signatureHex: string | null,
  timestamp: string | null
) {
  if (!signatureHex || !timestamp) {
    return false;
  }
  try {
    const key = createPublicKey({
      key: {
        kty: "OKP",
        crv: "Ed25519",
        x: Buffer.from(publicKeyHex, "hex").toString("base64url"),
      },
      format: "jwk",
    });
    return verify(
      null,
      Buffer.from(timestamp + rawBody),
      key,
      Buffer.from(signatureHex, "hex")
    );
  } catch {
    return false;
  }
}

export const DISCORD_COMMANDS = [
  {
    name: "log",
    description: "Record work the connectors can't see",
    options: [
      { type: 3, name: "text", description: "What you did", required: true },
    ],
  },
  {
    name: "now",
    description: "What someone is working on",
    options: [
      {
        type: 6,
        name: "person",
        description: "Who (default: you)",
        required: false,
      },
    ],
  },
  {
    name: "ask",
    description: "Ask someone's Worklog assistant (yours by default)",
    options: [
      {
        type: 3,
        name: "question",
        description: "Your question",
        required: true,
      },
      {
        type: 6,
        name: "person",
        description: "Whose assistant to ask",
        required: false,
      },
    ],
  },
  { name: "brief", description: "Your brief, right now" },
];

// Options are strings: text (type 3) and user ids (type 6).
const InteractionSchema = z.object({
  type: z.number(),
  id: z.string(),
  token: z.string(),
  application_id: z.string(),
  data: z
    .object({
      name: z.string(),
      options: z
        .array(z.object({ name: z.string(), value: z.string() }))
        .optional(),
    })
    .optional(),
  member: z.object({ user: z.object({ id: z.string() }) }).optional(),
  user: z.object({ id: z.string() }).optional(),
});
type Interaction = z.infer<typeof InteractionSchema>;

const EPHEMERAL = 64;
const UNSUPPORTED = {
  type: 4,
  data: { content: "Unsupported interaction", flags: EPHEMERAL },
};
const clip = (text: string) =>
  text.length > 1990 ? `${text.slice(0, 1985)}…` : text;

async function handleInteraction(
  ctx: AppContext,
  conn: ConnectionView,
  i: Interaction
): Promise<Interacted> {
  if (i.type !== 2 || !i.data) {
    return { body: UNSUPPORTED };
  }
  const userId = i.member?.user.id ?? i.user?.id ?? "";
  const options = i.data.options ?? [];
  const opt = (name: string) => options.find((o) => o.name === name)?.value;
  const personId = opt("person");
  if (personId && !(await memberOf(ctx, conn, personId))) {
    return {
      body: {
        type: 4,
        data: {
          content:
            "That person hasn't signed in with Discord or linked their account yet.",
          flags: EPHEMERAL,
        },
      },
    };
  }
  const job = {
    name: i.data.name,
    text: opt("text") ?? opt("question") ?? "",
    userId,
    personId: personId ?? null,
  };
  if (!needsDeferral(job.name)) {
    return {
      body: {
        type: 4,
        data: { content: clip(await answer(ctx, conn, job)), flags: EPHEMERAL },
      },
    };
  }
  // Type 5: deferred, shown as "Worklog is thinking…" until the follow-up edits it.
  return {
    body: { type: 5, data: { flags: EPHEMERAL } },
    later: {
      payload: { ...job, applicationId: i.application_id, token: i.token },
      once: i.id,
    },
  };
}

const Job = z.object({
  name: z.string(),
  text: z.string(),
  userId: z.string(),
  personId: z.string().nullable(),
  applicationId: z.string().optional(),
  token: z.string().optional(),
});

async function memberOf(ctx: AppContext, conn: ConnectionView, userId: string) {
  return await findMemberByIdentity(ctx.db, {
    workspaceId: conn.workspaceId,
    provider: "discord",
    externalIds: userId,
  });
}

async function answer(
  ctx: AppContext,
  conn: ConnectionView,
  job: z.infer<typeof Job>
) {
  const author = await memberOf(ctx, conn, job.userId);
  const target = job.personId
    ? await memberOf(ctx, conn, job.personId)
    : undefined;
  return await runCommand(ctx, author, "discord", job.userId, {
    name: job.name,
    text: job.text,
    target,
  });
}

// The person is waiting on the deferred reply: a failure gets an answer that says so.
async function followUpDiscord(
  ctx: AppContext,
  conn: ConnectionView,
  payload: Record<string, unknown>
) {
  const job = Job.parse(payload);
  let content: string;
  try {
    content = await answer(ctx, conn, job);
  } catch (error) {
    content = `Sorry, that failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  await call(
    ctx,
    "Discord follow-up",
    `${API}/webhooks/${job.applicationId}/${job.token}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: clip(content),
        allowed_mentions: { parse: [] },
      }),
    }
  );
}

export async function registerDiscordCommands(
  ctx: AppContext,
  conn: ConnectionView
) {
  const { applicationId, botToken } = conn.secrets;
  await putCommands(ctx, applicationId ?? "", botToken ?? "", DISCORD_COMMANDS);
  return DISCORD_COMMANDS.map((c) => c.name);
}

export const discordConnector: Connector = {
  id: "discord",
  name: "Discord",
  description:
    "The /log, /now, /ask and /brief commands, and delivery of briefs and pings to a channel.",
  secrets: [
    {
      key: "publicKey",
      required: true,
      description:
        "General information → Public key. Not needed when installed through the server's Discord app",
    },
    {
      key: "applicationId",
      required: true,
      description: "General information → Application id",
    },
    { key: "botToken", required: true, description: "Bot → Token" },
  ],
  settings: [
    {
      key: "channels",
      description:
        "Channel ids whose messages count as work updates (needs the server's Discord app, which reads messages over the Gateway; mentions are tracked everywhere the bot is)",
    },
    {
      key: "channelNames",
      description:
        'Display names, e.g. {"123": "standup"}; set by PUT …/sources',
    },
    {
      key: "privateChannels",
      description:
        "Chosen channels hidden from @everyone; set by PUT …/sources. Their messages stay private to their author, as in a private Slack channel",
    },
  ],
  endpoints: { interactions: "interactions" },
  identityNamespace: () => "discord",
  receive(req, keys) {
    const { publicKey } = keys.secrets;
    if (!publicKey) {
      return { type: "reject", status: 401, error: "no public key configured" };
    }
    if (
      !verifyDiscord(
        publicKey,
        req.rawBody,
        req.headers.get("x-signature-ed25519"),
        req.headers.get("x-signature-timestamp")
      )
    ) {
      return { type: "reject", status: 401, error: "bad signature" };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(req.rawBody);
    } catch {
      return { type: "reject", status: 400, error: "body is not JSON" };
    }
    // Discord pings the endpoint to verify it; it expects a PONG (type 1).
    if (Ping.safeParse(payload).success) {
      return { type: "respond", body: { type: 1 } };
    }
    return { type: "interaction", payload };
  },
  normalize: ({ eventType, payload, receivedAt }, conn) =>
    normalizeDiscordMessage(eventType, payload, conn.settings, receivedAt),
  async interact(ctx, conn, payload) {
    const interaction = InteractionSchema.safeParse(payload);
    if (!interaction.success) {
      return { body: UNSUPPORTED };
    }
    return await handleInteraction(ctx, conn, interaction.data);
  },
  followUp: followUpDiscord,
  unavailable: (message) => ({
    type: 4,
    data: { content: message, flags: EPHEMERAL },
  }),
  app: { ...discordApp(DISCORD_COMMANDS), stream: discordGateway },
  sources: {
    list: async (ctx, conn, app) =>
      await guildChannels(ctx, conn.externalId, app?.credentials.botToken),
    settings: (chosen) => ({
      channels: chosen.map((c) => c.id),
      channelNames: Object.fromEntries(chosen.map((c) => [c.id, c.name])),
      privateChannels: chosen
        .filter((c) => c.private === true)
        .map((c) => c.id),
    }),
  },
};
