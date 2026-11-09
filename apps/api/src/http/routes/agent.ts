import { createRoute, z } from "@hono/zod-openapi";

import {
  conversationDetail,
  createConversation,
  deleteConversation,
  markConversationSeen,
  rateReply,
  renameConversation,
} from "#agent/conversations";
import {
  ask,
  askStream,
  resolveAgent,
  stopTurn,
  warmConversation,
} from "#agent/loop";
import { assistantPresence } from "#agent/presence";
import { replayRating } from "#agent/replay";
import { setVoice } from "#agent/voice";
import {
  listConversations,
  listReplyRatings,
  sumTurnUsage,
} from "#db/queries/conversations";
import { findVoice, listVoices } from "#db/queries/voices";
import { body, errors, Id, json, Ok, respond, router } from "#http/router";
import {
  AgentReply,
  AssistantPresence,
  AssistantUsage,
  ChatRequest,
  chatClientId,
  chatText,
  Conversation,
  ConversationDetailResponse,
  CreateConversationRequest,
  ListRatingsQuery,
  MessageParams,
  RatedReply,
  Replay,
  RateReplyRequest,
  RenameConversationRequest,
  ReplyRating,
  SendMessageRequest,
  StopResult,
  UsageQuery,
  WarmResult,
  SetVoiceRequest,
  Voice,
  VoiceResponse,
} from "#http/schemas/agent";
import { ErrorSchema } from "#http/schemas/common";
import { DAY_MS } from "#lib/time";
import { resolveMember } from "#work/members";

