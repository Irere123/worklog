import { ListIcon, MagnifyingGlassIcon, TrayIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { q } from "#api/queries";
import { AssistantFace, usePresence } from "#features/assistant/presence";
import { Count, Dot } from "#ui/chip";
import { color, radius, space, text } from "#ui/tokens.stylex";

import { Logo } from "./logo";

/**
 * Narrow screens only: the sidebar folds into a drawer, and this bar keeps what a phone visit is
 * for one tap away: the menu, search, your assistant (whose face shows what it's doing) and
 * what's waiting in the inbox.
 */
export function MobileBar({
  onMenu,
  onSearch,
}: {
  onMenu: () => void;
  onSearch: () => void;
}) {
  const me = useQuery(q.me());
  const attention = useQuery(q.attention("open"));
  const waiting = attention.data?.length ?? 0;
  const { agent, state, glance, presence } = usePresence();
  const line = glance?.line;
  const unseen = (presence?.done.length ?? 0) > 0;
  return (
    <header {...stylex.props(styles.bar)}>
      <button
        type="button"
        aria-label="Open menu"
        onClick={onMenu}
        {...stylex.props(styles.icon)}
      >
        <ListIcon size={18} />
      </button>
      <Link to="/home" {...stylex.props(styles.brand)}>
        <Logo size={22} />
        <span {...stylex.props(styles.name)}>
          {me.data?.workspace.name ?? "Worklog"}
        </span>
      </Link>
      <button
        type="button"
        aria-label="Search"
        onClick={onSearch}
        {...stylex.props(styles.icon)}
      >
        <MagnifyingGlassIcon size={18} />
      </button>
      <Link
        to="/assistant"
        aria-label={line ? `Assistant: ${line}` : "Assistant"}
        {...stylex.props(styles.icon, styles.inbox)}
      >
        <AssistantFace agent={agent} state={state} size={20} />
        {unseen && (
          <span {...stylex.props(styles.dot)}>
            <Dot tone="accent" />
          </span>
        )}
      </Link>
      <Link
        to="/inbox"
        aria-label={`Inbox, ${waiting} waiting`}
        {...stylex.props(styles.icon, styles.inbox)}
      >
        <TrayIcon size={18} />
        {waiting > 0 && (
          <span {...stylex.props(styles.badge)}>
            <Count tone="accent">{waiting}</Count>
          </span>
        )}
      </Link>
    </header>
  );
}

const styles = stylex.create({
  bar: {
    display: { default: "none", "@media (max-width: 860px)": "flex" },
    alignItems: "center",
    gap: space.xs,
    height: 52,
    flexShrink: 0,
    paddingInline: space.sm,
    paddingTop: "env(safe-area-inset-top)",
    boxSizing: "content-box",
    backgroundColor: color.sidebar,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
  },
  icon: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    width: 40,
    height: 40,
    flexShrink: 0,
    borderRadius: radius.md,
    color: color.fgMuted,
    backgroundColor: { default: "transparent", ":active": color.uiHover },
  },
  inbox: { color: color.fg },
  badge: { position: "absolute", top: 2, right: 0 },
  dot: { position: "absolute", top: 8, right: 7, display: "inline-flex" },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    flexGrow: 1,
    minWidth: 0,
    paddingInline: space.xs,
  },
  name: {
    fontSize: text.copy,
    fontWeight: 600,
    color: color.fg,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});
