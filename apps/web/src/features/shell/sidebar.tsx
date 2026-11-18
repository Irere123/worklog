import {
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
  SidebarSimpleIcon,
  FootprintsIcon,
  SignOutIcon,
  SunIcon,
  TrayIcon,
  UserCircleIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { Schemas } from "#api/client";
import type { LiveStatus } from "#api/live";
import { q } from "#api/queries";
import { AssistantFace, usePresence } from "#features/assistant/presence";
import { signOut } from "#features/auth/session";
import { useTabBadge } from "#lib/tab-badge";
import { setTheme, useTheme } from "#lib/theme";
import { Avatar, hueOf } from "#ui/avatar";
import { Count, Dot, Kbd } from "#ui/chip";
import { Logo } from "#ui/logo";
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

import { PinStack } from "./pin-stack";
import type { ShellDialog } from "./shell";

type Member = Schemas["Member"];

const BROKEN: Record<
  Exclude<LiveStatus, "live">,
  { tone: "amber" | "neutral"; label: string }
> = {
  connecting: { tone: "amber", label: "Reconnecting…" },
  offline: { tone: "neutral", label: "Offline: refresh to reconnect" },
};

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const FOLD_KEY = "⌘ \\";

export function Sidebar({
  live,
  onOpen,
  onToggle,
  drawer,
  rail,
}: {
  live: LiveStatus;
  onOpen: (dialog: ShellDialog) => void;
  onToggle: () => void;
  /** On narrow screens the sidebar slides over the page; this says whether it's out. */
  drawer: boolean;
  /** Folded to icons, each named by its tooltip. */
  rail: boolean;
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
      <SidebarHead
        name={me.data?.workspace.name ?? "Worklog"}
        drawer={drawer}
        rail={rail}
        onToggle={onToggle}
      />

      <SidebarActions rail={rail} onOpen={onOpen} />

      <div {...stylex.props(styles.group)}>
        <NavItem to="/home" icon={HouseIcon} rail={rail}>
          Home
        </NavItem>
        <NavItem
          to="/inbox"
          icon={TrayIcon}
          rail={rail}
          trailing={open > 0 ? <Count tone="accent">{open}</Count> : null}
        >
          Inbox
        </NavItem>
        <AssistantItem rail={rail} />
      </div>

      <div {...stylex.props(styles.group)}>
        <div {...stylex.props(styles.groupHead)}>
          <span {...stylex.props(styles.label, rail && styles.labelOut)}>
            Team
          </span>
          <span
            aria-hidden
            {...stylex.props(styles.rule, rail && styles.ruleIn)}
          />
        </div>
        <NavItem to="/activity" icon={FootprintsIcon} rail={rail}>
          Activity
        </NavItem>
        <NavItem to="/briefs" icon={NewspaperIcon} rail={rail}>
          Briefs
        </NavItem>
        <NavItem to="/people" icon={UsersIcon} rail={rail}>
          People
        </NavItem>
      </div>

      <div {...stylex.props(styles.group)}>
        <div {...stylex.props(styles.groupHead)}>
          <span {...stylex.props(styles.label, rail && styles.labelOut)}>
            Boards
          </span>
          <span
            aria-hidden
            {...stylex.props(styles.rule, rail && styles.ruleIn)}
          />
          {!rail && (
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
          )}
        </div>
        {boards.data
          ?.filter((b) => !b.archived)
          .map((board) => (
            <NavItem
              key={board.id}
              to="/boards/$boardId"
              params={{ boardId: board.id }}
              mark={<BoardMark id={board.id} name={board.name} />}
              rail={rail}
            >
              {board.name}
            </NavItem>
          ))}
      </div>

      <div {...stylex.props(styles.spacer)} />
      {!rail && <PinStack />}

      <SidebarFooter
        live={live}
        rail={rail}
        onOpen={onOpen}
        onToggle={onToggle}
      />
    </nav>
  );
}

function SidebarHead({
  name,
  drawer,
  rail,
  onToggle,
}: {
  name: string;
  drawer: boolean;
  rail: boolean;
  onToggle: () => void;
}) {
  const toggleLabel = drawer ? "Close menu" : "Collapse sidebar";
  return (
    <div {...stylex.props(styles.head)}>
      <Tooltip label={name} side="right" disabled={!rail}>
        <Link
          to="/home"
          aria-label={rail ? name : undefined}
          {...stylex.props(styles.workspace, rail && styles.workspaceRail)}
        >
          <span {...stylex.props(styles.mark)}>
            <Logo size={22} />
          </span>
          {!rail && <span {...stylex.props(styles.workspaceName)}>{name}</span>}
        </Link>
      </Tooltip>
      {!rail && (
        <Tooltip label={toggleLabel} shortcut={FOLD_KEY} side="bottom">
          <button
            type="button"
            aria-label={toggleLabel}
            onClick={onToggle}
            {...stylex.props(styles.footerAction)}
          >
            <SidebarSimpleIcon size={16} weight="fill" />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

function SidebarActions({
  rail,
  onOpen,
}: {
  rail: boolean;
  onOpen: (dialog: ShellDialog) => void;
}) {
  const search = (
    <button
      type="button"
      aria-label={rail ? "Search" : undefined}
      onClick={() => onOpen("palette")}
      {...stylex.props(styles.search, rail && styles.searchRail)}
    >
      <MagnifyingGlassIcon
        size={14}
        {...stylex.props(styles.noShrink, styles.grows, rail && styles.grown)}
      />
      {!rail && (
        <>
          <span {...stylex.props(styles.grow)}>Search…</span>
          <Kbd>⌘ K</Kbd>
        </>
      )}
    </button>
  );
  return (
    <div {...stylex.props(styles.actions)}>
      <Tooltip label="Search" shortcut="⌘ K" side="right" disabled={!rail}>
        {search}
      </Tooltip>
      {!rail && (
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
      )}
    </div>
  );
}

function SidebarFooter({
  live,
  rail,
  onOpen,
  onToggle,
}: {
  live: LiveStatus;
  rail: boolean;
  onOpen: (dialog: ShellDialog) => void;
  onToggle: () => void;
}) {
  const me = useQuery(q.me());
  return (
    <div {...stylex.props(styles.footer, rail && styles.footerRail)}>
      {me.data && (
        <ProfileMenu member={me.data.member} rail={rail} onOpen={onOpen} />
      )}
      {rail && (
        <Tooltip label="Expand sidebar" shortcut={FOLD_KEY} side="right">
          <button
            type="button"
            aria-label="Expand sidebar"
            onClick={onToggle}
            {...stylex.props(styles.footerAction, styles.railTarget)}
          >
            <SidebarSimpleIcon size={18} />
          </button>
        </Tooltip>
      )}
      {!rail && (
        <Tooltip label="Settings" side="top">
          <Link
            to="/settings"
            aria-label="Settings"
            {...stylex.props(styles.footerAction)}
          >
            {({ isActive }) => (
              <GearIcon size={16} weight={isActive ? "fill" : "regular"} />
            )}
          </Link>
        </Tooltip>
      )}
      {live !== "live" && (
        <Tooltip label={BROKEN[live].label} side={rail ? "right" : "top"}>
          <output
            {...stylex.props(styles.live)}
            aria-label={BROKEN[live].label}
          >
            <Dot tone={BROKEN[live].tone} pulse={live === "connecting"} />
          </output>
        </Tooltip>
      )}
    </div>
  );
}

function AssistantItem({ rail }: { rail: boolean }) {
  const { agent, presence, mood, glance } = usePresence();
  const line = glance?.line;
  const waiting = presence?.waiting ?? 0;
  const unseen = presence?.done.length ?? 0;
  let trailing: ReactNode = null;
  if (waiting > 0) {
    trailing = <Count tone="accent">{waiting}</Count>;
  } else if (unseen > 0) {
    trailing = <Dot tone="accent" />;
  }
  return (
    <Tooltip label={line ?? "Your assistant"} side="right">
      <Link
        to="/assistant"
        aria-label={rail ? "Assistant" : undefined}
        aria-description={line ?? undefined}
        {...stylex.props(styles.item, rail && styles.itemRail)}
      >
        <span {...stylex.props(styles.itemIcon, rail && styles.grown)}>
          {agent ? (
            <AssistantFace mood={mood} size={16} />
          ) : (
            <ChatsCircleIcon size={16} />
          )}
        </span>
        <span {...stylex.props(styles.itemLabel, rail && styles.labelOut)}>
          Assistant
        </span>
        {trailing !== null && (
          <span {...stylex.props(rail && styles.badge)}>{trailing}</span>
        )}
      </Link>
    </Tooltip>
  );
}

function NavItem({
  icon,
  mark,
  children,
  trailing,
  rail,
  ...link
}: LinkProps & {
  children: string;
  trailing?: ReactNode;
  rail: boolean;
} & ({ icon: Icon; mark?: never } | { icon?: never; mark: ReactNode })) {
  const Glyph = icon;
  const row = (
    <Link
      {...link}
      aria-label={rail ? children : undefined}
      {...stylex.props(styles.item, rail && styles.itemRail)}
    >
      {({ isActive }) => (
        <>
          <span {...stylex.props(styles.itemIcon, rail && styles.grown)}>
            {Glyph ? (
              <Glyph size={16} weight={isActive ? "fill" : "regular"} />
            ) : (
              mark
            )}
          </span>
          <span {...stylex.props(styles.itemLabel, rail && styles.labelOut)}>
            {children}
          </span>
          {trailing !== undefined && trailing !== null && (
            <span {...stylex.props(rail && styles.badge)}>{trailing}</span>
          )}
        </>
      )}
    </Link>
  );
  return (
    <Tooltip label={children} side="right" disabled={!rail}>
      {row}
    </Tooltip>
  );
}

function BoardMark({ id, name }: { id: string; name: string }) {
  return (
    <span aria-hidden {...stylex.props(styles.board, styles.tint(hueOf(id)))}>
      {firstGrapheme(name)}
    </span>
  );
}

function firstGrapheme(name: string) {
  const [first] = graphemes.segment(name.trim());
  return first?.segment.toUpperCase() ?? "?";
}

function ProfileMenu({
  member,
  rail,
  onOpen,
}: {
  member: Member;
  rail: boolean;
  onOpen: (dialog: ShellDialog) => void;
}) {
  const theme = useTheme();
  const client = useQueryClient();
  const navigate = useNavigate();
  return (
    <Menu
      width={240}
      side={rail ? "right" : "top"}
      align={rail ? "end" : "start"}
      trigger={
        <button
          type="button"
          aria-label={rail ? member.name : undefined}
          {...stylex.props(styles.me, rail && styles.meRail)}
        >
          <span {...stylex.props(styles.grows, rail && styles.grown)}>
            <Avatar person={member} size={22} />
          </span>
          {!rail && (
            <>
              <span {...stylex.props(styles.meName)}>{member.name}</span>
              <CaretUpDownIcon size={14} {...stylex.props(styles.faint)} />
            </>
          )}
        </button>
      }
    >
      <MenuItem
        icon={<UserCircleIcon size={14} />}
        onClick={() => {
          void navigate({
            to: "/people/$handle",
            params: { handle: member.handle },
          });
        }}
      >
        Your profile
      </MenuItem>
      {rail && (
        <MenuItem
          icon={<GearIcon size={14} />}
          onClick={() => {
            void navigate({ to: "/settings" });
          }}
        >
          Settings
        </MenuItem>
      )}
      <MenuSeparator />
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
        icon={<UsersIcon size={14} />}
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

const RAIL_TARGET = { width: 40, height: 36 };
const GROW = "scale(1.125)";
const REDUCED = "@media (prefers-reduced-motion: reduce)";

const styles = stylex.create({
  sidebar: {
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
    minHeight: 0,
    paddingBlock: space.md,
    paddingInline: space.md,
    overflowX: "hidden",
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
    transitionDuration: { default: motion.slow, [REDUCED]: "0s" },
    transitionTimingFunction: motion.out,
  },
  drawerOpen: {
    transform: { default: null, "@media (max-width: 860px)": "translateX(0)" },
  },
  head: { display: "flex", alignItems: "center", gap: space.xs },
  workspace: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    flexGrow: 1,
    minWidth: 0,
    height: 36,
    paddingInline: space.sm,
    borderRadius: radius.sm,
    color: color.fgMuted,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.uiHover },
    },
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
    outlineOffset: -2,
  },
  workspaceRail: {
    flexGrow: 0,
    ...RAIL_TARGET,
    paddingInline: 9,
  },
  mark: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: 22,
    height: 22,
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
    minWidth: 0,
    height: { default: 30, [media.touch]: 40 },
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
  searchRail: { flexGrow: 0, ...RAIL_TARGET, paddingInline: 13 },
  noShrink: { flexShrink: 0 },
  square: {
    display: "grid",
    placeItems: "center",
    width: { default: 30, [media.touch]: 40 },
    height: { default: 30, [media.touch]: 40 },
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
  grow: {
    flexGrow: 1,
    textAlign: "left",
    overflow: "hidden",
    whiteSpace: "nowrap",
  },
  group: { display: "flex", flexDirection: "column", gap: 1 },
  groupHead: {
    position: "relative",
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
    width: { default: 22, [media.touch]: 36 },
    height: { default: 22, [media.touch]: 36 },
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
  label: {
    whiteSpace: "nowrap",
    transitionProperty: "opacity",
    transitionDuration: motion.base,
    transitionDelay: { default: "80ms", [REDUCED]: "0s" },
    transitionTimingFunction: motion.out,
  },
  labelOut: {
    opacity: 0,
    transitionDuration: motion.fast,
    transitionDelay: "0s",
  },
  rule: {
    position: "absolute",
    top: "50%",
    left: 12,
    width: 16,
    height: 1,
    backgroundColor: color.line,
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: motion.base,
  },
  ruleIn: { opacity: 1 },
  item: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: space.md,
    height: { default: 28, [media.touch]: 40 },
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
    transitionProperty: "background-color, color, height, padding",
    transitionDuration: { default: motion.slow, [REDUCED]: "0s" },
    transitionTimingFunction: motion.out,
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
    outlineOffset: -2,
  },
  itemRail: { height: 36, paddingInline: 12 },
  grows: {
    display: "grid",
    placeItems: "center",
    transitionProperty: "transform",
    transitionDuration: { default: motion.slow, [REDUCED]: "0s" },
    transitionTimingFunction: motion.out,
  },
  grown: { transform: GROW },
  railTarget: { ...RAIL_TARGET },
  badge: {
    position: "absolute",
    top: 1,
    left: 22,
    transform: "scale(0.82)",
    transformOrigin: "left top",
    pointerEvents: "none",
  },
  itemIcon: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: 16,
    opacity: 0.9,
    transitionProperty: "transform",
    transitionDuration: { default: motion.slow, [REDUCED]: "0s" },
    transitionTimingFunction: motion.out,
  },
  board: {
    display: "grid",
    placeItems: "center",
    width: 16,
    height: 16,
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1,
  },
  tint: (hue: number) => ({
    color: `light-dark(oklch(0.38 0.09 ${hue}), oklch(0.9 0.06 ${hue}))`,
    backgroundColor: `light-dark(oklch(0.9 0.05 ${hue}), oklch(0.36 0.07 ${hue}))`,
  }),
  itemLabel: {
    flexGrow: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    transitionProperty: "opacity",
    transitionDuration: motion.base,
    transitionDelay: { default: "80ms", [REDUCED]: "0s" },
    transitionTimingFunction: motion.out,
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
  footerRail: { flexDirection: "column-reverse", alignItems: "center" },
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
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
    outlineOffset: -2,
  },
  meRail: { flexGrow: 0, ...RAIL_TARGET, paddingInline: 9 },
  meName: {
    flexGrow: 1,
    textAlign: "left",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  footerAction: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: { default: 28, [media.touch]: 40 },
    height: { default: 28, [media.touch]: 40 },
    borderRadius: radius.sm,
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
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
  },
  live: {
    display: "grid",
    placeItems: "center",
    width: 24,
    height: 24,
  },
});
