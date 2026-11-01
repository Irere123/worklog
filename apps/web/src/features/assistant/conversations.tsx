import {
  BrainIcon,
  ChatsCircleIcon,
  NotePencilIcon,
  PencilLineIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";

import { api, unwrap } from "#api/client";
import { q } from "#api/queries";
import { useMe } from "#features/auth/session";
import { useMembers } from "#features/cards/card-bits";
import { ago } from "#lib/time";
import { Avatar } from "#ui/avatar";
import { Button } from "#ui/button";
import { ErrorNote, Skeleton } from "#ui/feedback";
import { PageHeader } from "#ui/layout";
import { Tooltip } from "#ui/overlay";
import { color, leading, media, radius, space, text } from "#ui/tokens.stylex";

import { Chat } from "./chat";

/** First questions worth asking, offered wherever the assistant waits for one. */
export const STARTERS = [
  "What changed while I was away?",
  "What's blocked right now?",
  "Draft my standup",
];

export function Conversations({ children }: { children: ReactNode }) {
  const list = useQuery(q.conversations());
  const { byId } = useMembers();
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
              <NotePencilIcon size={15} />
            </Link>
          </Tooltip>
        </div>
        <nav aria-label="Conversations" {...stylex.props(styles.list)}>
          {list.isPending && <Skeleton lines={6} height={30} />}
          {list.data?.length === 0 && (
            <p {...stylex.props(styles.listEmpty)}>
              Conversations you start show up here, with briefs and pings in
              their own thread.
            </p>
          )}
          {list.data?.map((c) => {
            const agent = byId.get(c.agentId);
            const owner = agent?.ownerId ? byId.get(agent.ownerId) : undefined;
            return (
              <Link
                key={c.id}
                to="/assistant/$conversationId"
                params={{ conversationId: c.id }}
                {...stylex.props(styles.item)}
              >
                {c.mode === "teammate" && owner ? (
                  <Avatar person={owner} size={18} />
                ) : (
                  <span {...stylex.props(styles.dot)} />
                )}
                <span {...stylex.props(styles.itemTitle)}>
                  {c.title ??
                    (c.mode === "teammate"
                      ? `${owner?.name ?? "Teammate"}'s assistant`
                      : "New conversation")}
                </span>
                <span {...stylex.props(styles.itemTime)}>
                  {ago(c.updatedAt)}
                </span>
              </Link>
            );
          })}
        </nav>
        <div {...stylex.props(styles.sideFoot)}>
          <Link to="/settings/assistant" {...stylex.props(styles.footLink)}>
            <PencilLineIcon size={14} /> Instructions
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

/** Opening a conversation needs a server id first; a question from ⌘K or Home rides along. */
export function NewChat({ ask }: { ask?: string }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const started = useRef(false);
  const me = useMe();
  const { list } = useMembers();
  const mine = list.find(
    (m) => m.agentProvider === "worklog" && m.ownerId === me?.member.id
  );
  const open = useMutation({
    mutationFn: async () =>
      await unwrap(api.POST("/v1/conversations", { body: { to: "me" } })),
    onSuccess: (reply) => {
      void client.invalidateQueries({ queryKey: ["conversations"] });
      void navigate({
        to: "/assistant/$conversationId",
        params: { conversationId: reply.conversation.id },
        search: ask ? { ask } : {},
        replace: true,
      });
    },
    onError: (error) => toast.error(error.message),
  });

  const start = useEffectEvent(() => {
    open.mutate();
  });
  useEffect(() => {
    if (ask && !started.current) {
      started.current = true;
      start();
    }
  }, [ask]);

  return (
    <div {...stylex.props(styles.empty)}>
      {mine ? (
        <Avatar person={mine} size={48} />
      ) : (
        <span {...stylex.props(styles.emptyIcon)}>
          <ChatsCircleIcon size={22} />
        </span>
      )}
      <h2 {...stylex.props(styles.emptyTitle)}>Your assistant</h2>
      <p {...stylex.props(styles.emptyText)}>
        It knows your work and your team’s, learns from what you tell it the
        same day, and stays quiet when there’s nothing to say.
      </p>
      <Button
        variant="primary"
        icon={<NotePencilIcon size={14} />}
        busy={open.isPending}
        onClick={() => open.mutate()}
      >
        Start a conversation
      </Button>
      <div {...stylex.props(styles.starters)}>
        {STARTERS.map((question) => (
          <button
            key={question}
            type="button"
            disabled={open.isPending}
            onClick={() => {
              void navigate({ to: "/assistant", search: { ask: question } });
            }}
            {...stylex.props(styles.starter)}
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ConversationView({ id, ask }: { id: string; ask?: string }) {
  const conversation = useQuery(q.conversation(id));
  const navigate = useNavigate();
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
    return (
      <div {...stylex.props(styles.pad)}>
        <ErrorNote error={conversation.error} />
      </div>
    );
  }
  const { messages, ...meta } = conversation.data;
  return (
    <>
      <PageHeader
        title={
          meta.title ??
          (meta.mode === "teammate" ? "Teammate's assistant" : "Conversation")
        }
      />
      <Chat conversation={meta} stored={messages} firstMessage={question} />
    </>
  );
}

const styles = stylex.create({
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
  dot: {
    width: 6,
    height: 6,
    marginInline: 6,
    borderRadius: "50%",
    backgroundColor: color.accent,
    flexShrink: 0,
  },
  itemTitle: {
    flexGrow: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  itemTime: { fontSize: 11.5, color: color.fgFaint, flexShrink: 0 },
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
    justifyContent: "center",
    textAlign: "center",
    gap: space.md,
    padding: space.x4,
  },
  emptyIcon: {
    display: "grid",
    placeItems: "center",
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    color: color.accentFg,
    backgroundColor: color.accentSubtle,
  },
  emptyTitle: { fontSize: text.title, fontWeight: 600 },
  emptyText: {
    maxWidth: 400,
    fontSize: text.label,
    color: color.fgMuted,
    marginBottom: space.md,
  },
  starters: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: space.sm,
    marginTop: space.lg,
  },
  starter: {
    height: 28,
    paddingInline: space.md,
    borderRadius: radius.full,
    fontSize: text.meta,
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.ui },
    },
    boxShadow: `inset 0 0 0 1px ${color.line}`,
  },
  listEmpty: {
    paddingInline: space.md,
    paddingBlock: space.sm,
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgFaint,
  },
});
