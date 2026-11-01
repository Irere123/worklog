import { useChat } from "@ai-sdk/react";
import {
  ArrowUpIcon,
  CaretRightIcon,
  ChatsCircleIcon,
  CheckIcon,
  CircleNotchIcon,
  CopyIcon,
  LockIcon,
  StopIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { Schemas } from "#api/client";
import { api, authHeaders, unwrap } from "#api/client";
import { useMe } from "#features/auth/session";
import { useMembers } from "#features/cards/card-bits";
import { Avatar } from "#ui/avatar";
import { Kbd } from "#ui/chip";
import { VisuallyHidden } from "#ui/feedback";
import { Markdown } from "#ui/markdown";
import { Tooltip } from "#ui/overlay";
import {
  color,
  leading,
  media,
  motion,
  radius,
  shadow,
  space,
  text,
} from "#ui/tokens.stylex";

type Conversation = Schemas["Conversation"];
type Stored = Schemas["Message"];

const OWNER_PROMPTS = [
  "What needs me today?",
  "What did the team ship this week?",
  "Remind me Thursday to check the Postgres upgrade",
  "Draft my standup from yesterday’s work",
];

function toUi(messages: Stored[]): UIMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    parts: [{ type: "text", text: m.text }],
  }));
}

export function Chat({
  conversation,
  stored,
  firstMessage,
}: {
  conversation: Conversation;
  stored: Stored[];
  firstMessage?: string;
}) {
  const client = useQueryClient();
  const me = useMe();
  const { byId } = useMembers();
  const agent = byId.get(conversation.agentId);
  const owner = agent?.ownerId ? byId.get(agent.ownerId) : undefined;
  const teammate = conversation.mode === "teammate";
  const ratings = useMemo(
    () => new Map(stored.map((m) => [m.id, m.rating])),
    [stored]
  );
  const storedIds = useMemo(() => new Set(stored.map((m) => m.id)), [stored]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/v1/conversations/${conversation.id}/chat`,
        credentials: "include",
        headers: () => authHeaders(),
        // The server keeps the history; it wants only the newest message, plus whether this one
        // steers a reply that's still being written.
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: {
            message: messages.at(-1),
            interrupt: Boolean(
              (body as { interrupt?: boolean } | undefined)?.interrupt
            ),
          },
        }),
      }),
    [conversation.id]
  );

  const chat = useChat({
    id: conversation.id,
    messages: toUi(stored),
    transport,
    throttle: 50,
    onFinish: () => {
      void client.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (error) => {
      toast.error(error.message || "The assistant couldn’t answer");
    },
  });
  const busy = chat.status === "submitted" || chat.status === "streaming";

  // After a reply settles, adopt the stored transcript so message ids match the server's and
  // replies can be rated.
  const adoptStored = useEffectEvent(
    (transcript: Stored[], responding: boolean) => {
      if (
        !responding &&
        transcript.length > 0 &&
        transcript.length >= chat.messages.length
      ) {
        chat.setMessages(toUi(transcript));
      }
    }
  );
  useEffect(() => {
    adoptStored(stored, busy);
  }, [stored, busy]);

  // Deferred to a cancellable timer: a dev double-mount tears down the first chat instance, and a
  // message sent straight from the effect would die with it.
  const sentFirst = useRef(false);
  const hasHistory = useEffectEvent(() => stored.length > 0);
  const sendFirst = useEffectEvent((message: string) => {
    sentFirst.current = true;
    void chat.sendMessage({ text: message });
  });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (firstMessage && !sentFirst.current && !hasHistory()) {
      timer = setTimeout(() => sendFirst(firstMessage), 0);
    }
    return () => clearTimeout(timer);
  }, [firstMessage]);

  const stop = async () => {
    await chat.stop();
    await api.POST("/v1/conversations/{id}/stop", {
      params: { path: { id: conversation.id } },
    });
    void client.invalidateQueries({
      queryKey: ["conversations", conversation.id],
    });
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const last = chat.messages.at(-1);
  const lastLength =
    last?.parts.reduce(
      (n, p) => n + (p.type === "text" ? p.text.length : 1),
      0
    ) ?? 0;
  const contentSize = `${chat.messages.length}:${lastLength}`;
  const followedSize = useRef("");
  useEffect(() => {
    if (followedSize.current === contentSize) {
      return;
    }
    followedSize.current = contentSize;
    const el = scrollRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) {
      el.scrollTop = el.scrollHeight;
    }
  }, [contentSize]);
  // The route keys this view by conversation, so mounting means a conversation was opened.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, []);

  const name = teammate
    ? `${owner?.name ?? "Their"}'s assistant`
    : "Your assistant";

  return (
    <div {...stylex.props(styles.chat)}>
      {teammate && (
        <div {...stylex.props(styles.banner)}>
          <LockIcon size={13} />
          You’re asking {owner?.name ?? "a teammate"}’s assistant. It answers
          from their team-visible work only, and they can see this conversation.
        </div>
      )}
      <div ref={scrollRef} {...stylex.props(styles.scroll)}>
        <div
          {...stylex.props(styles.thread)}
          role="log"
          aria-label="Conversation"
        >
          {chat.messages.length === 0 && !busy && (
            <Welcome
              agent={agent}
              name={name}
              teammate={teammate}
              owner={owner?.name}
              onPick={(prompt) => {
                void chat.sendMessage({ text: prompt });
              }}
            />
          )}
          {chat.messages.map((message, i) => (
            <Message
              key={message.id}
              message={message}
              agent={agent}
              me={me?.member}
              conversationId={conversation.id}
              rating={ratings.get(message.id) ?? null}
              rateable={storedIds.has(message.id) && !teammate}
              streaming={
                busy &&
                i === chat.messages.length - 1 &&
                message.role === "assistant"
              }
            />
          ))}
          {chat.status === "submitted" && <Thinking agent={agent} />}
        </div>
      </div>
      <VisuallyHidden>
        <output aria-live="polite">
          {responseStatus(busy, chat.messages.length)}
        </output>
      </VisuallyHidden>
      <Composer
        busy={busy}
        name={name}
        onSend={(value) => {
          void chat.sendMessage(
            { text: value },
            busy ? { body: { interrupt: true } } : undefined
          );
        }}
        onStop={() => {
          void stop();
        }}
      />
    </div>
  );
}

function responseStatus(busy: boolean, messageCount: number) {
  if (busy) {
    return "Assistant is responding";
  }
  return messageCount > 0 ? "Response complete" : "";
}

function Welcome({
  agent,
  name,
  teammate,
  owner,
  onPick,
}: {
  agent?: Schemas["Member"];
  name: string;
  teammate: boolean;
  owner?: string;
  onPick: (prompt: string) => void;
}) {
  const prompts = teammate
    ? [
        `What is ${owner?.split(" ")[0] ?? "they"} working on?`,
        "Is anything blocked?",
        "What shipped recently?",
      ]
    : OWNER_PROMPTS;
  return (
    <div {...stylex.props(styles.welcome)}>
      {agent ? (
        <Avatar person={agent} size={44} />
      ) : (
        <span {...stylex.props(styles.welcomeIcon)}>
          <ChatsCircleIcon size={20} />
        </span>
      )}
      <h2 {...stylex.props(styles.welcomeTitle)}>{name}</h2>
      <p {...stylex.props(styles.welcomeText)}>
        {teammate
          ? `Ask about ${owner ?? "their"} work while they’re away.`
          : "It knows your work, learns from what you tell it, and comes back when you ask it to."}
      </p>
      <div {...stylex.props(styles.prompts)}>
        {prompts.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            {...stylex.props(styles.prompt)}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function Thinking({ agent }: { agent?: Schemas["Member"] }) {
  return (
    <div {...stylex.props(styles.row)}>
      <Avatar
        person={agent ?? { id: "assistant", name: "Assistant", kind: "agent" }}
        size={26}
      />
      <span {...stylex.props(styles.thinking)}>
        <CircleNotchIcon size={13} {...stylex.props(styles.spin)} /> Thinking…
      </span>
    </div>
  );
}

function Message({
  message,
  agent,
  me,
  conversationId,
  rating,
  rateable,
  streaming,
}: {
  message: UIMessage;
  agent?: Schemas["Member"];
  me?: Schemas["Member"];
  conversationId: string;
  rating: string | null;
  rateable: boolean;
  streaming: boolean;
}) {
  const textValue = message.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");
  if (message.role === "user") {
    return (
      <div {...stylex.props(styles.row, styles.rowUser)}>
        <div {...stylex.props(styles.userBubble)}>{textValue}</div>
        {me && <Avatar person={me} size={26} />}
      </div>
    );
  }
  return (
    <div {...stylex.props(styles.row)}>
      <Avatar
        person={agent ?? { id: "assistant", name: "Assistant", kind: "agent" }}
        size={26}
      />
      <div {...stylex.props(styles.reply)} aria-busy={streaming}>
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return part.text ? <Markdown key={i}>{part.text}</Markdown> : null;
          }
          if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
            return <ToolStep key={i} part={part} />;
          }
          return null;
        })}
        {!streaming && textValue && (
          <ReplyActions
            text={textValue}
            messageId={message.id}
            conversationId={conversationId}
            rating={rating}
            rateable={rateable}
          />
        )}
      </div>
    </div>
  );
}

