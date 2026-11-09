import {
  BrainIcon,
  CaretLeftIcon,
  CopyIcon,
  DotsThreeIcon,
  TrashIcon,
  PencilSimpleIcon,
  MagnifyingGlassIcon,
  ChatsCircleIcon,
  PlusIcon,
  ScrollIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";

import { ApiError, api, unwrap } from "#api/client";
import { q } from "#api/queries";
import { useMe } from "#features/auth/session";
import { useMembers } from "#features/cards/card-bits";
import type { Member } from "#features/cards/card-bits";
import { ago, recencyLabel } from "#lib/time";
import { Avatar } from "#ui/avatar";
import { Button } from "#ui/button";
import { Dot } from "#ui/chip";
import { EmptyState, ErrorNote, Skeleton, VisuallyHidden } from "#ui/feedback";
import { Input } from "#ui/field";
import { PageHeader } from "#ui/layout";
import { Menu, MenuItem, Tooltip } from "#ui/overlay";
import { color, leading, media, radius, space, text } from "#ui/tokens.stylex";

import { Chat, PendingThread } from "./chat";
import { Composer } from "./composer";
import { AssistantFace, hasUnseenReply, usePresence } from "./presence";
import type { Glance } from "./presence";
import { useSuggestions } from "./suggestions";

// Past this many, the list gets a filter: scrolling stops being the quick way to find one.
const FILTER_FROM = 8;

export function Conversations({ children }: { children: ReactNode }) {
  const list = useQuery({ ...q.conversations(), select: notBeingDeleted });
  const { byId } = useMembers();
  const { agent: mine, presence } = usePresence();
  const busy = new Set(
    presence?.working.flatMap((w) =>
      w.kind === "reply" ? [w.conversationId] : []
    )
  );
  const [filter, setFilter] = useState("");
  const term = filter.trim().toLowerCase();
  const shown = (list.data ?? []).filter(
    (c) => !term || (c.title ?? "new conversation").toLowerCase().includes(term)
  );
  return (
    <div {...stylex.props(styles.layout)}>
      <aside {...stylex.props(styles.side)}>
        <div {...stylex.props(styles.sideHead)}>
          <span {...stylex.props(styles.sideTitle)}>
            <ChatsCircleIcon size={15} /> Assistant
          </span>
          <Tooltip label="New conversation">
            <Link
              to="/assistant"
              aria-label="New conversation"
              {...stylex.props(styles.new)}
            >
              <PlusIcon size={15} />
            </Link>
          </Tooltip>
        </div>
        {(list.data?.length ?? 0) > FILTER_FROM && (
          <div {...stylex.props(styles.filter)}>
            <Input
              aria-label="Find a conversation"
              placeholder="Find a conversation"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setFilter("");
                }
              }}
              leading={<MagnifyingGlassIcon size={13} />}
            />
          </div>
        )}
        <nav aria-label="Conversations" {...stylex.props(styles.list)}>
          {list.isPending && <Skeleton lines={6} height={30} />}
          {term && shown.length === 0 && (
            <p {...stylex.props(styles.listEmpty)}>
              No conversation is called that. Titles come from the first thing
              asked.
            </p>
          )}
          {list.data?.length === 0 && (
            <p {...stylex.props(styles.listEmpty)}>
              Conversations you start show up here, with briefs and pings in
              their own thread.
            </p>
          )}
          {groupByRecency(shown).map(([label, items]) => (
            <section key={label} {...stylex.props(styles.group)}>
              <h3 {...stylex.props(styles.groupLabel)}>{label}</h3>
              {items.map((c) => {
                const agent = byId.get(c.agentId);
                const owner = agent?.ownerId
                  ? byId.get(agent.ownerId)
                  : undefined;
                return (
                  <Link
                    key={c.id}
                    to="/assistant/$conversationId"
                    params={{ conversationId: c.id }}
                    {...stylex.props(styles.item)}
                  >
                    {c.mode === "teammate" && owner && (
                      <Avatar person={owner} size={16} />
                    )}
                    <span
                      {...stylex.props(
                        styles.itemTitle,
                        hasUnseenReply(c) && styles.itemUnseen
                      )}
                    >
                      {titleOf(c, owner?.name)}
                    </span>
                    <ItemStatus
                      conversation={c}
                      working={busy.has(c.id)}
                      agent={mine}
                    />
                  </Link>
                );
              })}
            </section>
          ))}
        </nav>
        <div {...stylex.props(styles.sideFoot)}>
          <Link to="/settings/assistant" {...stylex.props(styles.footLink)}>
            <ScrollIcon size={14} /> Instructions
          </Link>
          <Link to="/settings/memory" {...stylex.props(styles.footLink)}>
            <BrainIcon size={14} /> What it remembers
          </Link>
        </div>
      </aside>
      <section {...stylex.props(styles.main)}>{children}</section>
    </div>
  );
}

