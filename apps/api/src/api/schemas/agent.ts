import { z } from "@hono/zod-openapi";

import { MAX_VOICE_CHARS } from "#agent/voice";
import type { MessageRow } from "#db/queries/conversations";
import type { VoiceRow } from "#db/queries/voices";

import { derived, Timestamp } from "./common";

export const Conversation = z
  .object({
    id: z.string(),
    agentId: z.string(),
    askerId: z.string(),
    mode: z.enum(["owner", "teammate"]),
    inbox: z.boolean(),
    title: z.string().nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi("Conversation");

export const Message = z
  .object({
    id: z.string(),
    seq: z.number().int(),
    role: z.enum(["user", "assistant"]),
    text: z.string(),
    createdAt: Timestamp,
  })
  .openapi("Message");

// Tool calls and results stay server-side; clients see the readable turns.
export const MessagesResponse = derived(
  z.array(Message),
  (rows: MessageRow[]) =>
    rows.filter(
      (r): r is MessageRow & { role: "user" | "assistant"; text: string } =>
        r.role !== "tool" && !!r.text
    )
);

export const ConversationDetailResponse = Conversation.extend({
  messages: MessagesResponse,
});

export const AgentReply = z
  .object({
    conversation: Conversation,
    reply: z
      .string()
      .nullable()
      .openapi({ description: "Markdown; null when no message was sent" }),
  })
  .openapi("AgentReply");

export const CreateConversationRequest = z.object({
  to: z.string().default("me").openapi({
    description: 'Member id or handle (human or agent), or "me"',
    example: "@sam",
  }),
  message: z.string().min(1).optional().openapi({
    description:
      "Omit to just open a conversation (e.g. before streaming with /chat)",
  }),
});

// A useChat UIMessage is accepted, but only its text parts are used.
const ChatMessage = z.union([
  z.string().min(1),
  z
    .object({
      role: z.literal("user").optional(),
      parts: z.array(
        z.looseObject({ type: z.string(), text: z.string().optional() })
      ),
    })
    .loose(),
]);

export const ChatRequest = z.object({ message: ChatMessage });

export function chatText(m: z.infer<typeof ChatMessage>) {
  return typeof m === "string"
    ? m
    : m.parts
        .map((p) => (p.type === "text" ? (p.text ?? "") : ""))
        .join("")
        .trim();
}

export const SendMessageRequest = z.object({ message: z.string().min(1) });

export const Voice = z
  .object({
    content: z.string().openapi({ description: "Markdown; empty when unset" }),
    savedAt: Timestamp.nullable().openapi({
      description: "Null until you first save one",
    }),
  })
  .openapi("Voice");

export const VoiceResponse = derived(Voice, (v: VoiceRow) => ({
  content: v.content,
  savedAt: v.createdAt,
}));

export const SetVoiceRequest = z.object({
  content: z.string().max(MAX_VOICE_CHARS).openapi({
    example:
      "Sign off as Em. Send anyone asking about payments to #payments-oncall first.",
  }),
});
