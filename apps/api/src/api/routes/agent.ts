import { createRoute, z } from "@hono/zod-openapi";

import { createConversation, getConversation } from "#agent/conversations";
import { ask, askStream, resolveAgent } from "#agent/loop";
import { setVoice } from "#agent/voice";
import { body, errors, Id, json, respond, router } from "#api/router";
import {
  AgentReply,
  ChatRequest,
  chatText,
  Conversation,
  ConversationDetailResponse,
  CreateConversationRequest,
  SendMessageRequest,
  SetVoiceRequest,
  Voice,
  VoiceResponse,
} from "#api/schemas/agent";
import { ErrorSchema } from "#api/schemas/common";
import { listConversations, listMessages } from "#db/queries/conversations";
import { findVoice, listVoices } from "#db/queries/voices";
import { resolveMember } from "#members/service";

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
      const message = chatText(c.req.valid("json").message);
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
    async (c) => {
      const ctx = c.get("ctx");
      const conversation = await getConversation(
        ctx,
        c.get("member"),
        c.req.valid("param").id
      );
      const messages = await listMessages(ctx.db, {
        conversationId: conversation.id,
      });
      return respond(
        c,
        ConversationDetailResponse,
        { ...conversation, messages },
        200
      );
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