/**
 * A new conversation starts at the composer, as in any assistant people already use: what's
 * written here opens the conversation and is sent as its first message.
 */
/** What a conversation is called in lists and its header. */
export function titleOf(
  c: { title: string | null; inbox: boolean; mode: "owner" | "teammate" },
  owner?: string
) {
  // The thread briefs and pings arrive in; "Inbox" would name the page of attention items.
  if (c.inbox) {
    return "From your assistant";
  }
  if (c.title) {
    return c.title;
  }
  return c.mode === "teammate"
    ? `${owner ?? "Teammate"}'s assistant`
    : "New conversation";
}

function groupByRecency<T extends { updatedAt: string }>(items: T[]) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const label = recencyLabel(item.updatedAt);
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }
  return [...groups.entries()];
}

export function NewChat({ ask }: { ask?: string }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const started = useRef(false);
  const me = useMe();
  const { agent: mine, state, glance } = usePresence();
  const conversations = useQuery(q.conversations());
  const open = useMutation({
    mutationFn: async (question: string) => {
      const reply = await unwrap(
        api.POST("/v1/conversations", { body: { to: "me" } })
      );
      return { reply, question };
    },
    onSuccess: ({ reply, question }) => {
      // Listed under the question straight away; the server names it once the first turn is in.
      client.setQueryData(q.conversations().queryKey, (cached) => [
        { ...reply.conversation, title: reply.conversation.title ?? question },
        ...(cached ?? []).filter((c) => c.id !== reply.conversation.id),
      ]);
      void navigate({
        to: "/assistant/$conversationId",
        params: { conversationId: reply.conversation.id },
        search: { ask: question },
        replace: true,
      });
    },
    onError: (error) => toast.error(error.message),
  });

  const start = useEffectEvent((question: string) => {
    open.mutate(question);
  });
  useEffect(() => {
    if (ask && !started.current) {
      started.current = true;
      start(ask);
    }
  }, [ask]);
  const firstName = me?.member.name.split(" ")[0];
  const suggestions = useSuggestions();
  const asking = open.variables ?? (open.isError ? undefined : ask);

  if (asking && !open.isError) {
    // The question shows the moment it's asked, as the thread will; the conversation opens under it.
    return (
      <>
        <PageHeader title={asking} />
        <PendingThread question={asking} agent={mine} />
      </>
    );
  }

  return (
    <div {...stylex.props(styles.empty)}>
      <div {...stylex.props(styles.emptyColumn)}>
        <div {...stylex.props(styles.emptyHead)}>
          {mine && <AssistantFace agent={mine} state={state} size={40} />}
          <h1 {...stylex.props(styles.emptyTitle)}>
            {firstName
              ? `What can I find for you, ${firstName}?`
              : "What can I find for you?"}
          </h1>
          {/* Someone new learns what it is; after that, the line says what it's doing. */}
          {conversations.data?.length === 0 || !glance ? (
            <p {...stylex.props(styles.emptyText)}>
              Your assistant reads the team’s activity and your board, remembers
              what you tell it, and stays quiet when there’s nothing to say.
            </p>
          ) : (
            <StatusLine glance={glance} />
          )}
        </div>
        <Composer
          busy={open.isPending}
          label="Message your assistant"
          placeholder="Ask anything about your team’s work…"
          context={<span>Sees your work and your team’s</span>}
          onSend={(question) => open.mutate(question)}
        />
        <ul {...stylex.props(styles.starters)}>
          {suggestions.map((suggestion) => (
            <li key={suggestion.label}>
              <button
                type="button"
                disabled={open.isPending}
                onClick={() => open.mutate(suggestion.ask)}
                {...stylex.props(styles.starter)}
              >
                {suggestion.label}
              </button>
            </li>
          ))}
        </ul>
        <RecentConversations />
      </div>
    </div>
  );
}

