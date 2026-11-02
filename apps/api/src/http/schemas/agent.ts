import { z } from "@hono/zod-openapi";

import { MAX_VOICE_CHARS } from "#agent/voice";
import type { MessageRow } from "#db/queries/conversations";
import type { VoiceRow } from "#db/queries/voices";
import { REPLY_RATINGS } from "#db/schema";

import { derived, IsoTimestamp, Timestamp } from "./common";

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

const Found = z
  .object({
    title: z.string(),
    number: z
      .number()
      .int()
      .nullable()
      .openapi({ description: "Set for a card" }),
    at: IsoTimestamp.nullable().openapi({
      description: "When it happened, for activity",
    }),
    source: z.string().nullable(),
    url: z.string().nullable(),
  })
  .openapi("StepFound");

// What a lookup returned, as references: enough to show and open each one, never the full text.
const FOUND_SHOWN = 8;

const MessageStep = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("thought"),
      text: z.string().openapi({ description: "The model's reasoning" }),
    }),
    z.object({
      kind: z.literal("tool"),
      tool: z.string().openapi({ example: "search_activity" }),
      input: z.unknown().openapi({ description: "What the tool was asked" }),
      ok: z.boolean().openapi({ description: "False if the tool failed" }),
      count: z.number().int().nullable().openapi({
        description: "How many results came back, when the tool returns a list",
      }),
      found: z.array(Found).openapi({
        description: `The first ${FOUND_SHOWN} cards or events a lookup found, so they can be checked`,
      }),
      approvalId: z.string().nullable().openapi({
        description:
          "Set when a write teammates would see is waiting for your Allow: the attention item to answer",
      }),
    }),
  ])
  .openapi("MessageStep");

export const Message = z
  .object({
    id: z.string(),
    seq: z.number().int(),
    role: z.enum(["user", "assistant"]),
    text: z.string(),
    steps: z.array(MessageStep).openapi({
      description:
        "What the assistant did before this reply, in order: its reasoning and the tools it called. Empty for your own messages.",
    }),
    rating: z.enum(REPLY_RATINGS).nullable().openapi({
      description: "How you rated this reply; null if you haven't",
    }),
    createdAt: Timestamp,
  })
  .openapi("Message");

type RatedMessageRow = MessageRow & {
  rating: (typeof REPLY_RATINGS)[number] | null;
};

type Step = z.input<typeof MessageStep>;

// A turn is stored as the model saw it: tool calls and results in their own rows. Clients get the
// readable messages, each reply carrying the steps that led to it. Tool results stay server-side:
// a step says whether the tool worked, how many results it found and what the first few were.
export const MessagesResponse = derived(
  z.array(Message),
  (rows: RatedMessageRow[]) => {
    const out: z.input<typeof Message>[] = [];
    // One reply per question, as it streamed: text written before a tool call ("Let me check")
    // and the answer after it read as one message, named by its last row so ratings still match.
    let steps: Traced[] = [];
    let said: string[] = [];
    let last: RatedMessageRow | null = null;
    const flush = () => {
      if (last && said.length > 0) {
        out.push({
          ...last,
          role: "assistant",
          text: said.join("\n\n"),
          steps: steps.map(({ callId: _callId, ...step }) => step),
        });
      }
      steps = [];
      said = [];
      last = null;
    };
    for (const row of rows) {
      if (row.role === "user") {
        flush();
        if (row.text) {
          out.push({ ...row, role: "user", text: row.text, steps: [] });
        }
      } else if (row.role === "tool") {
        settleTools(steps, row.content);
      } else {
        steps.push(...stepsOf(row.content));
        if (row.text) {
          said.push(row.text);
          last = row;
        }
      }
    }
    flush();
    return out;
  }
);

type Part = {
  type?: unknown;
  text?: unknown;
  toolName?: unknown;
  toolCallId?: unknown;
  input?: unknown;
  output?: { type?: unknown; value?: unknown };
};

function partsOf(content: unknown): Part[] {
  const inner =
    typeof content === "object" && content !== null && "content" in content
      ? content.content
      : null;
  return Array.isArray(inner)
    ? inner.filter(
        (part): part is Part => typeof part === "object" && part !== null
      )
    : [];
}

type Traced = Step & { callId?: string };

function stepsOf(content: unknown): Traced[] {
  return partsOf(content).flatMap((part): Traced[] => {
    if (
      part.type === "reasoning" &&
      typeof part.text === "string" &&
      part.text.trim()
    ) {
      return [{ kind: "thought", text: part.text }];
    }
    if (part.type === "tool-call" && typeof part.toolName === "string") {
      return [
        {
          kind: "tool",
          tool: part.toolName,
          input: part.input ?? null,
          ok: true,
          count: null,
          found: [],
          approvalId: null,
          callId:
            typeof part.toolCallId === "string" ? part.toolCallId : undefined,
        },
      ];
    }
    return [];
  });
}

function foundIn(value: unknown): z.input<typeof Found>[] {
  const items = Array.isArray(value) ? value : [value];
  return items.slice(0, FOUND_SHOWN).flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null) {
      return [];
    }
    const field = (key: string): unknown =>
      Object.getOwnPropertyDescriptor(item, key)?.value;
    const title = field("title");
    if (typeof title !== "string") {
      return [];
    }
    const text = (key: string) => {
      const v = field(key);
      return typeof v === "string" ? v : null;
    };
    const number = field("number");
    return [
      {
        title,
        number: typeof number === "number" ? number : null,
        at: text("at"),
        source: text("source"),
        url: text("url"),
      },
    ];
  });
}

// A write the review held back returns `{ blocked: true, approvalId }` instead of running.
// A held write says `blocked`; a proposed routine says `proposed`. Both wait on the same Allow.
function heldFor(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const waiting =
    ("blocked" in value && value.blocked === true) ||
    ("proposed" in value && value.proposed === true);
  const id = "approvalId" in value ? value.approvalId : null;
  return waiting && typeof id === "string" ? id : null;
}

function settleTools(steps: Traced[], content: unknown) {
  for (const part of partsOf(content)) {
    const step = steps.find(
      (s) =>
        s.kind === "tool" &&
        s.callId !== undefined &&
        s.callId === part.toolCallId
    );
    if (step?.kind === "tool") {
      const kind =
        typeof part.output?.type === "string" ? part.output.type : "";
      step.ok = !kind.startsWith("error");
      step.count = Array.isArray(part.output?.value)
        ? part.output.value.length
        : null;
      step.approvalId = heldFor(part.output?.value);
      step.found = foundIn(part.output?.value);
    }
  }
}

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

export const RenameConversationRequest = z.object({
  title: z.string().trim().min(1).max(120),
});
