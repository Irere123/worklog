import {
  CardsIcon,
  CaretUpDownIcon,
  ChatsCircleIcon,
  GearIcon,
  HouseIcon,
  KanbanIcon,
  KeyboardIcon,
  MagnifyingGlassIcon,
  MonitorIcon,
  MoonIcon,
  NewspaperIcon,
  NotePencilIcon,
  PlusIcon,
  PulseIcon,
  RobotIcon,
  SignOutIcon,
  SunIcon,
  TrayIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { LiveStatus } from "#api/live";
import { q } from "#api/queries";
import { signOut } from "#features/auth/session";
import { useTabBadge } from "#lib/tab-badge";
import { setTheme, useTheme } from "#lib/theme";
import { Avatar } from "#ui/avatar";
import { Count, Dot, Kbd } from "#ui/chip";
import { Menu, MenuItem, MenuLabel, MenuSeparator, Tooltip } from "#ui/overlay";
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

import { Logo } from "./logo";
import { PinStack } from "./pin-stack";
import type { ShellDialog } from "./shell";

const LIVE: Record<
  LiveStatus,
  { tone: "green" | "amber" | "neutral"; label: string }
> = {
  live: { tone: "green", label: "Live: updates appear as they happen" },
  connecting: { tone: "amber", label: "Reconnecting…" },
  offline: { tone: "neutral", label: "Offline: refresh to reconnect" },
};

export function Sidebar({
  live,
  onOpen,
  drawer,
}: {
  live: LiveStatus;
  onOpen: (dialog: ShellDialog) => void;
  /** On narrow screens the sidebar slides over the page; this says whether it's out. */
  drawer: boolean;
}) {
  const me = useQuery(q.me());
  const attention = useQuery(q.attention("open"));
  const boards = useQuery(q.boards());
  const navigate = useNavigate();
  const open = attention.data?.length ?? 0;
  useTabBadge(open);

  return (
    <nav
      aria-label="Main"
      {...stylex.props(styles.sidebar, drawer && styles.drawerOpen)}
    >
      <WorkspaceMenu
        name={me.data?.workspace.name ?? "Worklog"}
        onOpen={onOpen}
      />

      <div {...stylex.props(styles.actions)}>
        <button
          type="button"
          onClick={() => onOpen("palette")}
          {...stylex.props(styles.search)}
        >
          <MagnifyingGlassIcon size={14} />
          <span {...stylex.props(styles.grow)}>Search…</span>
          <Kbd>⌘ K</Kbd>
        </button>
        <Tooltip label="Log work" shortcut="L" side="right">
          <button
            type="button"
            aria-label="Log work"
            onClick={() => onOpen("log")}
            {...stylex.props(styles.square)}
          >
            <NotePencilIcon size={15} />
          </button>
        </Tooltip>
      </div>

      <div {...stylex.props(styles.group)}>
        <NavItem to="/home" icon={HouseIcon}>
          Home
        </NavItem>
        <NavItem
          to="/inbox"
          icon={TrayIcon}
          trailing={open > 0 ? <Count tone="accent">{open}</Count> : null}
        >
          Inbox
        </NavItem>
        <NavItem to="/mine" icon={CardsIcon}>
          My cards
        </NavItem>
        <NavItem to="/activity" icon={PulseIcon}>
          Activity
        </NavItem>
        <NavItem to="/assistant" icon={ChatsCircleIcon}>
          Assistant
        </NavItem>
        <NavItem to="/briefs" icon={NewspaperIcon}>
          Briefs
        </NavItem>
        <NavItem to="/people" icon={UsersIcon}>
          People
        </NavItem>
      </div>

      <div {...stylex.props(styles.group)}>
        <div {...stylex.props(styles.groupHead)}>
          <span>Boards</span>
          <Menu
            align="end"
            trigger={
              <button
                type="button"
                aria-label="Add a card or board"
                {...stylex.props(styles.groupAction)}
              >
                <PlusIcon size={14} />
              </button>
            }
          >
            <MenuItem
              icon={<KanbanIcon size={14} />}
              shortcut="C"
              onClick={() => onOpen("card")}
            >
              New card
            </MenuItem>
            <MenuItem
              icon={<PlusIcon size={14} />}
              onClick={() => {
                void navigate({ to: "/boards/new" });
              }}
            >
              New board
            </MenuItem>
          </Menu>
        </div>
        {boards.data
          ?.filter((b) => !b.archived)
          .map((board) => (
            <NavItem
              key={board.id}
              to="/boards/$boardId"
              params={{ boardId: board.id }}
              icon={KanbanIcon}
            >
              {board.name}
            </NavItem>
          ))}
      </div>

      <div {...stylex.props(styles.spacer)} />
      <PinStack />

      <div {...stylex.props(styles.group)}>
        <NavItem to="/settings" icon={GearIcon}>
          Settings
        </NavItem>
      </div>
      <div {...stylex.props(styles.footer)}>
        {me.data && (
          <Link
            to="/people/$handle"
            params={{ handle: me.data.member.handle }}
            {...stylex.props(styles.me)}
          >
            <Avatar person={me.data.member} size={22} />
            <span {...stylex.props(styles.meName)}>{me.data.member.name}</span>
          </Link>
        )}
        <Tooltip label={LIVE[live].label} side="top">
          <output {...stylex.props(styles.live)} aria-label={LIVE[live].label}>
            <Dot tone={LIVE[live].tone} pulse={live === "live"} />
          </output>
        </Tooltip>
      </div>
    </nav>
  );
}

function NavItem({
  icon,
  children,
  trailing,
  ...link
}: LinkProps & { icon: Icon; children: ReactNode; trailing?: ReactNode }) {
  const Glyph = icon;
  return (
    <Link {...link} {...stylex.props(styles.item)}>
      {({ isActive }) => (
        <>
          {/* Filled where you are, like a tab bar: the place reads from the icon as well as the row. */}
          <span {...stylex.props(styles.itemIcon)}>
            <Glyph size={16} weight={isActive ? "fill" : "regular"} />
          </span>
          <span {...stylex.props(styles.itemLabel)}>{children}</span>
          {trailing}
        </>
      )}
    </Link>
  );
}

function WorkspaceMenu({
  name,
  onOpen,
}: {
  name: string;
  onOpen: (dialog: ShellDialog) => void;
}) {
  const theme = useTheme();
  const client = useQueryClient();
  const navigate = useNavigate();
  return (
    <Menu
      width={240}
      trigger={
        <button type="button" {...stylex.props(styles.workspace)}>
          <Logo size={22} />
          <span {...stylex.props(styles.workspaceName)}>{name}</span>
          <CaretUpDownIcon size={14} {...stylex.props(styles.faint)} />
        </button>
      }
    >
      <MenuLabel>Theme</MenuLabel>
      <MenuItem
        icon={<MonitorIcon size={14} />}
        checked={theme === "system"}
        onClick={() => setTheme("system")}
      >
        System
      </MenuItem>
      <MenuItem
        icon={<SunIcon size={14} />}
        checked={theme === "light"}
        onClick={() => setTheme("light")}
      >
        Light
      </MenuItem>
      <MenuItem
        icon={<MoonIcon size={14} />}
        checked={theme === "dark"}
        onClick={() => setTheme("dark")}
      >
        Dark
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon={<KeyboardIcon size={14} />}
        shortcut="?"
        onClick={() => onOpen("shortcuts")}
      >
        Keyboard shortcuts
      </MenuItem>
      <MenuItem
        icon={<RobotIcon size={14} />}
        onClick={() => {
          void navigate({ to: "/settings" });
        }}
      >
        Members and agents
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon={<SignOutIcon size={14} />}
        onClick={() => {
          void signOut(client).then(
            async () => await navigate({ to: "/login" })
          );
        }}
      >
        Sign out
      </MenuItem>
    </Menu>
  );
}

const styles = stylex.create({
  sidebar: {
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
    minHeight: 0,
    paddingBlock: space.md,
    paddingInline: space.md,
    overflowY: "auto",
    color: color.fgMuted,
    backgroundColor: color.sidebar,
    position: { default: "static", "@media (max-width: 860px)": "fixed" },
    inset: { default: null, "@media (max-width: 860px)": "0 auto 0 0" },
    width: { default: null, "@media (max-width: 860px)": "min(288px, 86vw)" },
    zIndex: { default: null, "@media (max-width: 860px)": 45 },
    boxShadow: { default: null, "@media (max-width: 860px)": shadow.lift },
    transform: {
      default: null,
      "@media (max-width: 860px)": "translateX(-105%)",
    },
    transitionProperty: "transform",
    transitionDuration: motion.slow,
    transitionTimingFunction: motion.out,
  },
  drawerOpen: {
    transform: { default: null, "@media (max-width: 860px)": "translateX(0)" },
  },
  workspace: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    width: "100%",
    height: 36,
    paddingInline: space.sm,
    borderRadius: radius.sm,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.uiHover },
    },
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
  },
  workspaceName: {
    flexGrow: 1,
    textAlign: "left",
    fontWeight: 600,
    color: color.fg,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  faint: { color: color.fgFaint },
  actions: { display: "flex", gap: space.xs },
  search: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    flexGrow: 1,
    height: 30,
    paddingInline: space.md,
    borderRadius: radius.sm,
    fontSize: text.label,
    color: color.fgFaint,
    backgroundColor: {
      default: color.bg,
      ":hover": { default: null, [media.hover]: color.raised },
    },
    boxShadow: `0 0 0 1px ${color.line}`,
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
  },
  square: {
    display: "grid",
    placeItems: "center",
    width: 30,
    height: 30,
    flexShrink: 0,
    borderRadius: radius.sm,
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    backgroundColor: {
      default: color.bg,
      ":hover": { default: null, [media.hover]: color.raised },
    },
    boxShadow: `0 0 0 1px ${color.line}`,
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
  },
  grow: { flexGrow: 1, textAlign: "left" },
  group: { display: "flex", flexDirection: "column", gap: 1 },
  groupHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: 24,
    paddingInlineStart: space.md,
    fontSize: text.caption,
    fontWeight: 500,
    color: color.fgFaint,
  },
  groupAction: {
    display: "grid",
    placeItems: "center",
    width: 22,
    height: 22,
    borderRadius: radius.xs,
    color: {
      default: color.fgFaint,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.uiHover },
    },
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    height: 28,
    paddingInline: space.md,
    borderRadius: radius.sm,
    fontSize: text.label,
    lineHeight: leading.label,
    fontWeight: 500,
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
    transitionProperty: "background-color, color",
    transitionDuration: motion.fast,
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
    outlineOffset: -2,
  },
  itemIcon: { display: "grid", placeItems: "center", opacity: 0.9 },
  itemLabel: {
    flexGrow: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  spacer: { flexGrow: 1 },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: color.line,
  },
  me: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    flexGrow: 1,
    minWidth: 0,
    height: 32,
    paddingInline: space.sm,
    borderRadius: radius.sm,
    color: color.fg,
    fontWeight: 500,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.uiHover },
    },
  },
  meName: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  live: {
    display: "grid",
    placeItems: "center",
    width: 24,
    height: 24,
  },
});
