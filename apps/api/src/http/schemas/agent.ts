import { z } from "@hono/zod-openapi";

import { MAX_VOICE_CHARS } from "#agent/voice";
import type { MessageRow } from "#db/queries/conversations";
import type { VoiceRow } from "#db/queries/voices";
import { REPLY_RATINGS } from "#db/schema";

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
    rating: z.enum(REPLY_RATINGS).nullable().openapi({
      description: "How you rated this reply; null if you haven't",
    }),
    createdAt: Timestamp,
  })
  .openapi("Message");

type RatedMessageRow = MessageRow & {
  rating: (typeof REPLY_RATINGS)[number] | null;
};

// Tool calls and results stay server-side; clients see the readable turns.
export const MessagesResponse = derived(
  z.array(Message),
  (rows: RatedMessageRow[]) =>
    rows.filter(
      (
        r
      ): r is RatedMessageRow & { role: "user" | "assistant"; text: string } =>
        r.role !== "tool" && !!r.text
    )
);

export const MessageParams = z.object({
  id: z.string(),
  messageId: z.string(),
});

export const RateReplyRequest = z.object({
  rating: z.enum(REPLY_RATINGS),
  note: z.string().max(2000).optional().openapi({
    description:
      "Why, in your words. In your own conversations your assistant learns from it.",
    example: "Too long; give me the answer first",
  }),
});

export const ReplyRating = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    messageId: z.string(),
    rating: z.enum(REPLY_RATINGS),
    note: z.string().nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi("ReplyRating");

export const RatedReply = ReplyRating.extend({
  reply: z.string().nullable(),
  question: z.string().nullable().openapi({
    description: "The message the reply answered",
  }),
}).openapi("RatedReply");

export const ListRatingsQuery = z.object({
  rating: z.enum(REPLY_RATINGS).optional(),
});

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

const ClientMessageId = z.string().min(1).max(100);

// A useChat UIMessage is accepted, but only its id and text parts are used.
const ChatMessage = z.union([
  z.string().min(1),
  z
    .object({
      id: ClientMessageId.optional().openapi({
        description:
          "useChat's message id; sending the same one again gets the first answer back instead of a second one",
      }),
      role: z.literal("user").optional(),
      parts: z.array(
        z.looseObject({ type: z.string(), text: z.string().optional() })
      ),
    })
    .loose(),
]);

const Interrupt = z.boolean().optional().openapi({
  description:
    "Stop the answer still being written in this conversation, if there is one, and answer this instead; it sees whatever the stopped turn stored",
});

export const ChatRequest = z.object({
  message: ChatMessage,
  interrupt: Interrupt,
});

export const StopResult = z
  .object({
    stopped: z.boolean().openapi({
      description: "False if nothing was running",
    }),
  })
  .openapi("StopResult");

export function chatText(m: z.infer<typeof ChatMessage>) {
  return typeof m === "string"
    ? m
    : m.parts
        .map((p) => (p.type === "text" ? (p.text ?? "") : ""))
        .join("")
        .trim();
}

export function chatClientId(m: z.infer<typeof ChatMessage>) {
  return typeof m === "string" ? undefined : m.id;
}

export const SendMessageRequest = z.object({
  message: z.string().min(1),
  interrupt: Interrupt,
  clientMessageId: ClientMessageId.optional().openapi({
    description:
      "Your id for this message. Sending it again (say, after the connection dropped) gets the first answer back instead of a second one.",
  }),
});

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

export const WarmResult = z
  .object({
    warmed: z.boolean().openapi({
      description:
        "False when it was warmed moments ago, a turn is running, or AI isn't configured",
    }),
  })
  .openapi("WarmResult");

export const UsageQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});

export const AssistantUsage = z
  .object({
    days: z.number().int(),
    turns: z.number().int(),
    inputTokens: z.number().int(),
    cachedInputTokens: z.number().int(),
    outputTokens: z.number().int(),
    cacheHitRate: z.number().nullable().openapi({
      description:
        "Share of input tokens the provider's cache served; null with no turns",
    }),
  })
  .openapi("AssistantUsage");

export const Replay = z
  .object({
    ratingId: z.string(),
    rating: z.enum(REPLY_RATINGS),
    note: z.string().nullable(),
    question: z.string().nullable(),
    before: z
      .string()
      .nullable()
      .openapi({ description: "The reply that was rated" }),
    after: z.string().openapi({
      description:
        "What the assistant answers now, with today's prompts and model",
    }),
  })
  .openapi("Replay");