type ToolPart = {
  type: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
};

const TOOL_NAMES: Record<string, [string, string]> = {
  search_activity: ["Searching activity", "Searched activity"],
  search_cards: ["Searching the board", "Searched the board"],
  get_card: ["Reading a card", "Read a card"],
  work_snapshot: ["Checking what they’re on", "Checked what they’re on"],
  team_directory: ["Looking up the team", "Looked up the team"],
  my_attention: ["Checking your inbox", "Checked your inbox"],
  recall: ["Remembering", "Remembered"],
  remember: ["Saving to memory", "Saved to memory"],
  forget: ["Forgetting", "Forgot"],
  follow_up: ["Setting a follow-up", "Set a follow-up"],
  look_into: ["Looking into it", "Looked into it"],
  log_work: ["Logging work", "Logged work"],
  create_card: ["Adding a card", "Added a card"],
  move_card: ["Moving a card", "Moved a card"],
  comment_on_card: ["Commenting", "Commented"],
  answer_attention: ["Answering", "Answered"],
  resolve_attention: ["Clearing an inbox item", "Cleared an inbox item"],
  attention_feedback: ["Noting your feedback", "Noted your feedback"],
  propose_routine: ["Proposing a routine", "Proposed a routine"],
  send_message: ["Sending a message", "Sent a message"],
};

