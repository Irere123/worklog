import {
  createIdGenerator,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import type { ModelMessage } from "ai";

import { renderSnapshot, workSnapshot } from "#activity/snapshot";
import { listCards } from "#board/service";
import type { AppContext } from "#context";
import { listOpenAttention } from "#db/queries/attention";
import type { ConversationRow } from "#db/queries/conversations";
import { findMemberById, getPersonalAgent } from "#db/queries/members";
import type { Member } from "#db/queries/members";
import { getWorkspaceById } from "#db/queries/workspaces";
import { badRequest, notFound } from "#lib/errors";
import { timezoneOf } from "#members/service";
import { memoryPage } from "#memory/service";

import {
  appendMessages,
  createConversation,
  getConversation,
  loadHistory,
} from "./conversations";
import { CACHED, TIMEOUTS } from "./models";
import { assistantInstructions, turnPreamble } from "./prompts";
import { assistantTools } from "./tools";

const MAX_STEPS = 10;
const OUT_OF_STEPS =
  "I ran out of steps before finishing — could you narrow the question?";

export async function resolveAgent(
  ctx: AppContext,
  target: Member
): Promise<Member> {
  if (target.kind === "agent") {
    if (!target.ownerId) {
      throw badRequest("That agent has no owner to speak for");
    }
    return target;
  }
  return await getPersonalAgent(ctx.db, { ownerId: target.id });
}

type TurnInput = { conversationId?: string; agent?: Member; message: string };

async function prepareTurn(ctx: AppContext, asker: Member, input: TurnInput) {
  let conversation: ConversationRow;
  if (input.conversationId) {
    conversation = await getConversation(ctx, asker, input.conversationId);
  } else if (input.agent) {
    conversation = await createConversation(ctx, input.agent, asker, {
      title: input.message.slice(0, 80),
    });
  } else {
    throw badRequest("Say which conversation or agent this is for");
  }

  const agent = await findMemberById(ctx.db, {
    id: conversation.agentId,
    workspaceId: conversation.workspaceId,
  });
  const owner = agent?.ownerId
    ? await findMemberById(ctx.db, {
        id: agent.ownerId,
        workspaceId: conversation.workspaceId,
      })
    : undefined;
  if (!agent || !owner) {
    throw notFound("Agent");
  }
  const ws = await getWorkspaceById(ctx.db, { id: owner.workspaceId });

  const history = await loadHistory(ctx, conversation);
  // A new conversation opens with what's in flight, the way a person would glance at their list.
  const loops =
    history.length === 0 ? await openLoops(ctx, owner, conversation.mode) : "";
  const userMessage: ModelMessage = {
    role: "user",
    content: `${turnPreamble(ctx.now(), timezoneOf(asker, ws), asker)}${loops}\n${input.message}`,
  };
  const params = {
    instructions: assistantInstructions({
      owner,
      asker,
      mode: conversation.mode,
      workspaceName: ws.name,
      memory: await memoryPage(ctx, owner.id, conversation.mode === "owner"),
      recap: conversation.recap,
    }),
    messages: [...history, userMessage],
    tools: assistantTools({
      ctx,
      agent,
      owner,
      asker,
      mode: conversation.mode,
      conversationId: conversation.id,
    }),
    stopWhen: isStepCount(MAX_STEPS),
    timeout: TIMEOUTS.chat,
    providerOptions: CACHED,
  };
  return { conversation, owner, userMessage, params };
}

// Attention items are the owner's own queue, so a teammate's conversation only sees the cards.
async function openLoops(
  ctx: AppContext,
  owner: Member,
  mode: ConversationRow["mode"]
) {
  const parts: string[] = [];
  if (mode === "owner") {
    const items = await listOpenAttention(ctx.db, {
      memberId: owner.id,
      now: ctx.now(),
      limit: 5,
    });
    if (items.length) {
      parts.push(
        `waiting on ${owner.name}: ${items.map((i) => i.title).join("; ")}`
      );
    }
  }
  const assigned = await listCards(ctx, owner.workspaceId, {
    assigneeId: owner.id,
    limit: 50,
  });
  const cards = assigned
    .filter((c) => c.golden || c.stage === "active")
    .slice(0, 5);
  if (cards.length) {
    parts.push(
      `${owner.name}'s cards in play: ${cards.map((c) => `#${c.number} ${c.title}${c.golden ? " (golden)" : ""}`).join("; ")}`
    );
  }
  return parts.length ? `\n[Open right now: ${parts.join(" · ")}]` : "";
}

async function offlineReply(
  ctx: AppContext,
  conversation: ConversationRow,
  owner: Member
) {
  const snapshot = await workSnapshot(ctx, owner, {
    includePrivate: conversation.mode === "owner",
  });
  return `AI isn't configured on this server yet (set OPENROUTER_API_KEY), so here is ${owner.name}'s current snapshot:\n\n${renderSnapshot(snapshot)}`;
}

// Step limit hit mid-tool-call: record it so the transcript matches what the user saw.
function closing(finishReason: string, text: string) {
  const cutOff = finishReason === "tool-calls";
  return {
    reply: cutOff ? OUT_OF_STEPS : text,
    extra: cutOff
      ? [{ role: "assistant", content: OUT_OF_STEPS } as ModelMessage]
      : [],
  };
}

export async function ask(
  ctx: AppContext,
  asker: Member,
  input: TurnInput
): Promise<{ conversation: ConversationRow; reply: string }> {
  const { conversation, owner, userMessage, params } = await prepareTurn(
    ctx,
    asker,
    input
  );
  if (!ctx.models) {
    const reply = await offlineReply(ctx, conversation, owner);
    await appendMessages(ctx, conversation, [
      userMessage,
      { role: "assistant", content: reply },
    ]);
    return { conversation, reply };
  }
  const result = await generateText({ model: ctx.models.main, ...params });
  const { reply, extra } = closing(result.finishReason, result.text);
  await appendMessages(ctx, conversation, [
    userMessage,
    ...result.responseMessages,
    ...extra,
  ]);
  return { conversation, reply };
}

// Stored history is the source of truth: clients send only their new message.
export async function askStream(
  ctx: AppContext,
  asker: Member,
  input: TurnInput
): Promise<Response> {
  const { conversation, owner, userMessage, params } = await prepareTurn(
    ctx,
    asker,
    input
  );
  const headers = { "x-worklog-conversation": conversation.id };
  const generateMessageId = createIdGenerator({ prefix: "msg", size: 16 });

  if (!ctx.models) {
    const reply = await offlineReply(ctx, conversation, owner);
    await appendMessages(ctx, conversation, [
      userMessage,
      { role: "assistant", content: reply },
    ]);
    return createUIMessageStreamResponse({
      headers,
      stream: createUIMessageStream({
        generateId: generateMessageId,
        execute: ({ writer }) => {
          writer.write({ type: "text-start", id: "t1" });
          writer.write({ type: "text-delta", id: "t1", delta: reply });
          writer.write({ type: "text-end", id: "t1" });
        },
      }),
    });
  }

  const result = streamText({
    model: ctx.models.main,
    ...params,
    onEnd: async ({ responseMessages, finishReason, text }) => {
      const { extra } = closing(finishReason, text);
      await appendMessages(ctx, conversation, [
        userMessage,
        ...responseMessages,
        ...extra,
      ]);
    },
  });
  // Finish (and persist) the turn even if the phone drops the connection mid-answer.
  void result.consumeStream();
  return createUIMessageStreamResponse({
    headers,
    keepAliveMs: 15_000,
    stream: toUIMessageStream({ stream: result.stream, generateMessageId }),
  });
}