/** What the assistant is doing, linked to where it's doing it when that's a conversation. */
function StatusLine({ glance }: { glance: Glance }) {
  return (
    <p aria-live="polite" {...stylex.props(styles.emptyText)}>
      {glance.conversationId ? (
        <Link
          to="/assistant/$conversationId"
          params={{ conversationId: glance.conversationId }}
          {...stylex.props(styles.statusLink)}
        >
          {glance.line}
        </Link>
      ) : (
        glance.line
      )}
    </p>
  );
}

// Where a row's time goes: the assistant's face while it's answering there, a dot for an answer
// not yet read, otherwise how long ago it moved.
function ItemStatus({
  conversation,
  working,
  agent,
}: {
  conversation: {
    updatedAt: string;
    repliedAt: string | null;
    seenAt: string | null;
  };
  working: boolean;
  agent: Member | undefined;
}) {
  if (working) {
    return (
      <span {...stylex.props(styles.itemTime)}>
        <VisuallyHidden>Answering</VisuallyHidden>
        <AssistantFace agent={agent} state="working" size={14} />
      </span>
    );
  }
  return (
    <span {...stylex.props(styles.itemTime)}>
      {hasUnseenReply(conversation) && (
        <>
          <VisuallyHidden>New answer, </VisuallyHidden>
          <Dot tone="accent" />
        </>
      )}
      {ago(conversation.updatedAt)}
    </span>
  );
}

/** On a phone the list beside the thread is hidden, so a new chat lists the latest ones. */
function RecentConversations() {
  const list = useQuery({ ...q.conversations(), select: notBeingDeleted });
  const items = list.data?.slice(0, 8) ?? [];
  if (items.length === 0) {
    return null;
  }
  return (
    <nav aria-label="Recent conversations" {...stylex.props(styles.recent)}>
      <h3 {...stylex.props(styles.groupLabel)}>Recent</h3>
      {items.map((c) => (
        <Link
          key={c.id}
          to="/assistant/$conversationId"
          params={{ conversationId: c.id }}
          {...stylex.props(styles.item)}
        >
          <span
            {...stylex.props(
              styles.itemTitle,
              hasUnseenReply(c) && styles.itemUnseen
            )}
          >
            {titleOf(c)}
          </span>
          <ItemStatus conversation={c} working={false} agent={undefined} />
        </Link>
      ))}
    </nav>
  );
}

export function ConversationView({ id, ask }: { id: string; ask?: string }) {
  const conversation = useQuery(q.conversation(id));
  const navigate = useNavigate();
  const { byId } = useMembers();
  // The URL drops the question straight away, so a reload can't send it twice; keep it here.
  // oxlint-disable-next-line react/hook-use-state -- only the first value is wanted; there is nothing to set
  const [question] = useState(ask);

  const dropQuestion = useEffectEvent(() => {
    if (ask) {
      void navigate({
        to: "/assistant/$conversationId",
        params: { conversationId: id },
        search: {},
        replace: true,
      });
    }
  });
  useEffect(() => {
    dropQuestion();
  }, []);

  if (conversation.isPending) {
    return (
      <div {...stylex.props(styles.pad)}>
        <Skeleton lines={5} />
      </div>
    );
  }
  if (conversation.isError) {
    // Gone is not broken: a deleted conversation, or one that was never yours (403), gets a way
    // on instead of a Try again that can't work.
    const gone =
      conversation.error instanceof ApiError &&
      (conversation.error.status === 404 || conversation.error.status === 403);
    return (
      <div {...stylex.props(styles.pad)}>
        {gone ? (
          <EmptyState
            icon={<ChatsCircleIcon size={20} />}
            title="This conversation isn’t here anymore"
            action={
              <Button
                variant="primary"
                onClick={() => {
                  void navigate({ to: "/assistant" });
                }}
              >
                Start a new one
              </Button>
            }
          >
            It may have been deleted, or it belongs to someone else.
          </EmptyState>
        ) : (
          <ErrorNote
            error={conversation.error}
            retry={() => {
              void conversation.refetch();
            }}
          />
        )}
      </div>
    );
  }
  const { messages, ...meta } = conversation.data;
  const ownerOf = (agentId: string) => {
    const agent = byId.get(agentId);
    return agent?.ownerId ? byId.get(agent.ownerId)?.name : undefined;
  };
  return (
    <>
      <PageHeader
        back={
          <Link
            to="/assistant"
            aria-label="All conversations"
            {...stylex.props(styles.back)}
          >
            <CaretLeftIcon size={16} />
          </Link>
        }
        actions={
          meta.mode === "owner" && !meta.inbox ? (
            <ConversationMenu id={meta.id} title={meta.title} />
          ) : undefined
        }
        title={
          <EditableTitle
            conversationId={meta.id}
            editable={!meta.inbox}
            title={
              meta.inbox || meta.title
                ? titleOf(meta, ownerOf(meta.agentId))
                : (messages.find((m) => m.role === "user")?.text ??
                  question ??
                  titleOf(meta, ownerOf(meta.agentId)))
            }
          />
        }
      />
      <Chat conversation={meta} stored={messages} firstMessage={question} />
    </>
  );
}

