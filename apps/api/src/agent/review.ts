import { z } from "zod";

import type { AppContext } from "#context";
import { listRecentSaid } from "#db/queries/conversations";
import { generateId } from "#lib/ids";
import { log } from "#telemetry/log";
import { raiseAttention } from "#work/attention";

import { APPROVAL_KIND, describeAction, runAction } from "./actions";
import type { ActionName } from "./actions";
import { structured } from "./generate";
import { prompt, UNTRUSTED_NOTE } from "./prompts";
import type { Scope } from "./tools/scope";

const EARLIER_SAID = 6;

const Verdict = z.object({
  allow: z
    .boolean()
    .describe("True only if the owner asked for this, or plainly agreed to it"),
  reason: z
    .string()
    .describe("Why, in under 20 words, addressed to the assistant"),
});

/**
 * The check before a write the owner's teammates will see: a separate, fast model reads only what
 * the owner typed in this conversation and decides whether they asked for it. What the assistant
 * read on the way (comments, messages, tool results) can't ask for anything, so an instruction
 * planted there isn't acted on. Blocked, unsure, failed or too slow all leave the write as a
 * request in the owner's attention list, with Allow and Deny: their yes then runs exactly what was
 * proposed without passing through a model. Saying yes in the conversation works too.
 */
export async function reviewed(
  scope: Scope,
  name: ActionName,
  input: Record<string, unknown>
) {
  const { ctx, agent, owner } = scope;
  const verdict = await review(ctx, scope, { tool: name, input });
  if (verdict.allow) {
    return await runAction(ctx, agent, owner, name, input);
  }
  return {
    blocked: true,
    reason: verdict.reason,
    approvalId: await requestApproval(scope, name, input, verdict.reason),
    next: `Tell ${owner.name} what you'd do and why. It's waiting for their OK in their attention list; if they say yes here instead, try again.`,
  };
}

/** Puts a write in the owner's attention list with Allow and Deny; returns the request's id. */
export async function requestApproval(
  scope: Scope,
  name: ActionName,
  input: Record<string, unknown>,
  why: string
) {
  const { ctx, agent, owner } = scope;
  const request = await raiseAttention(ctx, {
    workspaceId: owner.workspaceId,
    memberId: owner.id,
    kind: APPROVAL_KIND,
    title: `Your assistant wants to ${describeAction(name, input)}`,
    body: why,
    priority: "normal",
    dedupeKey: `approval:${generateId()}`,
    actions: [
      { id: "allow", label: "Allow" },
      { id: "deny", label: "Deny" },
    ],
    meta: { tool: name, input, agentId: agent.id },
  });
  return request?.id ?? null;
}

async function review(
  ctx: AppContext,
  scope: Scope,
  action: { tool: string; input: unknown }
) {
  if (!ctx.models) {
    return { allow: false, reason: "Nothing is configured to check this" };
  }
  const earlier = await listRecentSaid(ctx.db, {
    conversationId: scope.conversationId,
    limit: EARLIER_SAID,
  });
  try {
    return await structured(ctx.models, {
      model: "fast",
      instructions: [
        prompt("review", { name: scope.owner.name }),
        UNTRUSTED_NOTE,
      ],
      prompt: `What ${scope.owner.name} typed in this conversation, oldest first:\n${JSON.stringify([...earlier, scope.said])}\n\nThe action:\n${JSON.stringify(action)}`,
      schema: Verdict,
      timeout: "quick",
    });
  } catch (error) {
    log.warn("agent: review failed", { error });
    return { allow: false, reason: "The check didn't answer" };
  }
}