export const agentRoutes = router()
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/conversations",
      operationId: "conversation.create",
      tags: ["Assistant"],
      summary: "Ask an assistant something — yours, or a teammate's",
      description:
        "Address a person (their personal assistant answers) or an agent. Asking your own assistant gives it full access to your work and lets it act for you; asking a teammate's assistant gets read-only, team-visible answers — and if it can't help, it can leave your teammate a note.",
      request: body(CreateConversationRequest),
      responses: { 201: json(AgentReply, "Answered"), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const { to, message } = c.req.valid("json");
      const agent = await resolveAgent(ctx, await resolveMember(ctx, me, to));
      if (!message) {
        const conversation = await createConversation(ctx, agent, me);
        return respond(c, AgentReply, { conversation, reply: null }, 201);
      }
      const { conversation, reply } = await ask(ctx, me, { agent, message });
      return respond(c, AgentReply, { conversation, reply }, 201);
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/conversations/{id}/chat",
      operationId: "conversation.chat",
      tags: ["Assistant"],
      summary:
        "Send a message and stream the answer (AI SDK UI-message stream, works with useChat)",
      description:
        "Streams tokens and tool activity as Server-Sent Events in the AI SDK UI-message protocol. Point `useChat`'s `DefaultChatTransport` here and send only the newest message (`prepareSendMessagesRequest: ({ messages }) => ({ body: { message: messages.at(-1) } })`); the server keeps the history.",
      request: { params: Id, ...body(ChatRequest) },
      responses: {
        200: {
          content: { "text/event-stream": { schema: z.string() } },
          description: "UI message stream",
        },
        ...errors,
      },
    }),
    async (c) => {
      const sent = c.req.valid("json").message;
      const message = chatText(sent);
      if (!message) {
        return respond(
          c,
          ErrorSchema,
          {
            error: {
              code: "invalid_request",
              message: "The message has no text",
            },
          },
          400
        );
      }
      return await askStream(c.get("ctx"), c.get("member"), {
        conversationId: c.req.valid("param").id,
        message,
        clientId: chatClientId(sent),
        interrupt: c.req.valid("json").interrupt,
      });
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/conversations/{id}/messages",
      operationId: "conversation.send",
      tags: ["Assistant"],
      summary:
        "Continue a conversation (including replying to a brief in your inbox)",
      request: { params: Id, ...body(SendMessageRequest) },
      responses: { 200: json(AgentReply), ...errors },
    }),
    async (c) =>
      respond(
        c,
        AgentReply,
        await ask(c.get("ctx"), c.get("member"), {
          conversationId: c.req.valid("param").id,
          message: c.req.valid("json").message,
          clientId: c.req.valid("json").clientMessageId,
          interrupt: c.req.valid("json").interrupt,
        }),
        200
      )
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/conversations",
      operationId: "conversation.list",
      tags: ["Assistant"],
      responses: { 200: json(z.array(Conversation)), ...errors },
    }),
    async (c) => {
      const rows = await listConversations(c.get("ctx").db, {
        askerId: c.get("member").id,
      });
      return respond(c, z.array(Conversation), rows, 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/conversations/{id}",
      operationId: "conversation.get",
      tags: ["Assistant"],
      request: { params: Id },
      responses: { 200: json(ConversationDetailResponse), ...errors },
    }),
    async (c) =>
      respond(
        c,
        ConversationDetailResponse,
        await conversationDetail(
          c.get("ctx"),
          c.get("member"),
          c.req.valid("param").id
        ),
        200
      )
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/v1/conversations/{id}",
      operationId: "conversation.rename",
      tags: ["Assistant"],
      summary: "Rename one of your conversations",
      request: { params: Id, ...body(RenameConversationRequest) },
      responses: { 200: json(Conversation), ...errors },
    }),
    async (c) =>
      respond(
        c,
        Conversation,
        await renameConversation(
          c.get("ctx"),
          c.get("member"),
          c.req.valid("param").id,
          c.req.valid("json").title
        ),
        200
      )
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/v1/conversations/{id}",
      operationId: "conversation.delete",
      tags: ["Assistant"],
      summary: "Delete one of your conversations with your own assistant",
      description:
        "Its messages and ratings go with it. A conversation with a teammate's assistant can't be deleted, since they can read it. What your assistant learned from it stays in your memory, where you can forget it.",
      request: { params: Id },
      responses: { 200: json(Ok), ...errors },
    }),
    async (c) => {
      await deleteConversation(
        c.get("ctx"),
        c.get("member"),
        c.req.valid("param").id
      );
      return respond(c, Ok, { ok: true }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/conversations/{id}/warm",
      operationId: "conversation.warm",
      tags: ["Assistant"],
      summary: "Get the assistant ready for a message that's about to come",
      description:
        "Call it when someone opens a conversation or starts typing: the next answer starts sooner and costs less, since the provider already has the prompt's start cached. Does nothing if called again within a few minutes.",
      request: { params: Id },
      responses: { 200: json(WarmResult), ...errors },
    }),
    async (c) =>
      respond(
        c,
        WarmResult,
        await warmConversation(
          c.get("ctx"),
          c.get("member"),
          c.req.valid("param").id
        ),
        200
      )
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/conversations/{id}/seen",
      operationId: "conversation.seen",
      tags: ["Assistant"],
      summary: "Say you've read what the assistant wrote in a conversation",
      description:
        "Call it when the conversation is open and a reply lands in it. Until then the reply counts as done but unseen in the assistant's presence.",
      request: { params: Id },
      responses: { 200: json(Ok), ...errors },
    }),
    async (c) => {
      await markConversationSeen(
        c.get("ctx"),
        c.get("member"),
        c.req.valid("param").id
      );
      return respond(c, Ok, { ok: true }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/assistant/presence",
      operationId: "assistant.presence",
      tags: ["Assistant"],
      summary: "What your assistant is doing now",
      description:
        "Whether it's answering or running a routine (and its current step), how many changes wait for your OK, which answers you haven't seen yet, and the routine that runs next. Every change also arrives whole as an `assistant.updated` event on the event stream, so read this once and keep the newest by `asOf`.",
      responses: { 200: json(AssistantPresence), ...errors },
    }),
    async (c) =>
      respond(
        c,
        AssistantPresence,
        await assistantPresence(c.get("ctx"), c.get("member").id),
        200
      )
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/assistant/usage",
      operationId: "assistant.usage",
      tags: ["Assistant"],
      summary:
        "What your conversations with assistants cost, and how much the prompt cache saved",
      request: { query: UsageQuery },
      responses: { 200: json(AssistantUsage), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const { days } = c.req.valid("query");
      const usage = await sumTurnUsage(ctx.db, {
        askerId: c.get("member").id,
        since: new Date(ctx.now().getTime() - days * DAY_MS),
      });
      return respond(
        c,
        AssistantUsage,
        {
          days,
          ...usage,
          cacheHitRate: usage.inputTokens
            ? usage.cachedInputTokens / usage.inputTokens
            : null,
        },
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/conversations/{id}/stop",
      operationId: "conversation.stop",
      tags: ["Assistant"],
      summary: "Stop the answer the assistant is still writing",
      description:
        "Takes effect within about a second, wherever the turn is running. The conversation records that it stopped.",
      request: { params: Id },
      responses: { 200: json(StopResult), ...errors },
    }),
    async (c) =>
      respond(
        c,
        StopResult,
        await stopTurn(c.get("ctx"), c.get("member"), c.req.valid("param").id),
        200
      )
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/v1/conversations/{id}/messages/{messageId}/rating",
      operationId: "conversation.rate",
      tags: ["Assistant"],
      summary: "Say whether a reply helped, and why",
      description:
        "Rating a reply again replaces the rating. In a conversation with your own assistant, it learns from your rating and note once the conversation goes quiet (as a line in your private memory you can read and correct). Every rating is also kept as a case to check prompt and model changes against.",
      request: { params: MessageParams, ...body(RateReplyRequest) },
      responses: { 200: json(ReplyRating), ...errors },
    }),
    async (c) => {
      const { id, messageId } = c.req.valid("param");
      const row = await rateReply(
        c.get("ctx"),
        c.get("member"),
        id,
        messageId,
        c.req.valid("json")
      );
      return respond(c, ReplyRating, row, 200);
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/ratings/{id}/replay",
      operationId: "rating.replay",
      tags: ["Assistant"],
      summary: "Ask a rated reply again, to see what the assistant answers now",
      description:
        "Re-asks the question from the same point in its conversation with today's prompts, memory and model, and returns both answers. Lookups only: nothing is changed, stored or sent.",
      request: { params: Id },
      responses: { 200: json(Replay), ...errors },
    }),
    async (c) =>
      respond(
        c,
        Replay,
        await replayRating(
          c.get("ctx"),
          c.get("member"),
          c.req.valid("param").id
        ),
        200
      )
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/ratings",
      operationId: "rating.list",
      tags: ["Assistant"],
      summary: "Replies you rated, newest first, with what they answered",
      request: { query: ListRatingsQuery },
      responses: { 200: json(z.array(RatedReply)), ...errors },
    }),
    async (c) => {
      const rows = await listReplyRatings(c.get("ctx").db, {
        memberId: c.get("member").id,
        rating: c.req.valid("query").rating,
        limit: 200,
      });
      return respond(c, z.array(RatedReply), rows, 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/voice",
      operationId: "voice.get",
      tags: ["Assistant"],
      summary: "Your instructions for how your assistant speaks for you",
      responses: { 200: json(Voice), ...errors },
    }),
    async (c) => {
      const row = await findVoice(c.get("ctx").db, {
        memberId: c.get("member").id,
      });
      return row
        ? respond(c, VoiceResponse, row, 200)
        : respond(c, Voice, { content: "", savedAt: null }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/v1/voice",
      operationId: "voice.set",
      tags: ["Assistant"],
      summary: "Tell your assistant how to speak for you",
      description:
        "Every conversation with your assistant follows it, teammates' included, so treat it as visible to your team and keep anything private in private memory. Your assistant can't change it; each save is kept, and an empty one clears it.",
      request: body(SetVoiceRequest),
      responses: { 200: json(Voice), ...errors },
    }),
    async (c) =>
      respond(
        c,
        VoiceResponse,
        await setVoice(
          c.get("ctx"),
          c.get("member"),
          c.req.valid("json").content
        ),
        200
      )
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/voice/history",
      operationId: "voice.history",
      tags: ["Assistant"],
      summary: "Every version of your instructions, newest first",
      responses: { 200: json(z.array(Voice)), ...errors },
    }),
    async (c) => {
      const rows = await listVoices(c.get("ctx").db, {
        memberId: c.get("member").id,
        limit: 100,
      });
      return respond(c, z.array(VoiceResponse), rows, 200);
    }
  );
