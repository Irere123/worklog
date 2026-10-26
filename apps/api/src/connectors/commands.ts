import { renderSnapshot, workSnapshot } from "../activity/snapshot";
import { logWork } from "../activity/worklog";
import { ask, resolveAgent } from "../agent/assistant";
import { generateBrief } from "../briefs/service";
import type { AppContext } from "../context";
import { resolveMember } from "../members/service";
import type { Member } from "../members/service";

export type Command = { name: string; text: string; target?: Member | null };

export const HELP = [
  "*Worklog commands*",
  "• `log <what you did>` — record work (calls, decisions, fixes) the connectors can't see",
  "• `now [@person]` — what someone is working on right now",
  "• `ask [@person] <question>` — ask someone's assistant (yours if you don't name anyone)",
  "• `brief` — your brief, right now",
].join("\n");

export function needsDeferral(name: string) {
  return name === "ask" || name === "brief";
}

export function parseCommand(input: string): { name: string; rest: string } {
  const trimmed = input.trim();
  const [first = "", ...rest] = trimmed.split(/\s+/u);
  const name = first.toLowerCase();
  if (["log", "now", "ask", "brief", "help"].includes(name)) {
    return { name, rest: rest.join(" ") };
  }
  return trimmed ? { name: "ask", rest: trimmed } : { name: "help", rest: "" };
}

export async function runCommand(
  ctx: AppContext,
  author: Member | null,
  platform: "slack" | "discord",
  platformUserId: string,
  cmd: Command
): Promise<string> {
  if (cmd.name === "help") {
    return HELP;
  }
  if (!author) {
    return `I don't know who you are in Worklog yet. Link this ${platform} account to your member: \`POST /v1/members/me/identities\` with \`{"provider":"${platform}","externalId":"${platformUserId}"}\`.`;
  }
  switch (cmd.name) {
    case "log": {
      if (!cmd.text) {
        return "What did you work on? Try `log Paired with Sam on the payments retry bug`.";
      }
      const { activity } = await logWork(ctx, author, {
        text: cmd.text,
        via: platform,
      });
      return `Logged ✓ — "${activity.title}"`;
    }
    case "now": {
      const person = cmd.target ?? author;
      const snapshot = await workSnapshot(ctx, person, {
        includePrivate: person.id === author.id,
      });
      return renderSnapshot(snapshot);
    }
    case "ask": {
      if (!cmd.text) {
        return "What would you like to ask? e.g. `ask @sam where is the retry logic for payments?`";
      }
      const agent = await resolveAgent(ctx, cmd.target ?? author);
      const { reply } = await ask(ctx, author, { agent, message: cmd.text });
      return reply;
    }
    case "brief": {
      const brief = await generateBrief(ctx, author, "daily");
      return `*${brief.title}*\n\n${brief.body}`;
    }
    default: {
      return HELP;
    }
  }
}

export async function leadingHandle(
  ctx: AppContext,
  author: Member | null,
  text: string
) {
  const groups = /^@(?<handle>[a-z0-9][a-z0-9._-]*)\s*(?<rest>.*)$/isu.exec(
    text.trim()
  )?.groups;
  const handle = groups?.handle;
  if (!handle || !author) {
    return { target: null, text };
  }
  try {
    return {
      target: await resolveMember(ctx, author, handle),
      text: (groups?.rest ?? "").trim(),
    };
  } catch {
    return { target: null, text };
  }
}