// How long a deleted conversation can still be brought back.
const UNDO_MS = 5000;
const pendingDeletes = new Map<string, ReturnType<typeof setTimeout>>();

// The server keeps a deleted conversation until its Undo window ends, so a refetch meanwhile
// (focus, a live message) must not bring it back into the list.
function notBeingDeleted<T extends { id: string }>(list: T[]) {
  return list.filter((c) => !pendingDeletes.has(c.id));
}

// A tab closed during the undo window still deletes: the request outlives the page.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    for (const [id, timer] of pendingDeletes) {
      clearTimeout(timer);
      void api.DELETE("/v1/conversations/{id}", {
        params: { path: { id } },
        keepalive: true,
      });
    }
    pendingDeletes.clear();
  });
}

async function deleteFor(id: string, restore: () => void) {
  try {
    await unwrap(
      api.DELETE("/v1/conversations/{id}", { params: { path: { id } } })
    );
  } catch (error) {
    restore();
    toast.error(
      error instanceof Error
        ? error.message
        : "That didn’t delete. Check your connection, then try again."
    );
  }
}

/**
 * Deleting goes at once from the list and the page, with Undo for a few seconds instead of a
 * confirm dialog; only then is it deleted for good.
 */
function ConversationMenu({ id, title }: { id: string; title: string | null }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { byId } = useMembers();
  const copy = async () => {
    try {
      // Fetched fresh: a reply that just finished streaming isn't in the cached copy yet.
      const detail = await client.query({
        ...q.conversation(id),
        staleTime: 0,
      });
      const names = {
        user: byId.get(detail.askerId)?.name ?? "You",
        assistant: byId.get(detail.agentId)?.name ?? "Assistant",
      };
      await navigator.clipboard.writeText(asMarkdown(detail, names));
      toast("Copied the conversation as Markdown");
    } catch {
      toast.error("That didn’t copy. Try again.");
    }
  };
  const remove = () => {
    const key = q.conversations().queryKey;
    const before = client.getQueryData(key);
    client.setQueryData(key, (cached) => cached?.filter((c) => c.id !== id));
    void navigate({ to: "/assistant" });
    const timer = setTimeout(() => {
      pendingDeletes.delete(id);
      void deleteFor(id, () => {
        client.setQueryData(key, before);
      }).finally(() => {
        void client.invalidateQueries({ queryKey: ["conversations"] });
      });
    }, UNDO_MS);
    pendingDeletes.set(id, timer);
    toast(title ? `Deleted “${title}”` : "Deleted the conversation", {
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: () => {
          clearTimeout(timer);
          pendingDeletes.delete(id);
          client.setQueryData(key, before);
          void navigate({
            to: "/assistant/$conversationId",
            params: { conversationId: id },
          });
        },
      },
    });
  };
  return (
    <Menu
      align="end"
      trigger={
        <Button
          size="sm"
          variant="ghost"
          aria-label="Conversation options"
          icon={<DotsThreeIcon size={15} />}
        />
      }
    >
      <MenuItem
        icon={<CopyIcon size={14} />}
        onClick={() => {
          void copy();
        }}
      >
        Copy as Markdown
      </MenuItem>
      <MenuItem icon={<TrashIcon size={14} />} onClick={remove}>
        Delete conversation
      </MenuItem>
    </Menu>
  );
}

