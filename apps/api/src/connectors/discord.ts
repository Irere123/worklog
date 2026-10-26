import { createPublicKey, verify } from "node:crypto";
import type { AppContext } from "../context";
import type { ConnectionView, Connector } from "../ingest/types";
import { memberByIdentity, type Member } from "../members/service";
import { needsDeferral, runCommand } from "./commands";

const API = "https://discord.com/api/v10";

/** Discord signs `timestamp + raw body` with Ed25519; the app's public key is hex. */
export function verifyDiscord(publicKeyHex: string, rawBody: string, signatureHex: string | null, timestamp: string | null) {
  if (!signatureHex || !timestamp) return false;
  try {
    const key = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(publicKeyHex, "hex").toString("base64url") },
      format: "jwk",
    });
    return verify(null, Buffer.from(timestamp + rawBody), key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

/** The slash commands we register. Same verbs as Slack. */
export const DISCORD_COMMANDS = [
  { name: "log", description: "Record work the connectors can't see", options: [{ type: 3, name: "text", description: "What you did", required: true }] },
  { name: "now", description: "What someone is working on", options: [{ type: 6, name: "person", description: "Who (default: you)", required: false }] },
  {
    name: "ask",
    description: "Ask someone's Worklog assistant (yours by default)",
    options: [
      { type: 3, name: "question", description: "Your question", required: true },
      { type: 6, name: "person", description: "Whose assistant to ask", required: false },
    ],
  },
  { name: "brief", description: "Your brief, right now" },
];

type Interaction = {
  type: number;
  id: string;
  token: string;
  application_id: string;
  data?: { name: string; options?: { name: string; value: string }[] };
  member?: { user: { id: string } };
  user?: { id: string };
};

const EPHEMERAL = 64;
const clip = (text: string) => (text.length > 1990 ? `${text.slice(0, 1985)}…` : text);

/** Returns the immediate HTTP response body. Slow commands are deferred and finished via the follow-up webhook. */
async function handleInteraction(ctx: AppContext, conn: ConnectionView, i: Interaction) {
  if (i.type !== 2 || !i.data) return { type: 4, data: { content: "Unsupported interaction", flags: EPHEMERAL } };
  const userId = i.member?.user.id ?? i.user?.id ?? "";
  const author = await memberByIdentity(ctx, conn.workspaceId, "discord", userId);
  const opt = (name: string) => i.data!.options?.find((o) => o.name === name)?.value;
  const personId = opt("person");
  let target: Member | null = null;
  if (personId) {
    target = await memberByIdentity(ctx, conn.workspaceId, "discord", personId);
    if (!target) return { type: 4, data: { content: "That person hasn't signed in with Discord or linked their account yet.", flags: EPHEMERAL } };
  }
  const cmd = { name: i.data.name, text: opt("text") ?? opt("question") ?? "", target };

  if (!needsDeferral(cmd.name)) {
    return { type: 4, data: { content: clip(await runCommand(ctx, author, "discord", userId, cmd)), flags: EPHEMERAL } };
  }
  void runCommand(ctx, author, "discord", userId, cmd)
    .catch((err) => `Sorry, that failed: ${err instanceof Error ? err.message : err}`)
    .then((content) =>
      ctx.fetch(`${API}/webhooks/${i.application_id}/${i.token}/messages/@original`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: clip(content), allowed_mentions: { parse: [] } }),
      }),
    )
    .catch((err) => console.error("[discord] follow-up failed", err));
  return { type: 5, data: { flags: EPHEMERAL } }; // "Worklog is thinking…"
}

/** Registers (overwrites) the global slash commands for this application. */
export async function registerDiscordCommands(ctx: AppContext, conn: ConnectionView) {
  const { applicationId, botToken } = conn.secrets;
  const res = await ctx.fetch(`${API}/applications/${applicationId}/commands`, {
    method: "PUT",
    headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(DISCORD_COMMANDS),
  });
  if (!res.ok) throw new Error(`Discord responded ${res.status}: ${await res.text()}`);
  return DISCORD_COMMANDS.map((c) => c.name);
}

/**
 * Discord only pushes interactions over HTTP (reading channel messages needs a Gateway bot — a
 * separate worker on the roadmap), so in the MVP it's a command surface and a delivery channel.
 */
export const discordConnector: Connector = {
  id: "discord",
  name: "Discord",
  description: "The /log, /now, /ask and /brief commands, and delivery of briefs and pings to a channel.",
  secrets: [
    { key: "publicKey", required: true, description: "General information → Public key" },
    { key: "applicationId", required: true, description: "General information → Application id" },
    { key: "botToken", required: true, description: "Bot → Token" },
  ],
  settings: [],
  endpoints: { interactions: "interactions" },
  identityNamespace: () => "discord",
  receive(req, conn) {
    if (!verifyDiscord(conn.secrets.publicKey!, req.rawBody, req.headers.get("x-signature-ed25519"), req.headers.get("x-signature-timestamp"))) {
      return { type: "reject", status: 401, error: "bad signature" };
    }
    const payload = JSON.parse(req.rawBody) as Interaction;
    if (payload.type === 1) return { type: "respond", body: { type: 1 } }; // PING → PONG
    return { type: "interaction", payload };
  },
  normalize: () => ({ events: [], ignored: "Discord sends interactions only" }),
  interact: (ctx, conn, payload) => handleInteraction(ctx as AppContext, conn, payload as Interaction),
};
