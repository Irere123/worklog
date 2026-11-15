import {
  CaretUpDownIcon,
  FootprintsIcon,
  HouseIcon,
  KanbanIcon,
  ListIcon,
  MagnifyingGlassIcon,
  NewspaperIcon,
  NotePencilIcon,
  TrayIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { Avatar } from "#ui/avatar";
import { Ghost } from "#ui/ghost";
import { Logo } from "#ui/logo";
import { color, font, radius, space, text } from "#ui/tokens.stylex";

import { Roll } from "./motion";
import type { Point } from "./script";
import { WORKSPACE, ada } from "./team";

export type Nav =
  | "home"
  | "inbox"
  | "assistant"
  | "activity"
  | "briefs"
  | "people"
  | "referrals"
  | "platform";

/**
 * Worklog's own window in miniature: the real sidebar, in the real order, beside a page. Drawn
 * from the app's tokens, so it looks as the app does.
 */
export function AppWindow({
  nav,
  inbox,
  children,
  overlay,
  sx,
}: {
  nav: Nav;
  inbox: number;
  children: ReactNode;
  /** A satellite laid over the window's chrome rather than the page, such as a delivered brief. */
  overlay?: ReactNode;
  sx?: StyleXStyles;
}) {
  return (
    <div {...stylex.props(styles.window, sx)}>
      <aside {...stylex.props(styles.sidebar)}>
        <div {...stylex.props(styles.lights)} aria-hidden>
          <span {...stylex.props(styles.light, styles.close)} />
          <span {...stylex.props(styles.light, styles.minimise)} />
          <span {...stylex.props(styles.light, styles.zoom)} />
        </div>
        <div {...stylex.props(styles.workspace)}>
          <Logo size={20} />
          <span {...stylex.props(styles.workspaceName)}>{WORKSPACE}</span>
          <CaretUpDownIcon size={12} {...stylex.props(styles.faint)} />
        </div>
        <div {...stylex.props(styles.actions)}>
          <span {...stylex.props(styles.search)}>
            <MagnifyingGlassIcon size={13} />
            <span {...stylex.props(styles.grow)}>Search…</span>
            <kbd {...stylex.props(styles.kbd)}>⌘K</kbd>
          </span>
          <span {...stylex.props(styles.square)}>
            <NotePencilIcon size={14} />
          </span>
        </div>
        <div {...stylex.props(styles.group)}>
          <Item icon={HouseIcon} on={nav === "home"}>
            Home
          </Item>
          <Item
            icon={TrayIcon}
            on={nav === "inbox"}
            trailing={
              inbox > 0 ? (
                <span {...stylex.props(styles.count)}>
                  <Roll value={inbox} />
                </span>
              ) : null
            }
          >
            Inbox
          </Item>
          <Item ghost on={nav === "assistant"}>
            Assistant
          </Item>
        </div>
        <div {...stylex.props(styles.group)}>
          <span {...stylex.props(styles.groupHead)}>Team</span>
          <Item icon={FootprintsIcon} on={nav === "activity"}>
            Activity
          </Item>
          <Item icon={NewspaperIcon} on={nav === "briefs"}>
            Briefs
          </Item>
          <Item icon={UsersIcon} on={nav === "people"}>
            People
          </Item>
        </div>
        <div {...stylex.props(styles.group)}>
          <span {...stylex.props(styles.groupHead)}>Boards</span>
          <Item icon={KanbanIcon} on={nav === "referrals"}>
            Referrals
          </Item>
          <Item icon={KanbanIcon} on={nav === "platform"}>
            Platform
          </Item>
        </div>
        <div {...stylex.props(styles.me)}>
          <Avatar person={ada} size={20} />
          <span>{ada.name}</span>
        </div>
      </aside>
      {/* On a phone the app trades its sidebar for this bar, so the miniature does too. */}
      <div {...stylex.props(styles.mobileBar)}>
        <ListIcon size={18} />
        <Logo size={20} />
        <span {...stylex.props(styles.workspaceName)}>{WORKSPACE}</span>
        <MagnifyingGlassIcon size={18} />
        <span {...stylex.props(styles.mobileInbox)}>
          <TrayIcon size={18} />
          {inbox > 0 && (
            <span {...stylex.props(styles.count, styles.mobileCount)}>
              <Roll value={inbox} />
            </span>
          )}
        </span>
      </div>
      <div {...stylex.props(styles.pane)}>
        <div {...stylex.props(styles.page)}>{children}</div>
      </div>
      {overlay}
    </div>
  );
}

function Item({
  icon: Glyph,
  ghost = false,
  on,
  trailing,
  children,
}: {
  icon?: Icon;
  ghost?: boolean;
  on: boolean;
  trailing?: ReactNode;
  children: string;
}) {
  return (
    <span {...stylex.props(styles.item, on && styles.itemOn)}>
      {ghost ? (
        <Ghost size={14} still />
      ) : (
        Glyph && <Glyph size={14} weight={on ? "fill" : "regular"} />
      )}
      <span {...stylex.props(styles.grow)}>{children}</span>
      {trailing}
    </span>
  );
}

/** The macOS arrow, from Stageshow's kit (MIT), with its hotspot at the tip. */
export function Cursor({
  at,
  pressed,
  shown,
  travel = 700,
}: {
  at: Point;
  pressed: boolean;
  shown: boolean;
  travel?: number;
}) {
  return (
    <div
      aria-hidden
      {...stylex.props(
        styles.cursor,
        shown && styles.cursorShown,
        styles.at(at.x, at.y, travel)
      )}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 32 32"
        fill="none"
        {...stylex.props(styles.arrow, pressed && styles.pressed)}
      >
        <g transform="translate(10 7)">
          <path
            d="m6.148 18.473 1.863-1.003 1.615-.839-2.568-4.816h4.332l-11.379-11.408v16.015l3.316-3.221z"
            fill="#fff"
          />
          <path
            d="m6.431 17 1.765-.941-2.775-5.202h3.604l-8.025-8.043v11.188l2.53-2.442z"
            fill="#000"
          />
        </g>
      </svg>
    </div>
  );
}

/** A wallpaper for a product shot to sit on: grain and color, like a desktop behind a window. */
export function Plate({
  src,
  choices,
  priority = false,
  children,
  sx,
}: {
  src: string;
  /** Near the top of the page: fetch the shown wallpaper first, rather than when scrolled to. */
  priority?: boolean;
  /** Every wallpaper it may show, laid in place up front so a change crossfades instead of cutting. */
  choices?: string[];
  children: ReactNode;
  sx?: StyleXStyles;
}) {
  return (
    <div {...stylex.props(styles.plate, sx)}>
      {(choices ?? [src]).map((each) => (
        <img
          key={each}
          src={each}
          alt=""
          decoding="async"
          loading={priority && each === src ? "eager" : "lazy"}
          fetchPriority={priority && each === src ? "high" : "auto"}
          {...stylex.props(styles.plateImage, each !== src && styles.plateAway)}
        />
      ))}
      {children}
    </div>
  );
}

const TRAVEL = "cubic-bezier(0.45, 0, 0.1, 1)";

const styles = stylex.create({
  window: {
    position: "relative",
    display: "flex",
    flexDirection: {
      default: "row",
      "@media (max-width: 719px)": "column",
    },
    overflow: "hidden",
    backgroundColor: color.sidebar,
    borderRadius: radius.lg,
    boxShadow:
      "0 0 0 1px oklch(0.2 0.01 80 / 0.12), 0 12px 32px oklch(0.2 0.02 60 / 0.18), 0 40px 80px oklch(0.2 0.02 60 / 0.16)",
    fontFamily: font.sans,
    fontSize: text.label,
    lineHeight: "20px",
    color: color.fg,
    textAlign: "start",
    userSelect: "none",
    // The demo sits inside someone's page: its own type never inherits the page's headings.
    letterSpacing: "normal",
  },
  sidebar: {
    display: {
      default: "flex",
      "@media (max-width: 719px)": "none",
    },
    flexDirection: "column",
    gap: space.lg,
    width: 204,
    flexShrink: 0,
    paddingBlock: space.lg,
    paddingInline: space.md,
  },
  lights: {
    display: "flex",
    gap: space.md,
    paddingInline: space.xs,
    paddingBottom: space.xxs,
  },
  light: {
    width: 12,
    height: 12,
    borderRadius: radius.full,
    boxShadow: "inset 0 0 0 0.5px oklch(0 0 0 / 0.12)",
  },
  close: { backgroundColor: "#ff5f57" },
  minimise: { backgroundColor: "#febc2e" },
  zoom: { backgroundColor: "#28c840" },
  workspace: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    paddingInline: space.xs,
    fontWeight: 600,
  },
  workspaceName: {
    flexGrow: 1,
    color: color.fg,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  faint: {
    color: color.fgFaint,
  },
  actions: {
    display: "flex",
    gap: space.sm,
  },
  search: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    flexGrow: 1,
    height: 28,
    paddingInline: space.md,
    borderRadius: radius.md,
    backgroundColor: color.raised,
    boxShadow: `inset 0 0 0 1px ${color.line}`,
    color: color.fgFaint,
  },
  kbd: {
    fontFamily: font.mono,
    fontSize: text.caption,
    color: color.fgFaint,
  },
  square: {
    display: "grid",
    placeItems: "center",
    width: 28,
    height: 28,
    flexShrink: 0,
    borderRadius: radius.md,
    backgroundColor: color.raised,
    boxShadow: `inset 0 0 0 1px ${color.line}`,
    color: color.fgMuted,
  },
  group: {
    display: "flex",
    flexDirection: "column",
    gap: space.xxs,
  },
  groupHead: {
    paddingInline: space.md,
    paddingBottom: space.xxs,
    fontSize: text.meta,
    fontWeight: 500,
    color: color.fgFaint,
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    height: 28,
    paddingInline: space.md,
    borderRadius: radius.md,
    color: color.fgMuted,
    transitionProperty: "background-color, color",
    transitionDuration: "200ms",
  },
  itemOn: {
    backgroundColor: color.uiActive,
    color: color.fg,
    fontWeight: 500,
  },
  grow: {
    flexGrow: 1,
    minWidth: 0,
  },
  count: {
    display: "grid",
    placeItems: "center",
    minWidth: 18,
    height: 18,
    paddingInline: space.xs,
    borderRadius: radius.full,
    backgroundColor: color.accent,
    color: color.fgOnSolid,
    fontSize: text.caption,
    fontWeight: 600,
    lineHeight: "18px",
  },
  me: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    marginTop: "auto",
    paddingInline: space.sm,
    fontWeight: 500,
  },
  mobileBar: {
    display: {
      default: "none",
      "@media (max-width: 719px)": "flex",
    },
    alignItems: "center",
    gap: space.lg,
    flexShrink: 0,
    height: 48,
    paddingInline: space.lg,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
    color: color.fgMuted,
    fontWeight: 600,
  },
  mobileInbox: {
    position: "relative",
    display: "flex",
  },
  mobileCount: {
    position: "absolute",
    top: -6,
    right: -8,
    boxShadow: `0 0 0 2px ${color.sidebar}`,
  },
  pane: {
    position: "relative",
    flexGrow: 1,
    minWidth: 0,
    margin: {
      default: space.sm,
      "@media (max-width: 719px)": 0,
    },
    marginLeft: {
      default: 0,
      "@media (max-width: 719px)": 0,
    },
    overflow: "hidden",
    backgroundColor: color.bg,
    borderRadius: {
      default: radius.md,
      "@media (max-width: 719px)": 0,
    },
    boxShadow: `0 0 0 1px ${color.line}`,
  },
  // A new chapter changes only the page: the window and its sidebar stay solid, as in the app.
  page: {
    height: "100%",
    animationName: stylex.keyframes({
      from: { opacity: 0, transform: "translateY(8px)" },
      to: { opacity: 1, transform: "none" },
    }),
    animationDuration: "360ms",
    animationTimingFunction: "cubic-bezier(0.25, 0.8, 0.25, 1)",
  },
  cursor: {
    position: "absolute",
    top: 0,
    left: 0,
    zIndex: 5,
    width: 24,
    height: 24,
    // The arrow's tip sits at (10, 7) of its 32-unit box, drawn at 24px.
    marginTop: -5,
    marginLeft: -7.5,
    opacity: 0,
    pointerEvents: "none",
    transitionProperty: "opacity",
    transitionDuration: "300ms",
  },
  cursorShown: {
    opacity: 1,
  },
  at: (x: number, y: number, travel: number) => ({
    transform: `translate(${x}px, ${y}px)`,
    transition: `transform ${travel}ms ${TRAVEL}, opacity 300ms ease`,
  }),
  arrow: {
    display: "block",
    filter: "drop-shadow(0 1px 1.5px oklch(0 0 0 / 0.3))",
    transformOrigin: "30% 20%",
    transitionProperty: "transform",
    transitionDuration: "120ms",
  },
  pressed: {
    transform: "scale(0.86)",
  },
  plate: {
    position: "relative",
    overflow: "hidden",
    isolation: "isolate",
    borderRadius: 20,
    backgroundColor: color.ui,
  },
  plateImage: {
    position: "absolute",
    inset: 0,
    zIndex: -1,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transitionProperty: "opacity",
    transitionDuration: "700ms",
    transitionTimingFunction: "ease",
  },
  plateAway: {
    opacity: 0,
  },
});
