import { z } from "zod";

import { toSlack } from "#automations/delivery";
import {
  HELP,
  leadingHandle,
  needsDeferral,
  parseCommand,
  runCommand,
} from "#connectors/commands";
import { call } from "#connectors/http";
import type { ConnectionView, Interacted } from "#connectors/types";
import type { AppContext } from "#context";
import { findMemberByIdentity } from "#db/queries/members";
import type { Member } from "#db/queries/members";

import { botTokenOf, slackApi } from "./api";
import { LEADING_MENTION, MENTIONED_PERSON, SlackEventSchema } from "./events";

export const Interaction = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("command"),
    form: z.record(z.string(), z.string()),
  }),
  z.object({
    kind: z.literal("mention"),
    event: SlackEventSchema,
    eventId: z.string().optional(),
  }),
]);

const FollowUp = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mention"), event: SlackEventSchema }),
  z.object({
    kind: z.literal("command"),
    userId: z.string(),
    input: z.string(),
    responseUrl: z.string().optional(),
  }),
]);

async function authorOf(ctx: AppContext, conn: ConnectionView, userId: string) {
  return await findMemberByIdentity(ctx.db, {
    workspaceId: conn.workspaceId,
    provider: "slack",
    externalIds: userId,
  });
}

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
    target = await authorOf(ctx, conn, person.id);
    text = person.text ?? "";
    if (!target) {
      return "I don't know that person in Worklog yet — they need to sign in with Slack or link their account.";
    }
  } else if (name === "now" || name === "ask") {
    ({ target, text } = await leadingHandle(ctx, author, rest));
  }
  return await runCommand(ctx, author, "slack", userId, { name, text, target });
}

export async function interactSlack(
  ctx: AppContext,
  conn: ConnectionView,
  payload: unknown
): Promise<Interacted> {
  const interaction = Interaction.parse(payload);
  if (interaction.kind === "mention") {
    // Answering takes longer than Slack's 3 s, so it's a job. Slack retries a slow ack with the
    // same event id, and `once` keeps the retry from answering twice.
    const { event, eventId } = interaction;
    return {
      body: { ok: true },
      later: {
        payload: { kind: "mention", event },
        once: eventId ?? `${event.channel}:${event.ts}`,
      },
    };
  }
  const { form } = interaction;
  const userId = form.user_id ?? "";
  const input =
    form.command === "/log" ? `log ${form.text ?? ""}` : (form.text ?? "");
  const { name } = parseCommand(input);
  if (!needsDeferral(name)) {
    const author = await authorOf(ctx, conn, userId);
    return {
      body: {
        response_type: "ephemeral",
        text: toSlack(await runSlackCommand(ctx, conn, author, userId, input)),
      },
    };
  }
  return {
    body: {
      response_type: "ephemeral",
      text:
        name === "brief" ? "Putting your brief together…" : "On it — thinking…",
    },
    later: {
      payload: {
        kind: "command",
        userId,
        input,
        responseUrl: form.response_url,
      },
    },
  };
}

export async function followUpSlack(
  ctx: AppContext,
  conn: ConnectionView,
  payload: Record<string, unknown>
) {
  const job = FollowUp.parse(payload);
  if (job.kind === "mention") {
    const e = job.event;
    const author = await authorOf(ctx, conn, e.user ?? "");
    const reply = await answer(
      ctx,
      conn,
      author,
      e.user ?? "",
      (e.text ?? "").replace(LEADING_MENTION, "")
    );
    if (!e.channel || !e.user) {
      return;
    }
    // Seen only by whoever asked: the answer can hold their private logs, items and brief, and a
    // channel is a team place.
    await slackApi(
      ctx,
      botTokenOf(conn.secrets),
      "chat.postEphemeral",
      {},
      {
        json: {
          channel: e.channel,
          user: e.user,
          text: toSlack(reply),
          thread_ts: e.thread_ts ?? e.ts,
        },
      }
    );
    return;
  }
  const author = await authorOf(ctx, conn, job.userId);
  const reply = await answer(ctx, conn, author, job.userId, job.input);
  if (!job.responseUrl) {
    return;
  }
  await call(ctx, "Slack response_url", job.responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response_type: "ephemeral", text: toSlack(reply) }),
  });
}

// The person asked and is waiting: a failure gets an answer that says so.
async function answer(
  ctx: AppContext,
  conn: ConnectionView,
  author: Member | undefined,
  userId: string,
  input: string
) {
  try {
    return await runSlackCommand(ctx, conn, author, userId, input);
  } catch (error) {
    return `Sorry, that failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}