// Memory changes are the ones people most want to check, so they link to the memory page.
const MEMORY_TOOLS = new Set(["remember", "forget"]);

/** Tool calls stay visible but quiet: one line that says what it did, details on demand. */
function ToolStep({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false);
  const name = part.toolName ?? part.type.replace(/^tool-/u, "");
  const done =
    part.state === "output-available" || part.state === "output-error";
  const [doing, did] = TOOL_NAMES[name] ?? [
    `Using ${name.replaceAll("_", " ")}`,
    `Used ${name.replaceAll("_", " ")}`,
  ];
  return (
    <div {...stylex.props(styles.tool)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        {...stylex.props(styles.toolHead)}
      >
        {done ? (
          <CheckIcon size={12} />
        ) : (
          <CircleNotchIcon size={12} {...stylex.props(styles.spin)} />
        )}
        <span>{done ? did : `${doing}…`}</span>
        <CaretRightIcon
          size={12}
          {...stylex.props(styles.chevron, open && styles.chevronOpen)}
        />
      </button>
      {done && MEMORY_TOOLS.has(name) && (
        <Link to="/settings/memory" {...stylex.props(styles.toolLink)}>
          View memory
        </Link>
      )}
      {open && (
        <pre {...stylex.props(styles.toolBody)}>
          {JSON.stringify(
            { input: part.input, output: part.output },
            null,
            2
          ).slice(0, 4000)}
        </pre>
      )}
    </div>
  );
}

function ReplyActions({
  text: value,
  messageId,
  conversationId,
  rating,
  rateable,
}: {
  text: string;
  messageId: string;
  conversationId: string;
  rating: string | null;
  rateable: boolean;
}) {
  const client = useQueryClient();
  const [local, setLocal] = useState(rating);
  const rate = useMutation({
    mutationFn: async (next: "helpful" | "unhelpful") =>
      await unwrap(
        api.PUT("/v1/conversations/{id}/messages/{messageId}/rating", {
          params: { path: { id: conversationId, messageId } },
          body: { rating: next },
        })
      ),
    onMutate: (next) => setLocal(next),
    onSuccess: (_r, next) => {
      void client.invalidateQueries({
        queryKey: ["conversations", conversationId],
      });
      toast(
        next === "helpful"
          ? "Thanks: noted as helpful"
          : "Thanks: this helps it improve"
      );
    },
    onError: (error) => {
      setLocal(rating);
      toast.error(error.message);
    },
  });
  return (
    <div {...stylex.props(styles.actions)}>
      <Tooltip label="Copy">
        <button
          type="button"
          aria-label="Copy reply"
          onClick={() => {
            void navigator.clipboard.writeText(value);
            toast.success("Copied");
          }}
          {...stylex.props(styles.action)}
        >
          <CopyIcon size={13} />
        </button>
      </Tooltip>
      {rateable && (
        <>
          <Tooltip label="Helpful">
            <button
              type="button"
              aria-label="Helpful"
              aria-pressed={local === "helpful"}
              onClick={() => rate.mutate("helpful")}
              {...stylex.props(
                styles.action,
                local === "helpful" && styles.actionOn
              )}
            >
              <ThumbsUpIcon size={13} />
            </button>
          </Tooltip>
          <Tooltip label="Not helpful">
            <button
              type="button"
              aria-label="Not helpful"
              aria-pressed={local === "unhelpful"}
              onClick={() => rate.mutate("unhelpful")}
              {...stylex.props(
                styles.action,
                local === "unhelpful" && styles.actionOn
              )}
            >
              <ThumbsDownIcon size={13} />
            </button>
          </Tooltip>
        </>
      )}
    </div>
  );
}

function Composer({
  busy,
  name,
  onSend,
  onStop,
}: {
  busy: boolean;
  name: string;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const send = () => {
    const trimmed = value.trim();
    if (trimmed) {
      onSend(trimmed);
      setValue("");
    }
  };
  return (
    <div {...stylex.props(styles.composerWrap)}>
      <div {...stylex.props(styles.composer)}>
        <textarea
          ref={ref}
          rows={1}
          aria-label={`Message ${name}`}
          placeholder={
            busy ? "Send to steer the reply…" : `Message ${name.toLowerCase()}…`
          }
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              send();
            }
            if (e.key === "Escape" && busy) {
              e.preventDefault();
              onStop();
            }
          }}
          {...stylex.props(styles.input)}
        />
        {busy && !value.trim() ? (
          <Tooltip label="Stop" shortcut="Esc">
            <button
              type="button"
              aria-label="Stop the reply"
              onClick={onStop}
              {...stylex.props(styles.send, styles.stop)}
            >
              <StopIcon size={12} fill="currentColor" />
            </button>
          </Tooltip>
        ) : (
          <button
            type="button"
            aria-label="Send"
            onClick={send}
            disabled={!value.trim()}
            {...stylex.props(styles.send)}
          >
            <ArrowUpIcon size={16} />
          </button>
        )}
      </div>
      <p {...stylex.props(styles.hint)}>
        <Kbd>↵</Kbd> send · <Kbd>⇧ ↵</Kbd> new line{busy ? " · Esc stops" : ""}{" "}
        · It never edits its own instructions.
      </p>
    </div>
  );
}