function asMarkdown(
  detail: {
    title: string | null;
    messages: { role: "user" | "assistant"; text: string }[];
  },
  names: Record<"user" | "assistant", string>
) {
  const turns = detail.messages
    .filter((m) => m.text.trim() !== "")
    .map((m) => `**${names[m.role]}**\n\n${m.text.trim()}`);
  return `${[`# ${detail.title ?? "Conversation"}`, ...turns].join("\n\n")}\n`;
}

/**
 * A conversation's name, renamed where it's read: click it (or its pencil), type, and Enter
 * saves; Escape keeps the old one. The list updates at once.
 */
function EditableTitle({
  conversationId,
  title,
  editable,
}: {
  conversationId: string;
  title: string;
  editable: boolean;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const rename = useMutation({
    mutationFn: async (next: string) =>
      await unwrap(
        api.PATCH("/v1/conversations/{id}", {
          params: { path: { id: conversationId } },
          body: { title: next },
        })
      ),
    onMutate: (next) => {
      client.setQueryData(q.conversations().queryKey, (cached) =>
        cached?.map((c) =>
          c.id === conversationId ? { ...c, title: next } : c
        )
      );
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (error) => toast.error(error.message),
  });
  if (!editable) {
    return title;
  }
  if (draft === null) {
    return (
      <button
        type="button"
        title="Rename"
        onClick={() => setDraft(title)}
        {...stylex.props(styles.titleButton)}
      >
        <span {...stylex.props(styles.titleText)}>{title}</span>
        <PencilSimpleIcon size={13} {...stylex.props(styles.titlePencil)} />
      </button>
    );
  }
  const save = () => {
    const next = draft.trim();
    setDraft(null);
    if (next && next !== title) {
      rename.mutate(next);
    }
  };
  return (
    <input
      // oxlint-disable-next-line jsx-a11y/no-autofocus -- the person just asked to rename it
      autoFocus
      aria-label="Conversation name"
      value={draft}
      maxLength={120}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          save();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setDraft(null);
        }
      }}
      {...stylex.props(styles.titleInput)}
    />
  );
}

