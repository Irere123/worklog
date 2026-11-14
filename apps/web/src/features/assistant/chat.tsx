import { useChat } from "@ai-sdk/react";
import {
  ArrowDownIcon,
  ArrowsClockwiseIcon,
  CheckIcon,
  CopyIcon,
  LockSimpleIcon,
  PlusSquareIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import type { RefObject } from "react";
import {
  Fragment,
  memo,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import type { Schemas } from "#api/client";
import { api, authHeaders, unwrap } from "#api/client";
import { q } from "#api/queries";
import { useMembers } from "#features/cards/card-bits";
import type { Member } from "#features/cards/card-bits";
import { NewCardDialog } from "#features/cards/new-card";
import { showDesktopAlert } from "#lib/desktop-alerts";
import { clip } from "#lib/text";
import { clockTime, dayKey, dayLabel, exactTime } from "#lib/time";
import { Button } from "#ui/button";
import { VisuallyHidden, useDelayed } from "#ui/feedback";
import { Ghost } from "#ui/ghost";
import type { Mood } from "#ui/ghost";
import { StreamingMarkdown } from "#ui/markdown";
import { Popover, Tooltip } from "#ui/overlay";
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

import { Composer, ComposerHint, TeamVisibleOnly } from "./composer";
import { hasUnseenReply } from "./presence";
import { WorkLog, liveSteps, storedSteps } from "./steps";
import type { Step } from "./steps";
import { useSuggestions } from "./suggestions";

type Conversation = Schemas["Conversation"];
type Stored = Schemas["Message"];
type Meta = { steps?: Step[]; createdAt?: string };
type ChatMessage = UIMessage<Meta>;

// The thread follows a reply as it grows while you're within this distance of the bottom.
const FOLLOW_PX = 120;

function toUi(messages: Stored[]): ChatMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    parts: [{ type: "text", text: m.text }],
    metadata: { steps: storedSteps(m.steps), createdAt: m.createdAt },
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
  const { byId } = useMembers();
  const agent = byId.get(conversation.agentId);
  const owner = agent?.ownerId ? byId.get(agent.ownerId) : undefined;
  const teammate = conversation.mode === "teammate";
  const ratings = useMemo(
    () => new Map(stored.map((m) => [m.id, m.rating])),
    [stored]
  );
  const storedIds = useMemo(() => new Set(stored.map((m) => m.id)), [stored]);

  const transport = useTransport(conversation.id);
  const initial = useMemo(() => toUi(stored), [stored]);

  // The reply that just came in whole, for the moment its ghost looks pleased. Set by the finish
  // itself, so a stopped, failed or interrupted reply never looks done.
  const [landed, setLanded] = useState<string | null>(null);
  useEffect(() => {
    const timer =
      landed === null
        ? undefined
        : setTimeout(() => setLanded(null), LANDED_MS);
    return () => clearTimeout(timer);
  }, [landed]);

  const chat = useChat<ChatMessage>({
    id: conversation.id,
    messages: initial,
    transport,
    throttle: 40,
    onFinish: ({ message, isAbort, isDisconnect, isError }) => {
      if (!isAbort && !isDisconnect && !isError) {
        setLanded(message.id);
      }
      void client.invalidateQueries({ queryKey: ["conversations"] });
      // A long answer finished while the person looked elsewhere: tell them, if they asked for
      // desktop alerts (the helper stays quiet when the tab is in view or alerts are off).
      showDesktopAlert({
        title: "Your assistant answered",
        body: clip(textOf(message).replaceAll(/[*_`#>]/gu, ""), 120),
        tag: `reply-${conversation.id}`,
        // Clicking it focuses this tab, which is already on the conversation.
        onOpen: ignore,
      });
    },
  });
  const busy = chat.status === "submitted" || chat.status === "streaming";

  const progress = replyProgress(chat.messages);
  const timer = useTurnTimer(busy && progress.answering, progress.lastIndex);
  const { scrollRef, away, follow, handleScroll, handleJump } =
    useStickToBottom(`${progress.size}:${chat.status}`);

  const send = (value: string) => {
    timer.start();
    void chat.sendMessage(
      { text: value },
      busy ? { body: { interrupt: true } } : undefined
    );
    follow();
  };

  useAdoptStored(chat, stored, busy);
  useFirstMessage(firstMessage, stored.length > 0, send);
  useMarkSeen(conversation);

  const stop = async () => {
    await chat.stop();
    await api.POST("/v1/conversations/{id}/stop", {
      params: { path: { id: conversation.id } },
    });
    void client.invalidateQueries({
      queryKey: ["conversations", conversation.id],
    });
  };

  const { name, agentName } = namesFor(teammate, agent, owner);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  useHotkey("/", () => composerRef.current?.focus(), {
    meta: { name: "Write to the assistant", group: "Assistant" },
  });
  const failed = chat.status === "error";
  const waiting =
    chat.status === "submitted" && progress.last?.role !== "assistant";

  return (
    <div {...stylex.props(styles.chat)}>
      {teammate && <TeammateBanner owner={owner?.name} />}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        {...stylex.props(styles.scroll)}
      >
        <div
          {...stylex.props(styles.thread)}
          role="log"
          aria-label="Conversation"
        >
          {chat.messages.length === 0 && !busy && (
            <Welcome
              agent={agent}
              teammate={teammate}
              owner={owner?.name}
              onPick={send}
            />
          )}
          <Messages
            messages={chat.messages}
            agentName={agentName}
            people={byId}
            conversationId={conversation.id}
            ratings={ratings}
            rateable={(id) => storedIds.has(id) && !teammate}
            busy={busy}
            landed={landed}
            took={timer.took}
            askAgain={send}
          />
          {waiting && <Waiting name={agentName} />}
          {failed && (
            <Failed
              message={chat.error?.message}
              onRetry={() => {
                timer.start();
                void chat.regenerate();
              }}
            />
          )}
        </div>
      </div>
      <VisuallyHidden>
        <output aria-live="polite">
          {responseStatus(busy, chat.messages.length)}
        </output>
      </VisuallyHidden>
      <Dock
        busy={busy}
        teammate={teammate}
        name={name}
        away={away}
        onJump={handleJump}
        onSend={send}
        onStop={() => {
          void stop();
        }}
        inputRef={composerRef}
        recall={() =>
          chat.messages
            .filter((m) => m.role === "user")
            .map(textOf)
            .findLast((said) => !DELIVERY.test(said))
        }
        onStartTyping={() => {
          // The provider caches the prompt's start while the question is typed, so the answer
          // starts sooner. The server ignores repeats within a few minutes.
          if (!busy) {
            void api
              .POST("/v1/conversations/{id}/warm", {
                params: { path: { id: conversation.id } },
              })
              .catch(() => null);
          }
        }}
      />
    </div>
  );
}

/** How the composer addresses the assistant, and the name over its replies. */
function namesFor(teammate: boolean, agent?: Member, owner?: Member) {
  if (!teammate) {
    return { name: "your assistant", agentName: "Your assistant" };
  }
  const name = `${owner?.name ?? "Their"}'s assistant`;
  return { name, agentName: agent?.name ?? name };
}

/** Where the newest message stands: whether it's answering, and a size that grows with it. */
function replyProgress(messages: ChatMessage[]) {
  const last = messages.at(-1);
  const length =
    last?.parts.reduce((n, p) => n + ("text" in p ? p.text.length : 1), 0) ?? 0;
  return {
    last,
    lastIndex: messages.length - 1,
    answering:
      last?.role === "assistant" &&
      last.parts.some((p) => p.type === "text" && p.text.length > 0),
    size: `${messages.length}:${length}`,
  };
}

/**
 * After a reply settles, the stored transcript replaces the streamed copy, so message ids match
 * the server's and replies can be rated.
 */
/**
 * An answer counts as seen once it's on screen in a tab someone is looking at, so the assistant
 * stops showing it as news. A tab in the background waits until it's looked at again.
 */
function useMarkSeen(conversation: Conversation) {
  const client = useQueryClient();
  const { id } = conversation;
  const unseen = hasUnseenReply(conversation);
  const mark = useEffectEvent((conversationId: string) => {
    if (document.visibilityState !== "visible") {
      return;
    }
    const now = new Date().toISOString();
    const stamp = <T extends { id: string; seenAt: string | null }>(c: T) =>
      c.id === conversationId ? { ...c, seenAt: now } : c;
    client.setQueryData(q.conversations().queryKey, (list) => list?.map(stamp));
    client.setQueryData(
      q.conversation(conversationId).queryKey,
      (c) => c && stamp(c)
    );
    void api.POST("/v1/conversations/{id}/seen", {
      params: { path: { id: conversationId } },
    });
  });
  useEffect(() => {
    const onVisible = () => {
      if (unseen) {
        mark(id);
      }
    };
    onVisible();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [id, unseen]);
}

function useAdoptStored(
  chat: { messages: ChatMessage[]; setMessages: (m: ChatMessage[]) => void },
  stored: Stored[],
  busy: boolean
) {
  const adopt = useEffectEvent((transcript: Stored[], responding: boolean) => {
    if (
      !responding &&
      transcript.length > 0 &&
      transcript.length >= chat.messages.length
    ) {
      chat.setMessages(toUi(transcript));
    }
  });
  useEffect(() => {
    adopt(stored, busy);
  }, [stored, busy]);
}

/**
 * A question asked from Home or ⌘K arrives with the new conversation. It's sent from a
 * cancellable timer: a dev double-mount tears down the first chat instance, and a message sent
 * straight from the effect would die with it.
 */
function useFirstMessage(
  message: string | undefined,
  hasHistory: boolean,
  send: (text: string) => void
) {
  const sent = useRef(false);
  const already = useEffectEvent(() => hasHistory);
  const sendFirst = useEffectEvent((question: string) => {
    sent.current = true;
    send(question);
  });
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    if (message && !sent.current && !already()) {
      pending = setTimeout(() => sendFirst(message), 0);
    }
    return () => clearTimeout(pending);
  }, [message]);
}

function useTransport(id: string) {
  return useMemo(
    () =>
      new DefaultChatTransport<ChatMessage>({
        api: `/v1/conversations/${id}/chat`,
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
    [id]
  );
}

/**
 * How long each turn worked before it answered, by its position in the thread: a reply keeps
 * its place when the stored transcript replaces the streamed copy, but not its id.
 */
function useTurnTimer(answering: boolean, index: number) {
  const startedAt = useRef<number | null>(null);
  const [took, setTook] = useState<ReadonlyMap<number, number>>(new Map());
  const note = useEffectEvent((at: number) => {
    if (startedAt.current !== null && !took.has(at)) {
      setTook(new Map(took).set(at, (Date.now() - startedAt.current) / 1000));
    }
  });
  useEffect(() => {
    if (answering) {
      note(index);
    }
  }, [answering, index]);
  return {
    took,
    start: () => {
      startedAt.current = Date.now();
    },
  };
}

/**
 * Follows a reply as it grows while the reader is at the bottom; once they scroll up to read,
 * the thread stays put and offers a way back down.
 */
function useStickToBottom(contentSize: string) {
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const followed = useRef("");
  const [away, setAway] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el && following.current && followed.current !== contentSize) {
      followed.current = contentSize;
      el.scrollTop = el.scrollHeight;
    }
  });
  // The route keys this view by conversation, so mounting means a conversation was opened.
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, []);
  return {
    scrollRef: ref,
    away,
    follow: () => {
      following.current = true;
    },
    handleScroll: () => {
      const el = ref.current;
      if (el) {
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        following.current = distance < FOLLOW_PX;
        setAway(distance > FOLLOW_PX * 2);
      }
    },
    handleJump: () => {
      following.current = true;
      ref.current?.scrollTo({
        top: ref.current.scrollHeight,
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    },
  };
}

// The pending thread's controls answer nothing until the conversation exists.
function ignore() {
  // Nothing to do yet.
}

/**
 * A question on its way, drawn as the conversation will be, while the server opens it: the
 * thread, the assistant's line and the composer are all where they'll be when it arrives.
 */
export function PendingThread({ question }: { question: string }) {
  return (
    <div {...stylex.props(styles.chat)}>
      <div {...stylex.props(styles.scroll)}>
        <div {...stylex.props(styles.thread)}>
          <div {...stylex.props(styles.user)}>
            <div {...stylex.props(styles.userBubble)}>{question}</div>
          </div>
          <Waiting name="Your assistant" />
        </div>
      </div>
      <Dock
        busy
        teammate={false}
        name="your assistant"
        away={false}
        onJump={ignore}
        onSend={ignore}
        onStop={ignore}
        onStartTyping={ignore}
        inputRef={{ current: null }}
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

function Messages({
  messages,
  agentName,
  people,
  conversationId,
  ratings,
  rateable,
  busy,
  landed,
  took,
  askAgain,
}: {
  messages: ChatMessage[];
  agentName: string;
  people: Map<string, Member>;
  conversationId: string;
  ratings: Map<string, string | null>;
  rateable: (id: string) => boolean;
  busy: boolean;
  landed: string | null;
  took: ReadonlyMap<number, number>;
  askAgain: (question: string) => void;
}) {
  const lastIndex = messages.length - 1;
  // A thread kept for days (briefs arrive in one) marks where each day starts.
  let shownDay = messages[0]?.metadata?.createdAt
    ? dayKey(messages[0].metadata.createdAt)
    : null;
  return messages.map((message, i) => {
    const at = message.metadata?.createdAt;
    const day = at === undefined ? null : dayKey(at);
    const divider = at !== undefined && day !== shownDay ? dayLabel(at) : null;
    if (day !== null) {
      shownDay = day;
    }
    // A reply stopped before it answered, or the latest one, offers its question again. The
    // history is append-only, so asking again is a new turn, not a replaced answer.
    const previous = messages[i - 1];
    const question =
      message.role === "assistant" &&
      previous?.role === "user" &&
      !DELIVERY.test(textOf(previous))
        ? textOf(previous)
        : null;
    const retry =
      !busy &&
      question !== null &&
      (textOf(message) === STOPPED || i === lastIndex)
        ? () => askAgain(question)
        : undefined;
    const item =
      message.role === "user" ? (
        <SentMessage key={message.id} message={message} />
      ) : (
        <AssistantReply
          key={message.id}
          message={message}
          name={agentName}
          people={people}
          conversationId={conversationId}
          rating={ratings.get(message.id) ?? null}
          rateable={rateable(message.id)}
          streaming={busy && i === lastIndex}
          latest={i === lastIndex}
          landed={landed === message.id}
          seconds={took.get(i)}
          onAskAgain={retry}
        />
      );
    return divider === null ? (
      item
    ) : (
      <Fragment key={message.id}>
        <p {...stylex.props(styles.delivery)}>
          <span>{divider}</span>
        </p>
        {item}
      </Fragment>
    );
  });
}

function TeammateBanner({ owner }: { owner?: string }) {
  return (
    <p {...stylex.props(styles.banner)}>
      <LockSimpleIcon size={13} />
      <span>
        You’re asking {owner ?? "a teammate"}’s assistant. It answers from their
        team-visible work only, and they can read this conversation.
      </span>
    </p>
  );
}

function Dock({
  busy,
  teammate,
  name,
  away,
  onJump,
  onSend,
  onStop,
  onStartTyping,
  inputRef,
  recall,
}: {
  busy: boolean;
  teammate: boolean;
  name: string;
  away: boolean;
  onJump: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onStartTyping: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  recall?: () => string | undefined;
}) {
  return (
    <div {...stylex.props(styles.dock)}>
      {away && (
        <button
          type="button"
          aria-label="Scroll to the latest message"
          onClick={onJump}
          {...stylex.props(styles.down)}
        >
          <ArrowDownIcon size={14} />
        </button>
      )}
      <Composer
        busy={busy}
        label={`Message ${name}`}
        placeholder={
          teammate ? `Ask ${name}…` : "Ask anything about your team’s work…"
        }
        context={
          teammate ? (
            <TeamVisibleOnly />
          ) : (
            <span>Sees your work and your team’s</span>
          )
        }
        onSend={onSend}
        onStop={onStop}
        onStartTyping={onStartTyping}
        inputRef={inputRef}
        recall={recall}
      />
      <ComposerHint busy={busy} />
    </div>
  );
}

function Failed({
  message,
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <div {...stylex.props(styles.failed)} role="alert">
      <Ghost mood="error" size={20} />
      <span>
        {message && message.length < 160
          ? message
          : "That reply didn’t finish."}{" "}
        Check your connection, then try again.
      </span>
      <button type="button" onClick={onRetry} {...stylex.props(styles.retry)}>
        <ArrowsClockwiseIcon size={13} /> Try again
      </button>
    </div>
  );
}

function Welcome({
  agent,
  teammate,
  owner,
  onPick,
}: {
  agent?: Member;
  teammate: boolean;
  owner?: string;
  onPick: (prompt: string) => void;
}) {
  const first = owner?.split(" ")[0];
  const suggestions = useSuggestions();
  const prompts = teammate
    ? [
        `What is ${first ?? "they"} working on?`,
        "Is anything blocked?",
        "What shipped recently?",
      ].map((question) => ({ label: question, ask: question }))
    : suggestions;
  return (
    <div {...stylex.props(styles.welcome)}>
      {agent && <Ghost size={48} />}
      <h2 {...stylex.props(styles.welcomeTitle)}>
        {teammate
          ? `${first ?? "Their"}’s assistant`
          : "What would you like to know?"}
      </h2>
      <p {...stylex.props(styles.welcomeText)}>
        {teammate
          ? `It answers from ${first ?? "their"}’s team-visible work while they’re away, and ${first ?? "they"} can read this conversation.`
          : "It reads the team’s activity and your board, remembers what you tell it, and follows up when you ask."}
      </p>
      <ul {...stylex.props(styles.prompts)}>
        {prompts.map((p) => (
          <li key={p.label}>
            <button
              type="button"
              onClick={() => onPick(p.ask)}
              {...stylex.props(styles.prompt)}
            >
              {p.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Waiting({ name }: { name: string }) {
  // Shown only if nothing has arrived after a moment, so a quick reply never flashes it.
  const shown = useDelayed(300);
  return (
    <div {...stylex.props(styles.reply)}>
      <AgentLine name={name} mood="thinking" />
      {shown && <span {...stylex.props(styles.waiting)}>Thinking…</span>}
    </div>
  );
}

/** Who is answering and when, as a log line reads: the agent's face, its name, the time. */
function AgentLine({
  name,
  at,
  mood,
}: {
  name: string;
  at?: string;
  /** Only the reply that's live moves; an earlier one holds still. */
  mood?: Mood;
}) {
  return (
    <div {...stylex.props(styles.agentLine)}>
      <Ghost mood={mood ?? "idle"} still={mood === undefined} size={20} />
      <span {...stylex.props(styles.agentName)}>{name}</span>
      {at && (
        <time
          dateTime={at}
          title={exactTime(at)}
          {...stylex.props(styles.stamp)}
        >
          {clockTime(at)}
        </time>
      )}
    </div>
  );
}

// What the server stores for a reply stopped before it wrote anything (agent/loop.ts).
const STOPPED = "Stopped before finishing.";

// Briefs and pings the assistant posts on its own are stored after a marker in the person's turn,
// so the next question has them as context. The marker isn't something they said.
const DELIVERY = /^\[Worklog automation: (?<label>.+)\]$/u;

// A streamed chunk replaces only the newest message; the ones above keep their identity, so
// memoizing them keeps a long conversation from re-rendering every turn on every chunk.
const SentMessage = memo(UserMessage);
const AssistantReply = memo(Reply);

function UserMessage({ message }: { message: ChatMessage }) {
  const value = textOf(message);
  const delivery = DELIVERY.exec(value)?.groups?.label;
  if (delivery) {
    const at = message.metadata?.createdAt;
    return (
      <p {...stylex.props(styles.delivery)}>
        <span>{delivery}</span>
        {at && (
          <time dateTime={at} title={exactTime(at)}>
            · {clockTime(at)}
          </time>
        )}
      </p>
    );
  }
  // Only what arrives while the conversation is open moves in; a stored thread just appears.
  const arriving = message.metadata?.createdAt === undefined;
  return (
    <div {...stylex.props(styles.user, arriving && styles.arriving)}>
      <div {...stylex.props(styles.userBubble)}>{value}</div>
    </div>
  );
}

function textOf(message: ChatMessage) {
  return message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}

function Reply({
  message,
  name,
  people,
  conversationId,
  rating,
  rateable,
  streaming,
  latest,
  landed,
  seconds,
  onAskAgain,
}: {
  message: ChatMessage;
  name: string;
  people: Map<string, Member>;
  conversationId: string;
  rating: string | null;
  rateable: boolean;
  streaming: boolean;
  latest: boolean;
  landed: boolean;
  seconds?: number;
  onAskAgain?: () => void;
}) {
  const value = textOf(message);
  const live = liveSteps(message.parts);
  const steps = live.length > 0 ? live : (message.metadata?.steps ?? []);
  return (
    <div
      {...stylex.props(
        styles.reply,
        message.metadata?.createdAt === undefined && styles.arriving
      )}
      aria-busy={streaming}
    >
      <AgentLine
        name={name}
        at={message.metadata?.createdAt}
        mood={replyMood(streaming, latest, value, landed)}
      />
      <div {...stylex.props(styles.replyBody)}>
        <WorkLog
          steps={steps}
          working={streaming}
          answering={value.length > 0}
          seconds={seconds}
          people={people}
        />
        {value === STOPPED && (
          <p {...stylex.props(styles.stopped)}>
            Stopped before it answered.
            {onAskAgain && (
              <button
                type="button"
                onClick={onAskAgain}
                {...stylex.props(styles.askAgain)}
              >
                <ArrowsClockwiseIcon size={13} /> Ask again
              </button>
            )}
          </p>
        )}
        {value && value !== STOPPED ? (
          <StreamingMarkdown streaming={streaming}>{value}</StreamingMarkdown>
        ) : (
          streaming &&
          steps.length === 0 && (
            <span {...stylex.props(styles.waiting)}>Thinking…</span>
          )
        )}
        {!streaming && value && value !== STOPPED && (
          <ReplyActions
            text={value}
            messageId={message.id}
            conversationId={conversationId}
            rating={rating}
            rateable={rateable}
            pinned={latest}
            onAskAgain={onAskAgain}
          />
        )}
      </div>
    </div>
  );
}

const OFF = ["Wrong", "Out of date", "Missed something", "Too long"];

/** Why a reply didn't help, in a tap or a sentence; the rating itself is already saved. */
function WhatWasOff({ onSend }: { onSend: (note: string) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [more, setMore] = useState("");
  const note = [...picked, more.trim()].filter(Boolean).join(". ");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (note) {
          onSend(note);
        }
      }}
      {...stylex.props(styles.off)}
    >
      <div {...stylex.props(styles.offChips)}>
        {OFF.map((reason) => {
          const on = picked.includes(reason);
          return (
            <button
              key={reason}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setPicked(
                  on ? picked.filter((r) => r !== reason) : [...picked, reason]
                )
              }
              {...stylex.props(styles.offChip, on && styles.offChipOn)}
            >
              {reason}
            </button>
          );
        })}
      </div>
      <textarea
        rows={2}
        aria-label="Anything else"
        placeholder="Anything else? (optional)"
        value={more}
        onChange={(event) => setMore(event.target.value)}
        {...stylex.props(styles.offText)}
      />
      <Button type="submit" size="sm" variant="primary" disabled={!note}>
        Send
      </Button>
    </form>
  );
}

/**
 * A card drafted from a reply: its first sentence as the title, in plain words, and the whole
 * reply as the description, so nothing it said is lost. The person edits it before adding.
 */
function cardFrom(reply: string) {
  const plain = reply
    .replaceAll(/[*_`>#]+/gu, "")
    .replaceAll(/\[(?<label>[^\]]+)\]\([^)]+\)/gu, "$<label>")
    .trim();
  const [first = plain] = plain.split(/(?<=[.!?])\s|\n/u);
  // Card titles read as names, not sentences, so the closing full stop goes.
  return { title: clip(first.replace(/\.$/u, ""), 90), body: reply };
}

function ReplyActions({
  text: value,
  messageId,
  conversationId,
  rating,
  rateable,
  pinned,
  onAskAgain,
}: {
  text: string;
  messageId: string;
  conversationId: string;
  rating: string | null;
  rateable: boolean;
  /** The latest reply keeps its actions in view; older ones show them on hover. */
  pinned: boolean;
  onAskAgain?: () => void;
}) {
  const client = useQueryClient();
  const [local, setLocal] = useState(rating);
  const [copied, setCopied] = useState(false);
  const [carding, setCarding] = useState(false);
  useEffect(() => {
    const timer = copied ? setTimeout(() => setCopied(false), 1600) : undefined;
    return () => clearTimeout(timer);
  }, [copied]);
  const [asking, setAsking] = useState(false);
  const rate = useMutation({
    mutationFn: async ({
      rating: next,
      note,
    }: {
      rating: "helpful" | "unhelpful";
      note?: string;
    }) =>
      await unwrap(
        api.PUT("/v1/conversations/{id}/messages/{messageId}/rating", {
          params: { path: { id: conversationId, messageId } },
          body: { rating: next, note },
        })
      ),
    onMutate: ({ rating: next }) => setLocal(next),
    onSuccess: (_r, { note }) => {
      void client.invalidateQueries({
        queryKey: ["conversations", conversationId],
      });
      if (note) {
        toast("Thanks. Your assistant learns from this.");
      }
    },
    onError: (error) => {
      setLocal(rating);
      toast.error(error.message);
    },
  });
  return (
    <div {...stylex.props(styles.actions, pinned && styles.actionsPinned)}>
      <Tooltip label={copied ? "Copied" : "Copy"}>
        <button
          type="button"
          aria-label="Copy reply"
          onClick={() => {
            void navigator.clipboard
              .writeText(value)
              .then(() => setCopied(true));
          }}
          {...stylex.props(styles.action)}
        >
          {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
        </button>
      </Tooltip>
      {onAskAgain && (
        <Tooltip label="Ask again">
          <button
            type="button"
            aria-label="Ask the same question again"
            onClick={onAskAgain}
            {...stylex.props(styles.action)}
          >
            <ArrowsClockwiseIcon size={14} />
          </button>
        </Tooltip>
      )}
      <Tooltip label="Make a card from this">
        <button
          type="button"
          aria-label="Make a card from this reply"
          onClick={() => setCarding(true)}
          {...stylex.props(styles.action)}
        >
          <PlusSquareIcon size={14} />
        </button>
      </Tooltip>
      {carding && (
        <NewCardDialog
          open
          onClose={() => setCarding(false)}
          initial={cardFrom(value)}
        />
      )}
      {rateable && (
        <>
          <Tooltip label="Helpful">
            <button
              type="button"
              aria-label="Helpful"
              aria-pressed={local === "helpful"}
              onClick={() => rate.mutate({ rating: "helpful" })}
              {...stylex.props(
                styles.action,
                local === "helpful" && styles.actionOn
              )}
            >
              <ThumbsUpIcon
                size={14}
                weight={local === "helpful" ? "fill" : "regular"}
              />
            </button>
          </Tooltip>
          <Popover
            open={asking}
            onOpenChange={setAsking}
            side="top"
            width={300}
            title="What was off?"
            description="Your assistant reads this when it learns."
            trigger={
              <button
                type="button"
                aria-label="Not helpful"
                aria-pressed={local === "unhelpful"}
                onClick={() => {
                  if (local !== "unhelpful") {
                    rate.mutate({ rating: "unhelpful" });
                  }
                }}
                {...stylex.props(
                  styles.action,
                  local === "unhelpful" && styles.actionOn
                )}
              >
                <ThumbsDownIcon
                  size={14}
                  weight={local === "unhelpful" ? "fill" : "regular"}
                />
              </button>
            }
          >
            <WhatWasOff
              onSend={(note) => {
                rate.mutate({ rating: "unhelpful", note });
                setAsking(false);
              }}
            />
          </Popover>
        </>
      )}
    </div>
  );
}

const pulse = stylex.keyframes({
  "0%, 100%": { opacity: 1 },
  "50%": { opacity: 0.4 },
});
const rise = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(4px)" },
  to: { opacity: 1, transform: "none" },
});

const COLUMN = 720;

/**
 * The live reply's ghost: thinking until its words start, writing while they come, pleased for a
 * moment once they're done. Earlier replies get no mood and hold still.
 */
function replyMood(
  streaming: boolean,
  latest: boolean,
  said: string,
  landed: boolean
): Mood | undefined {
  if (streaming) {
    return said ? "writing" : "thinking";
  }
  if (landed) {
    return "done";
  }
  return latest ? "idle" : undefined;
}

// Long enough to see the answer land, short enough that it's not still celebrating as you read.
const LANDED_MS = 2400;

const styles = stylex.create({
  chat: {
    position: "relative",
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
    margin: 0,
    paddingBlock: space.sm,
    paddingInline: space.x3,
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.violetFg,
    backgroundColor: color.violetSubtle,
  },
  scroll: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
    scrollbarGutter: "stable",
  },
  thread: {
    maxWidth: COLUMN,
    marginInline: "auto",
    paddingInline: { default: space.x3, "@media (max-width: 640px)": space.xl },
    paddingTop: space.x3,
    paddingBottom: space.x4,
    display: "flex",
    flexDirection: "column",
    gap: space.x3,
  },
  arriving: {
    animationName: rise,
    animationDuration: motion.base,
    animationTimingFunction: motion.out,
    "@media (prefers-reduced-motion: reduce)": { animationName: "none" },
  },
  user: {
    alignSelf: "flex-end",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: space.xs,
    maxWidth: "min(85%, 560px)",
  },
  userBubble: {
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderRadius: 16,
    fontSize: text.copy,
    lineHeight: leading.copy,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    color: color.fg,
    backgroundColor: color.ui,
  },
  askAgain: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    marginInlineStart: space.md,
    padding: 0,
    borderWidth: 0,
    fontSize: text.label,
    color: {
      default: color.accentFg,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    backgroundColor: "transparent",
    cursor: "pointer",
  },
  stopped: {
    margin: 0,
    fontSize: text.label,
    lineHeight: leading.label,
    color: color.fgMuted,
  },
  delivery: {
    display: "flex",
    alignItems: "center",
    gap: space.xs,
    margin: 0,
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgFaint,
    "::before": {
      content: "''",
      flexGrow: 1,
      height: 1,
      marginInlineEnd: space.sm,
      backgroundColor: color.line,
    },
    "::after": {
      content: "''",
      flexGrow: 1,
      height: 1,
      marginInlineStart: space.sm,
      backgroundColor: color.line,
    },
  },
  reply: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    minWidth: 0,
  },
  agentLine: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    height: 20,
  },
  agentName: {
    fontSize: text.label,
    lineHeight: leading.label,
    fontWeight: 500,
    color: color.fg,
  },
  replyBody: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    minWidth: 0,
  },
  waiting: {
    alignSelf: "flex-start",
    fontSize: text.label,
    lineHeight: "24px",
    color: color.fgMuted,
    animationName: pulse,
    animationDuration: "1.6s",
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-in-out",
    "@media (prefers-reduced-motion: reduce)": { animationName: "none" },
  },
  failed: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: space.md,
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderRadius: radius.md,
    fontSize: text.label,
    lineHeight: leading.label,
    color: color.redFg,
    backgroundColor: color.redSubtle,
  },
  retry: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    height: 28,
    paddingInline: space.md,
    borderRadius: radius.sm,
    borderWidth: 0,
    fontSize: text.label,
    fontWeight: 500,
    color: color.fg,
    backgroundColor: {
      default: color.raised,
      ":hover": { default: null, [media.hover]: color.uiHover },
    },
    boxShadow: shadow.card,
    cursor: "pointer",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: space.xxs,
    marginTop: -2,
    marginInlineStart: -6,
    opacity: {
      default: 0,
      ":is(div:hover > div > *)": 1,
      ":focus-within": 1,
      "@media (hover: none)": 1,
    },
    transitionProperty: "opacity",
    transitionDuration: motion.fast,
  },
  actionsPinned: { opacity: 1 },
  action: {
    display: "grid",
    placeItems: "center",
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    borderWidth: 0,
    color: {
      default: color.fgFaint,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.ui },
    },
    cursor: "pointer",
    transform: { default: null, ":active": "scale(0.95)" },
    transitionProperty: "transform",
    transitionDuration: motion.fast,
  },
  actionOn: { color: color.fg },
  off: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.md,
  },
  offChips: { display: "flex", flexWrap: "wrap", gap: space.xs },
  offChip: {
    height: 26,
    paddingInline: space.md,
    borderRadius: radius.full,
    borderWidth: 0,
    fontSize: text.meta,
    color: color.fgMuted,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.ui },
    },
    boxShadow: `inset 0 0 0 1px ${color.lineUi}`,
    cursor: "pointer",
  },
  offChipOn: {
    color: color.fg,
    backgroundColor: color.uiActive,
    boxShadow: `inset 0 0 0 1px ${color.lineStrong}`,
  },
  offText: {
    alignSelf: "stretch",
    minHeight: 52,
    padding: space.sm,
    borderRadius: radius.sm,
    borderWidth: 0,
    boxShadow: `inset 0 0 0 1px ${color.lineUi}`,
    resize: "none",
    fontFamily: "inherit",
    fontSize: { default: text.label, "@media (max-width: 640px)": "16px" },
    lineHeight: leading.label,
    color: color.fg,
    backgroundColor: color.bg,
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
  },
  stamp: {
    fontSize: text.meta,
    color: color.fgFaint,
    fontVariantNumeric: "tabular-nums",
  },
  welcome: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.md,
    paddingTop: { default: "12vh", "@media (max-width: 640px)": space.x3 },
  },
  welcomeTitle: {
    margin: 0,
    marginTop: space.sm,
    fontSize: text.titleLg,
    lineHeight: leading.titleLg,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    textWrap: "balance",
  },
  welcomeText: {
    margin: 0,
    maxWidth: 520,
    fontSize: text.copy,
    lineHeight: leading.copy,
    color: color.fgMuted,
    textWrap: "pretty",
  },
  prompts: {
    display: "flex",
    flexDirection: "column",
    alignSelf: "stretch",
    margin: 0,
    marginTop: space.lg,
    padding: 0,
    listStyle: "none",
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: color.line,
  },
  prompt: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    minHeight: 40,
    paddingInline: space.xs,
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
    fontSize: text.copy,
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    backgroundColor: "transparent",
    textAlign: "start",
    cursor: "pointer",
  },
  dock: {
    position: "relative",
    width: "100%",
    maxWidth: COLUMN,
    marginInline: "auto",
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    paddingInline: { default: space.x3, "@media (max-width: 640px)": space.md },
    paddingBottom: {
      default: space.md,
      "@media (max-width: 640px)": "max(8px, env(safe-area-inset-bottom))",
    },
  },
  down: {
    position: "absolute",
    top: -44,
    left: "50%",
    display: "grid",
    placeItems: "center",
    width: 32,
    height: 32,
    marginInlineStart: -16,
    borderRadius: radius.full,
    borderWidth: 0,
    color: color.fgMuted,
    backgroundColor: color.raised,
    boxShadow: shadow.float,
    cursor: "pointer",
    animationName: rise,
    animationDuration: motion.base,
    animationTimingFunction: motion.out,
  },
});