const spin = stylex.keyframes({ to: { transform: "rotate(360deg)" } });

const styles = stylex.create({
  chat: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minHeight: 0,
    minWidth: 0,
  },
  banner: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    paddingBlock: space.sm,
    paddingInline: space.x3,
    fontSize: text.meta,
    color: color.violetFg,
    backgroundColor: color.violetSubtle,
  },
  scroll: { flexGrow: 1, minHeight: 0, overflowY: "auto" },
  thread: {
    maxWidth: 760,
    marginInline: "auto",
    paddingInline: space.x3,
    paddingTop: space.x3,
    paddingBottom: space.x4,
    display: "flex",
    flexDirection: "column",
    gap: space.xl,
  },
  row: { display: "flex", alignItems: "flex-start", gap: space.md },
  rowUser: { justifyContent: "flex-end" },
  userBubble: {
    maxWidth: "80%",
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderRadius: 14,
    borderTopRightRadius: 4,
    fontSize: text.copy,
    lineHeight: leading.copy,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    color: color.fg,
    backgroundColor: color.uiActive,
  },
  reply: {
    flexGrow: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    paddingTop: 2,
  },
  thinking: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    height: 26,
    fontSize: text.label,
    color: color.fgMuted,
  },
  spin: {
    animationName: spin,
    animationDuration: "900ms",
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
  },
  tool: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: radius.sm,
    backgroundColor: color.surface,
    boxShadow: `inset 0 0 0 1px ${color.line}`,
    maxWidth: "100%",
  },
  toolLink: {
    marginInlineEnd: space.md,
    fontSize: text.meta,
    fontWeight: 500,
    color: color.accentFg,
    textDecoration: {
      default: "none",
      ":hover": { default: null, [media.hover]: "underline" },
    },
  },
  toolHead: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    height: 26,
    paddingInline: space.md,
    fontSize: text.meta,
    color: color.fgMuted,
  },
  chevron: { transitionProperty: "transform", transitionDuration: motion.fast },
  chevronOpen: { transform: "rotate(90deg)" },
  toolBody: {
    flexBasis: "100%",
    margin: 0,
    paddingInline: space.md,
    paddingBottom: space.md,
    fontSize: 11,
    lineHeight: 1.5,
    color: color.fgMuted,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    maxHeight: 240,
    overflowY: "auto",
  },
  actions: { display: "flex", gap: 2, marginTop: -4, opacity: 0.85 },
  action: {
    display: "grid",
    placeItems: "center",
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    color: {
      default: color.fgFaint,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.ui },
    },
  },
  actionOn: { color: color.accentFg, backgroundColor: color.accentSubtle },
  welcome: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: space.md,
    paddingTop: "12vh",
  },
  welcomeIcon: {
    display: "grid",
    placeItems: "center",
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    color: color.accentFg,
    backgroundColor: color.accentSubtle,
  },
  welcomeTitle: {
    fontSize: text.title,
    lineHeight: leading.title,
    fontWeight: 600,
  },
  welcomeText: {
    maxWidth: 420,
    fontSize: text.label,
    lineHeight: leading.label,
    color: color.fgMuted,
  },
  prompts: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: space.sm,
    marginTop: space.lg,
    width: "100%",
    maxWidth: 560,
  },
  prompt: {
    textAlign: "left",
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderRadius: radius.md,
    fontSize: text.label,
    color: color.fg,
    backgroundColor: {
      default: color.raised,
      ":hover": { default: null, [media.hover]: color.surface },
    },
    boxShadow: shadow.card,
  },
  composerWrap: {
    flexShrink: 0,
    paddingInline: space.x3,
    paddingBottom: space.lg,
    maxWidth: 808,
    width: "100%",
    marginInline: "auto",
  },
  composer: {
    display: "flex",
    alignItems: "flex-end",
    gap: space.md,
    paddingBlock: space.sm,
    paddingInlineStart: space.lg,
    paddingInlineEnd: space.sm,
    borderRadius: 14,
    backgroundColor: color.raised,
    boxShadow: {
      default: shadow.float,
      ":focus-within": `0 0 0 1px ${color.accent}, 0 0 0 4px ${color.accentSubtle}, 0 8px 24px oklch(0 0 0 / 0.08)`,
    },
    transitionProperty: "box-shadow",
    transitionDuration: motion.fast,
  },
  input: {
    flexGrow: 1,
    minHeight: 24,
    maxHeight: 200,
    paddingBlock: 6,
    borderWidth: 0,
    backgroundColor: "transparent",
    resize: "none",
    fontSize: { default: text.copy, "@media (max-width: 640px)": 16 },
    lineHeight: leading.copy,
    outline: "none",
    fieldSizing: "content",
    "::placeholder": { color: color.fgFaint },
  },
  send: {
    display: "grid",
    placeItems: "center",
    width: 32,
    height: 32,
    flexShrink: 0,
    borderRadius: 10,
    color: color.fgOnSolid,
    backgroundColor: {
      default: color.accent,
      ":hover": { default: null, [media.hover]: color.accentHover },
      ":disabled": color.uiActive,
    },
    cursor: { default: "pointer", ":disabled": "default" },
  },
  stop: {
    backgroundColor: {
      default: color.fg,
      ":hover": { default: null, [media.hover]: color.fgMuted },
    },
  },
  hint: {
    display: "flex",
    alignItems: "center",
    gap: space.xs,
    marginTop: space.sm,
    paddingInline: space.sm,
    fontSize: 11.5,
    color: color.fgFaint,
  },
});
