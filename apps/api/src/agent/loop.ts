import { setTimeout as sleep } from "node:timers/promises";

import {
  createIdGenerator,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import type { LanguageModelUsage, ModelMessage, ToolSet } from "ai";

import type { AppContext } from "#context";
import { listOpenAttention, listPendingFollowUps } from "#db/queries/attention";
import {
  claimConversationWarmth,
  claimConversationTurn,
  dropStaleTurnTokens,
  enqueueConversationTurn,
  findConversationById,
  findTurnStop,
  leaveConversationTurnQueue,
  releaseConversationTurn,
  requestTurnStop,
} from "#db/queries/conversations";
import type { ConversationRow } from "#db/queries/conversations";
import {
  findMemberById,
  getPersonalAgent,
  listMembers,
} from "#db/queries/members";
import type { Member } from "#db/queries/members";
import { findVoice } from "#db/queries/voices";
import { getWorkspaceById } from "#db/queries/workspaces";
import { badRequest, conflict, notFound } from "#lib/errors";
import { generateId } from "#lib/ids";
import { timezoneOf } from "#lib/time";
import { log } from "#telemetry/log";
import { listCards } from "#work/board";
import { renderSnapshot, workSnapshot } from "#work/snapshot";

import {
  answeredBefore,
  appendMessages,
  createConversation,
  getConversation,
  loadHistory,
  titleFrom,
} from "./conversations";
import {
  assistantInstructions,
  memoryNotesLine,
  openLoopsLine,
  turnPreamble,
} from "./instructions";
import type { Channel } from "./instructions";
import { memoryChanges, memoryPage } from "./memory";
import { CACHED, TIMEOUTS } from "./models";
import { WRITING_STEP, reportingSteps, turnPresence } from "./presence";
import type { ReportStep } from "./presence";
import { assistantTools } from "./tools";

const MAX_STEPS = 10;
const OUT_OF_STEPS =
  "I ran out of steps before finishing — could you narrow the question?";
const RETURNING_AFTER_MS = 2 * 60 * 60_000;
const CACHE_WARM_MS = 4 * 60_000;
const TURN_LEASE_MS = TIMEOUTS.chat.totalMs + 30_000;
const TURN_WAIT_MS = TURN_LEASE_MS + 30_000;
const TURN_POLL_MS = 250;
const STOP_POLL_MS = 500;
const STOPPED = "Stopped before finishing.";

function stoppedReply(written: string) {
  const kept = written.trimEnd();
  return kept ? `${kept}\n\n_${STOPPED}_` : STOPPED;
}

export async function resolveAgent(ctx: AppContext, target: Member) {
  if (target.kind === "agent") {
    if (!target.ownerId) {
      throw badRequest("That agent has no owner to speak for");
    }
    return target;
  }
  return await getPersonalAgent(ctx.db, { ownerId: target.id });
}

type TurnInput = {
  conversationId?: string;
  agent?: Member;
  message: string;
  /** The client's id for the message; sending it again gets the first answer back. */
  clientId?: string;
  channel?: Channel;
  /** Stop the turn running now, if any, instead of waiting for it to finish. */
  interrupt?: boolean;
};

async function openConversation(
  ctx: AppContext,
  asker: Member,
  input: TurnInput
) {
  if (input.conversationId) {
    return await getConversation(ctx, asker, input.conversationId);
  }
  if (input.agent) {
    return await createConversation(ctx, input.agent, asker, {
      title: titleFrom(input.message),
    });
  }
  throw badRequest("Say which conversation or agent this is for");
}

async function takeTurn(ctx: AppContext, conversation: ConversationRow) {
  const conversationId = conversation.id;
  const token = `${ctx.now().getTime()}:${generateId()}`;
  await enqueueConversationTurn(ctx.db, { id: conversationId, token });
  try {
    for (let waited = 0; ; waited += TURN_POLL_MS) {
      const now = ctx.now();
      const until = new Date(now.getTime() + TURN_LEASE_MS);
      if (
        await claimConversationTurn(ctx.db, {
          id: conversationId,
          token,
          now,
          until,
        })
      ) {
        return await heldTurn(ctx, conversation, until);
      }
      if (waited >= TURN_WAIT_MS) {
        throw conflict("The assistant is still answering in this conversation");
      }
      await dropStaleTurnTokens(ctx.db, {
        id: conversationId,
        beforeMs: now.getTime() - TURN_WAIT_MS - 10 * TURN_POLL_MS,
      });
      await sleep(TURN_POLL_MS);
    }
  } catch (error) {
    await leaveConversationTurnQueue(ctx.db, { id: conversationId, token });
    throw error;
  }
}

async function heldTurn(
  ctx: AppContext,
  conversation: ConversationRow,
  until: Date
) {
  const conversationId = conversation.id;
  const presence = await turnPresence(ctx, conversation, until);
  const controller = new AbortController();
  const check = async () => {
    try {
      const stopFor = await findTurnStop(ctx.db, { id: conversationId });
      if (stopFor?.getTime() === until.getTime()) {
        controller.abort();
      }
    } catch (error) {
      log.warn("assistant: couldn't check for a stop", { error });
    }
  };
  const timer = setInterval(() => {
    void check();
  }, STOP_POLL_MS);
  return {
    signal: controller.signal,
    step: presence.step,
    release: async () => {
      clearInterval(timer);
      await releaseConversationTurn(ctx.db, { id: conversationId, until });
      await presence.ended();
    },
  };
}

const WARM_GAP_MS = 4 * 60_000;

/**
 * Prepares a conversation's prompt ahead of the next message (a client calls this when someone
 * opens the chat or starts typing) and sends it with a one-token request, so the provider has its
 * start cached by the time the message arrives. Nothing is stored or answered. At most once every
 * few minutes per conversation, and skipped while a turn is running, which keeps it warm anyway.
 */
export async function warmConversation(
  ctx: AppContext,
  viewer: Member,
  conversationId: string
) {
  const conversation = await getConversation(ctx, viewer, conversationId);
  const now = ctx.now();
  if (
    !ctx.models ||
    (conversation.turnUntil !== null && conversation.turnUntil > now) ||
    !(await claimConversationWarmth(ctx.db, {
      id: conversation.id,
      now,
      gapMs: WARM_GAP_MS,
    }))
  ) {
    return { warmed: false };
  }
  const { params } = await prepareTurn(ctx, viewer, conversation, "…");
  await generateText({
    model: ctx.models.main,
    ...params,
    toolChoice: "none",
    maxOutputTokens: 1,
    stopWhen: isStepCount(1),
  });
  return { warmed: true };
}

/** Asks the turn running in a conversation, if any, to stop. Only the conversation's asker can. */
export async function stopTurn(
  ctx: AppContext,
  viewer: Member,
  conversationId: string
) {
  const conversation = await getConversation(ctx, viewer, conversationId);
  return {
    stopped: await requestTurnStop(ctx.db, {
      id: conversation.id,
      now: ctx.now(),
    }),
  };
}

async function prepareTurn(
  ctx: AppContext,
  asker: Member,
  opened: ConversationRow,
  message: string,
  channel: Channel = "api",
  onStep?: ReportStep
) {
  const conversation =
    (await findConversationById(ctx.db, {
      id: opened.id,
      workspaceId: opened.workspaceId,
    })) ?? opened;
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

  const voice = await findVoice(ctx.db, { memberId: owner.id });
  const history = await loadHistory(ctx, conversation);
  const quietFor = ctx.now().getTime() - conversation.updatedAt.getTime();
  const returning = history.length === 0 || quietFor > RETURNING_AFTER_MS;
  const tz = timezoneOf(asker, ws);
  const loops = returning
    ? await openLoops(ctx, owner, conversation.mode, tz)
    : "";
  const { page, notes, memory } = await memoryForTurn(
    ctx,
    owner,
    conversation,
    returning
  );
  const userMessage: ModelMessage = {
    role: "user",
    content: `${turnPreamble(ctx.now(), tz, asker, channel)}${loops}${memoryNotesLine(notes)}\n${message}`,
  };
  const params = {
    instructions: assistantInstructions({
      owner,
      asker,
      mode: conversation.mode,
      workspaceName: ws.name,
      voice: voice?.content ?? null,
      memory: page,
      recap: conversation.recap,
    }),
    messages: [...history, userMessage],
    tools: reported(
      assistantTools({
        ctx,
        agent,
        owner,
        asker,
        mode: conversation.mode,
        conversationId: conversation.id,
        said: message,
      }),
      onStep
    ),
    stopWhen: isStepCount(MAX_STEPS),
    timeout: TIMEOUTS.chat,
    providerOptions: CACHED,
  };
  const warm = history.length > 0 && quietFor < CACHE_WARM_MS;
  return { conversation, owner, userMessage, params, warm, memory };
}

function reported(tools: ToolSet, onStep?: ReportStep) {
  return onStep === undefined ? tools : reportingSteps(tools, onStep);
}

async function memoryForTurn(
  ctx: AppContext,
  owner: Member,
  conversation: ConversationRow,
  returning: boolean
) {
  const includePrivate = conversation.mode === "owner";
  const now = ctx.now();
  if (conversation.memoryPage === null || returning) {
    const page = await memoryPage(ctx, owner.id, includePrivate);
    return { page, notes: [], memory: { page, seenAt: now } };
  }
  const notes = await memoryChanges(
    ctx,
    owner.id,
    includePrivate,
    conversation.memorySeenAt ?? conversation.createdAt
  );
  return {
    page: conversation.memoryPage,
    notes,
    memory: notes.length ? { seenAt: now } : undefined,
  };
}

function turnUsage(usage: LanguageModelUsage) {
  return {
    inputTokens: usage.inputTokens ?? 0,
    cachedInputTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
  };
}

function noteCacheMiss(
  conversationId: string,
  warm: boolean,
  steps: readonly { usage: LanguageModelUsage }[]
) {
  const read = steps[0]?.usage.inputTokenDetails.cacheReadTokens;
  if (warm && read === 0) {
    log.warn(
      "assistant: cache miss; replayed warm history and read none of it from the cache",
      { conversationId }
    );
  }
}

async function openLoops(
  ctx: AppContext,
  owner: Member,
  mode: ConversationRow["mode"],
  timeZone: string
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
    const comingBack = await listPendingFollowUps(ctx.db, {
      memberId: owner.id,
      now: ctx.now(),
    });
    if (comingBack.length) {
      const when = new Intl.DateTimeFormat("en-GB", {
        timeZone,
        dateStyle: "medium",
        timeStyle: "short",
      });
      parts.push(
        `follow-ups you'll bring back: ${comingBack
          .slice(0, 3)
          .map(
            (f) =>
              `${f.body ?? f.title} (${f.snoozedUntil ? when.format(f.snoozedUntil) : "soon"})`
          )
          .join("; ")}`
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
  return openLoopsLine(parts);
}

async function offlineReply(
  ctx: AppContext,
  conversation: ConversationRow,
  owner: Member,
  question: string
) {
  const person = (await namedTeammate(ctx, owner, question)) ?? owner;
  const snapshot = await workSnapshot(ctx, person, {
    includePrivate: person.id === owner.id && conversation.mode === "owner",
  });
  return `AI isn't configured on this server yet (set OPENROUTER_API_KEY), so here is ${person.name}'s current snapshot:\n\n${renderSnapshot(snapshot)}`;
}

async function namedTeammate(ctx: AppContext, owner: Member, question: string) {
  const text = question.toLowerCase();
  const everyone = await listMembers(ctx.db, {
    workspaceId: owner.workspaceId,
  });
  return everyone
    .filter((m) => m.id !== owner.id)
    .toSorted((a, b) => Number(a.kind === "agent") - Number(b.kind === "agent"))
    .find((m) => namesOf(m).some((name) => mentions(text, name)));
}

function namesOf(member: Member) {
  return [
    member.name.toLowerCase(),
    member.name.split(" ")[0]?.toLowerCase() ?? "",
    `@${member.handle}`,
  ];
}

function mentions(text: string, name: string) {
  return (
    name.length > 1 &&
    new RegExp(`(?:^|[^\\p{L}@])${RegExp.escape(name)}(?![\\p{L}])`, "u").test(
      text
    )
  );
}

function closing(finishReason: string, text: string) {
  const cutOff = finishReason === "tool-calls";
  return {
    reply: cutOff ? OUT_OF_STEPS : text,
    extra: cutOff
      ? [{ role: "assistant", content: OUT_OF_STEPS } as ModelMessage]
      : [],
  };
}

export async function ask(ctx: AppContext, asker: Member, input: TurnInput) {
  const opened = await openConversation(ctx, asker, input);
  if (input.interrupt === true) {
    await requestTurnStop(ctx.db, { id: opened.id, now: ctx.now() });
  }
  const { release, signal, step } = await takeTurn(ctx, opened);
  try {
    const repeat = await sentBefore(ctx, opened, input);
    if (repeat !== null) {
      return { conversation: opened, reply: repeat };
    }
    const { conversation, owner, userMessage, params, warm, memory } =
      await prepareTurn(ctx, asker, opened, input.message, input.channel, step);
    const sent = { clientId: input.clientId, said: input.message, memory };
    if (!ctx.models) {
      const reply = await offlineReply(ctx, conversation, owner, input.message);
      await appendMessages(
        ctx,
        conversation,
        [userMessage, { role: "assistant", content: reply }],
        sent
      );
      return { conversation, reply };
    }
    const result = await generateText({
      model: ctx.models.main,
      ...params,
      abortSignal: signal,
    }).catch((error: unknown) => {
      if (signal.aborted) {
        return null;
      }
      throw error;
    });
    if (result === null) {
      await appendMessages(
        ctx,
        conversation,
        [userMessage, { role: "assistant", content: STOPPED }],
        sent
      );
      return { conversation, reply: STOPPED };
    }
    noteCacheMiss(conversation.id, warm, result.steps);
    const { reply, extra } = closing(result.finishReason, result.text);
    await appendMessages(
      ctx,
      conversation,
      [userMessage, ...result.responseMessages, ...extra],
      { ...sent, usage: turnUsage(result.usage) }
    );
    return { conversation, reply };
  } finally {
    await release();
  }
}

async function sentBefore(
  ctx: AppContext,
  conversation: ConversationRow,
  input: TurnInput
) {
  return input.clientId === undefined
    ? null
    : await answeredBefore(ctx, conversation, input.clientId);
}

function writtenReply(headers: Record<string, string>, reply: string) {
  return createUIMessageStreamResponse({
    headers,
    stream: createUIMessageStream({
      generateId: createIdGenerator({ prefix: "msg", size: 16 }),
      execute: ({ writer }) => {
        writer.write({ type: "text-start", id: "t1" });
        writer.write({ type: "text-delta", id: "t1", delta: reply });
        writer.write({ type: "text-end", id: "t1" });
      },
    }),
  });
}

export async function askStream(
  ctx: AppContext,
  asker: Member,
  input: TurnInput
) {
  const opened = await openConversation(ctx, asker, input);
  const headers = { "x-worklog-conversation": opened.id };
  if (input.interrupt === true) {
    await requestTurnStop(ctx.db, { id: opened.id, now: ctx.now() });
  }
  const { release, signal, step } = await takeTurn(ctx, opened);
  let turn: Awaited<ReturnType<typeof prepareTurn>> | string;
  try {
    turn =
      (await sentBefore(ctx, opened, input)) ??
      (await prepareTurn(
        ctx,
        asker,
        opened,
        input.message,
        input.channel,
        step
      ));
  } catch (error) {
    await release();
    throw error;
  }
  if (typeof turn === "string") {
    await release();
    return writtenReply(headers, turn);
  }
  const { conversation, owner, userMessage, params, warm, memory } = turn;
  const sent = { clientId: input.clientId, said: input.message, memory };
  const generateMessageId = createIdGenerator({ prefix: "msg", size: 16 });

  if (!ctx.models) {
    let reply: string;
    try {
      reply = await offlineReply(ctx, conversation, owner, input.message);
      await appendMessages(
        ctx,
        conversation,
        [userMessage, { role: "assistant", content: reply }],
        sent
      );
    } finally {
      await release();
    }
    return writtenReply(headers, reply);
  }

  try {
    let written = "";
    let last: "nothing" | "text" | "tool" = "nothing";
    const result = streamText({
      model: ctx.models.main,
      ...params,
      abortSignal: signal,
      onChunk: ({ chunk }) => {
        if (chunk.type === "text-delta") {
          if (last !== "text") {
            step({ tool: WRITING_STEP, input: {} });
          }
          written +=
            last === "tool" && written ? `\n\n${chunk.text}` : chunk.text;
          last = "text";
        } else if (chunk.type.startsWith("tool-")) {
          last = "tool";
        }
      },
      onAbort: async () => {
        await appendMessages(
          ctx,
          conversation,
          [userMessage, { role: "assistant", content: stoppedReply(written) }],
          sent
        );
      },
      onEnd: async ({ responseMessages, finishReason, text, steps, usage }) => {
        noteCacheMiss(conversation.id, warm, steps);
        const { extra } = closing(finishReason, text);
        await appendMessages(
          ctx,
          conversation,
          [userMessage, ...responseMessages, ...extra],
          { ...sent, usage: turnUsage(usage) }
        );
      },
      onError: ({ error }) => {
        log.error("assistant: turn failed", { error });
      },
    });
    void releaseWhenSettled(result.consumeStream(), release);
    return createUIMessageStreamResponse({
      headers,
      keepAliveMs: 15_000,
      stream: toUIMessageStream({ stream: result.stream, generateMessageId }),
    });
  } catch (error) {
    await release();
    throw error;
  }
}

async function releaseWhenSettled(
  settled: PromiseLike<void>,
  release: () => Promise<void>
) {
  try {
    await Promise.resolve(settled).catch((error: unknown) => {
      log.error("assistant: turn's stream failed", { error });
    });
  } finally {
    await release().catch((error: unknown) => {
      log.error("assistant: couldn't give the conversation back", {
        error,
      });
    });
  }
}
