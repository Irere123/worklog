import { createPublicKey, verify } from "node:crypto";

import { z } from "zod";

import type { AppContext } from "#context";
import { findMemberByIdentity } from "#db/queries/members";
import type { Member } from "#db/queries/members";
import { needsDeferral, runCommand } from "#ingest/commands";
import type { ConnectionView, Connector } from "#ingest/types";

const API = "https://discord.com/api/v10";

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
) {
  if (i.type !== 2 || !i.data) {
    return UNSUPPORTED;
  }
  const userId = i.member?.user.id ?? i.user?.id ?? "";
  const author = await findMemberByIdentity(ctx.db, {
    workspaceId: conn.workspaceId,
    provider: "discord",
    externalIds: userId,
  });
  const options = i.data.options ?? [];
  const opt = (name: string) => options.find((o) => o.name === name)?.value;
  const personId = opt("person");
  let target: Member | undefined;
  if (personId) {
    target = await findMemberByIdentity(ctx.db, {
      workspaceId: conn.workspaceId,
      provider: "discord",
      externalIds: personId,
    });
    if (!target) {
      return {
        type: 4,
        data: {
          content:
            "That person hasn't signed in with Discord or linked their account yet.",
          flags: EPHEMERAL,
        },
      };
    }
  }
  const cmd = {
    name: i.data.name,
    text: opt("text") ?? opt("question") ?? "",
    target,
  };

  if (!needsDeferral(cmd.name)) {
    return {
      type: 4,
      data: {
        content: clip(await runCommand(ctx, author, "discord", userId, cmd)),
        flags: EPHEMERAL,
      },
    };
  }
  void followUp(
    ctx,
    i,
    async () => await runCommand(ctx, author, "discord", userId, cmd)
  );
  // Type 5: deferred response, shown to the user as "Worklog is thinking…".
  return { type: 5, data: { flags: EPHEMERAL } };
}

// Already acknowledged, so failures are only logged.
async function followUp(
  ctx: AppContext,
  i: Interaction,
  answer: () => Promise<string>
) {
  let content: string;
  try {
    content = await answer();
  } catch (error) {
    content = `Sorry, that failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  try {
    await ctx.fetch(
      `${API}/webhooks/${i.application_id}/${i.token}/messages/@original`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: clip(content),
          allowed_mentions: { parse: [] },
        }),
      }
    );
  } catch (error) {
    console.error("[discord] follow-up failed", error);
  }
}

export async function registerDiscordCommands(
  ctx: AppContext,
  conn: ConnectionView
) {
  const { applicationId, botToken } = conn.secrets;
  const res = await ctx.fetch(`${API}/applications/${applicationId}/commands`, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(DISCORD_COMMANDS),
  });
  if (!res.ok) {
    throw new Error(`Discord responded ${res.status}: ${await res.text()}`);
  }
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
      description: "General information → Public key",
    },
    {
      key: "applicationId",
      required: true,
      description: "General information → Application id",
    },
    { key: "botToken", required: true, description: "Bot → Token" },
  ],
  settings: [],
  endpoints: { interactions: "interactions" },
  identityNamespace: () => "discord",
  receive(req, conn) {
    const { publicKey } = conn.secrets;
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
  normalize: () => ({ events: [], ignored: "Discord sends interactions only" }),
  async interact(ctx, conn, payload) {
    const interaction = InteractionSchema.safeParse(payload);
    if (!interaction.success) {
      return UNSUPPORTED;
    }
    return await handleInteraction(ctx, conn, interaction.data);
  },
};