const styles = stylex.create({
  titleButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    maxWidth: "100%",
    padding: 0,
    borderWidth: 0,
    font: "inherit",
    color: "inherit",
    backgroundColor: "transparent",
    cursor: "text",
  },
  titleText: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  titlePencil: {
    flexShrink: 0,
    color: color.fgFaint,
    opacity: {
      default: 0,
      ":is(button:hover > *)": { default: 0, [media.hover]: 1 },
      ":is(button:focus-visible > *)": 1,
      "@media (hover: none)": 1,
    },
  },
  titleInput: {
    width: "min(480px, 100%)",
    paddingBlock: 2,
    paddingInline: space.sm,
    marginInline: `calc(-1 * ${space.sm})`,
    borderWidth: 0,
    borderRadius: radius.sm,
    font: "inherit",
    color: color.fg,
    backgroundColor: color.ui,
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
  },
  layout: {
    flexGrow: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: {
      default: "260px minmax(0, 1fr)",
      "@media (max-width: 860px)": "minmax(0, 1fr)",
    },
  },
  side: {
    display: { default: "flex", "@media (max-width: 860px)": "none" },
    flexDirection: "column",
    minHeight: 0,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: color.line,
    backgroundColor: color.surface,
  },
  sideHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: 48,
    flexShrink: 0,
    paddingInlineStart: space.xl,
    paddingInlineEnd: space.md,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
  },
  sideTitle: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    fontSize: text.titleSm,
    fontWeight: 600,
  },
  new: {
    display: "grid",
    placeItems: "center",
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.uiHover },
    },
  },
  list: {
    flexGrow: 1,
    overflowY: "auto",
    padding: space.sm,
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    height: 32,
    paddingInline: space.md,
    borderRadius: radius.sm,
    fontSize: text.label,
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
      ":is([data-status=active])": color.fg,
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.uiHover },
      ":is([data-status=active])": color.uiActive,
    },
  },
  group: { display: "flex", flexDirection: "column", gap: 1 },
  filter: { paddingInline: space.sm, paddingTop: space.sm },
  // The list sits beside the thread on wide screens; on a phone the thread needs a way back to it.
  back: {
    display: { default: "none", "@media (max-width: 860px)": "grid" },
    placeItems: "center",
    width: 28,
    height: 28,
    marginInlineStart: -6,
    borderRadius: radius.sm,
    color: color.fgMuted,
  },
  recent: {
    display: { default: "none", "@media (max-width: 860px)": "flex" },
    flexDirection: "column",
    gap: 1,
    marginTop: space.lg,
  },
  groupLabel: {
    margin: 0,
    paddingInline: space.md,
    paddingTop: space.md,
    paddingBottom: space.xs,
    fontSize: text.caption,
    lineHeight: leading.caption,
    fontWeight: 500,
    color: color.fgFaint,
  },
  itemTitle: {
    flexGrow: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  itemUnseen: { fontWeight: 600, color: color.fg },
  itemTime: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    flexShrink: 0,
    fontSize: text.caption,
    // The open conversation's fill is a step darker, so its time steps up to stay readable.
    color: {
      default: color.fgFaint,
      ":is([data-status=active] > *)": color.fgMuted,
    },
    fontVariantNumeric: "tabular-nums",
  },
  sideFoot: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    padding: space.sm,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: color.line,
  },
  footLink: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    height: 30,
    paddingInline: space.md,
    borderRadius: radius.sm,
    fontSize: text.label,
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.uiHover },
    },
  },
  main: { display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 },
  pad: { padding: space.x3 },
  empty: {
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    // "safe": once routines fill the page it scrolls from the top instead of clipping it.
    justifyContent: {
      default: "safe center",
      "@media (max-width: 640px)": "flex-start",
    },
    paddingBlock: space.x4,
    paddingInline: { default: space.x3, "@media (max-width: 640px)": space.md },
    overflowY: "auto",
  },
  emptyColumn: {
    display: "flex",
    flexShrink: 0,
    flexDirection: "column",
    gap: space.xl,
    width: "100%",
    maxWidth: 680,
    // Sits a little above centre, where the eye lands on an empty page.
    marginBottom: { default: "10vh", "@media (max-width: 640px)": 0 },
  },
  emptyHead: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.md,
    paddingInline: space.sm,
  },
  emptyTitle: {
    margin: 0,
    marginTop: space.xs,
    fontSize: text.titleLg,
    lineHeight: leading.titleLg,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    textWrap: "balance",
  },
  statusLink: {
    color: "inherit",
    textDecorationLine: "underline",
    textDecorationColor: {
      default: color.line,
      ":hover": { default: null, [media.hover]: color.fgMuted },
    },
    textUnderlineOffset: 3,
  },
  emptyText: {
    margin: 0,
    maxWidth: 520,
    fontSize: text.copy,
    lineHeight: leading.copy,
    color: color.fgMuted,
    textWrap: "pretty",
  },
  starters: {
    display: "flex",
    flexWrap: "wrap",
    gap: space.sm,
    margin: 0,
    paddingInline: space.sm,
    listStyle: "none",
  },
  // A long suggestion wraps on a phone, so the chip grows with it instead of clipping.
  starter: {
    minHeight: 30,
    paddingBlock: space.xs,
    paddingInline: space.lg,
    borderRadius: radius.lg,
    textAlign: "start",
    lineHeight: leading.label,
    borderWidth: 0,
    fontSize: text.label,
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.ui },
    },
    boxShadow: `inset 0 0 0 1px ${color.line}`,
    cursor: "pointer",
  },
  listEmpty: {
    paddingInline: space.md,
    paddingBlock: space.sm,
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgFaint,
  },
});
