import { generateText, hasToolCall, isStepCount, tool } from "ai";
import { z } from "zod";

import type { AppContext } from "#context";
import type { Automation } from "#db/queries/automations";
import { getPersonalAgent } from "#db/queries/members";
import type { Member } from "#db/queries/members";
import { getWorkspaceById } from "#db/queries/workspaces";
import type { Visibility } from "#db/schema";
import { timezoneOf } from "#lib/time";

import { turnPreamble } from "./instructions";
import { renderMemory } from "./memory";
import type { Models } from "./models";
import { TIMEOUTS } from "./models";
import { audienceNote, CONSTITUTION, prompt, UNTRUSTED_NOTE } from "./prompts";
import { readTools } from "./tools";

const MAX_STEPS = 8;

/**
 * A routine runs as a turn of the owner's assistant: it looks up what its instructions need with
 * read-only tools instead of reading a dump of everything, and speaks only through send_message,
 * so a run with nothing worth saying ends quiet and its reasoning stays private. The private run
 * uses the owner's own tools; the team version uses a teammate's, so it can only find what the
 * team can see. It can't write anything or reach anyone but the automation's targets.
 */
export async function runRoutine(
  ctx: AppContext,
  models: Models,
  automation: Automation,
  member: Member,
  visibility: Visibility
) {
  const everything = visibility === "private";
  const agent = await getPersonalAgent(ctx.db, { ownerId: member.id });
  const tz = timezoneOf(
    member,
    await getWorkspaceById(ctx.db, { id: member.workspaceId })
  );
  const outbox: { sent?: { message: string; summary: string } } = {};
  const send_message = tool({
    description: everything
      ? `Deliver a message to ${member.name}. The only way anything you write reaches them.`
      : `Deliver a message to where ${member.name}'s team reads it. The only way anything you write reaches them.`,
    inputSchema: z.object({
      message: z.string().describe("Markdown: the whole message"),
      summary: z.string().describe("One line for the run's history"),
    }),
    // oxlint-disable-next-line require-await -- tools are async by contract; this one only records
    execute: async (input) => {
      outbox.sent = input;
      return { ok: true };
    },
  });
  const scope = {
    ctx,
    agent,
    owner: member,
    asker: member,
    mode: everything ? ("owner" as const) : ("teammate" as const),
    conversationId: `routine:${automation.id}`,
    said: automation.instructions ?? "",
  };
  // The last result was written from everything, so the team version doesn't see it.
  const last = everything
    ? `Last result: ${JSON.stringify(automation.state.lastResult ?? null)}\n\n`
    : "";
  const result = await generateText({
    model: models.main,
    instructions: [
      CONSTITUTION,
      prompt("custom", {
        name: member.name,
        audience: audienceNote(visibility, member.name),
      }),
      UNTRUSTED_NOTE,
    ].join("\n\n"),
    prompt: `${turnPreamble(ctx.now(), tz, member, "api")}\nRoutine "${automation.name}":\n${automation.instructions}\n\n${last}What you know about ${member.name}:\n${await renderMemory(ctx, member.id, { includePrivate: everything, journalDays: 1 })}`,
    tools: { ...readTools(scope), send_message },
    stopWhen: [isStepCount(MAX_STEPS), hasToolCall("send_message")],
    timeout: TIMEOUTS.background,
  });
  // What the routine looked up: the only links its message may carry.
  const sources = result.steps.flatMap((s) =>
    s.toolResults.map((r) => r.output)
  );
  const delivered = outbox.sent;
  return {
    message: delivered?.message.trim() ? delivered.message : null,
    summary:
      delivered?.summary ??
      (result.text.trim().slice(0, 280) || "Nothing worth saying"),
    sources,
  };
}
