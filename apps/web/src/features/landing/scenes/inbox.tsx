import {
  ArrowCounterClockwiseIcon,
  AlarmIcon,
  CheckIcon,
  KanbanIcon,
  XIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { ReactNode } from "react";

import { AppWindow, Cursor } from "#features/landing/frame";
import { Collapse, Roll } from "#features/landing/motion";
import { pointAt, useScript } from "#features/landing/script";
import type { Point } from "#features/landing/script";
import { atlas, eric, grace, jean, scout } from "#features/landing/team";
import { Avatar } from "#ui/avatar";
import { color, font, radius, space, text } from "#ui/tokens.stylex";

import { CardNumber, PaneHeader, Pill, parts } from "./parts";
import type { SceneProps } from "./parts";

type State = {
  done: boolean;
  cursor: Point;
  shown: boolean;
  pressed: boolean;
  toast: boolean;
};

const START: State = {
  done: false,
  cursor: { x: 640, y: 120 },
  shown: false,
  pressed: false,
  toast: false,
};

const END: State = { ...START, done: true, toast: true };

/**
 * Inbox: the assignment that arrived on Home is open. You mark it done; it leaves the list, the
 * count drops, and the next item is already selected. There's no confirmation step: the toast
 * offers Undo instead. The agent's decision waits in its own group for the Agents section.
 */
export function InboxScene({ play, paused, still }: SceneProps) {
  const root = useRef<HTMLDivElement>(null);
  const [s, setS] = useState(still ? END : START);
  const set = (next: Partial<State>) => setS((now) => ({ ...now, ...next }));

  useScript(
    async (a) => {
      await a.wait(1500);
      const done = pointAt(root.current, "done", 0.7, 0.62);
      set({ shown: done !== null });
      await a.wait(150);
      if (done) {
        set({ cursor: done });
        await a.wait(1100);
        set({ pressed: true });
        await a.wait(140);
        set({ pressed: false });
      } else {
        await a.wait(800);
      }
      await a.wait(120);
      set({ done: true });
      await a.wait(500);
      set({ toast: true });
      await a.wait(900);
      if (done) {
        set({ cursor: { x: done.x + 40, y: done.y + 150 } });
      }
    },
    { running: play && !still, paused }
  );

  const open = s.done ? 3 : 4;
  return (
    <AppWindow nav="inbox" inbox={open}>
      <div ref={root} {...stylex.props(styles.root)}>
        <PaneHeader
          title="Inbox"
          note="No pings yet today, 4 at most"
          end={
            <span {...stylex.props(styles.tabs)}>
              <span {...stylex.props(styles.tab, styles.tabOn)}>
                Open <Roll value={open} />
              </span>
              <span {...stylex.props(styles.tab)}>Snoozed</span>
              <span {...stylex.props(styles.tab)}>Done</span>
            </span>
          }
        />
        <div {...stylex.props(styles.split)}>
          <div {...stylex.props(styles.list)}>
            <Group label="Needs a decision" count={1} />
            <Item
              who={<Avatar person={atlas} size={26} />}
              title="Atlas needs you: Postgres 18 upgrade plan ready, approve the maintenance window?"
              why="Agent needs a decision"
              tone="amber"
              when="8:12"
              on={false}
            />
            <Collapse open={!s.done} from="none">
              <Group label="For you" count={1} />
              <Item
                who={<Avatar person={jean} size={26} />}
                title={
                  <>
                    Jean Miller assigned you <CardNumber>8</CardNumber> Track
                    referral turnaround per county
                  </>
                }
                why="Assigned to you"
                tone="blue"
                when="9:40"
                on={!s.done}
              />
            </Collapse>
            <Group label="Updates" count={4} />
            <Item
              who={<Avatar person={grace} size={26} />}
              title={
                <>
                  New comments on <CardNumber>2</CardNumber> Agree on FHIR R4
                  profile for referral bundles
                </>
              }
              why="Card you follow"
              when="Yesterday"
              on={s.done}
            />
            <Item
              who={<Avatar person={atlas} size={26} />}
              title={
                <>
                  Atlas finished <CardNumber>4</CardNumber> SMS fallback when
                  the receiving clinic is offline
                </>
              }
              why="Agent finished"
              tone="green"
              when="Sat"
              on={false}
            />
            <Item
              who={<Avatar person={eric} size={26} />}
              title={
                <>
                  Eric Brooks closed <CardNumber>1</CardNumber> Referral form
                  loses attachments
                </>
              }
              why="Card you follow"
              when="Fri"
              on={false}
            />
            <Item
              who={<Avatar person={scout} size={26} />}
              title={
                <>
                  Scout found why <CardNumber>14</CardNumber> Nightly sync
                  stalls on the Denver server
                </>
              }
              why="Agent finished"
              tone="green"
              when="Thu"
              on={false}
            />
          </div>

          <div {...stylex.props(styles.detail)}>
            <div {...stylex.props(styles.page, s.done && styles.pageGone)}>
              <Assignment pressed={s.pressed} />
            </div>
            <div {...stylex.props(styles.page, !s.done && styles.pageWaiting)}>
              <Comment />
            </div>
          </div>
        </div>

        <div {...stylex.props(styles.toast, s.toast && styles.toastShown)}>
          <CheckIcon
            size={14}
            weight="bold"
            {...stylex.props(styles.toastIcon)}
          />
          <span>Marked done</span>
          <span {...stylex.props(styles.toastUndo)}>
            <ArrowCounterClockwiseIcon size={13} /> Undo
            <kbd {...stylex.props(styles.key)}>Z</kbd>
          </span>
        </div>
        <Cursor at={s.cursor} pressed={s.pressed} shown={s.shown} />
      </div>
    </AppWindow>
  );
}

function Comment() {
  return (
    <>
      <span {...stylex.props(styles.badges)}>
        <Pill tone="neutral">Card you follow</Pill>
      </span>
      <span {...stylex.props(styles.title)}>
        New comments on #2 Agree on FHIR R4 profile for referral bundles
      </span>
      <span {...stylex.props(styles.byline)}>
        <Avatar person={grace} size={18} />
        <span {...stylex.props(parts.strong)}>Grace Kim</span>
        <span {...stylex.props(parts.muted)}>· 2 comments</span>
      </span>
      <span {...stylex.props(styles.quote)}>
        I kept the profile to the five fields the county hospitals already send.
        Ready for your review.
      </span>
      <span {...stylex.props(styles.actions)}>
        <span {...stylex.props(parts.control)}>
          <CheckIcon size={14} /> Done{" "}
          <kbd {...stylex.props(styles.key)}>E</kbd>
        </span>
        <span {...stylex.props(parts.control)}>
          <AlarmIcon size={14} /> Snooze{" "}
          <kbd {...stylex.props(styles.key)}>H</kbd>
        </span>
      </span>
      <span {...stylex.props(styles.label)}>On the card</span>
      <span {...stylex.props(styles.card)}>
        <KanbanIcon size={14} {...stylex.props(parts.faint)} />
        <CardNumber>2</CardNumber>
        <span {...stylex.props(styles.grow)}>
          Agree on FHIR R4 profile for referral bundles
        </span>
        <Pill tone="amber">Review</Pill>
      </span>
    </>
  );
}

function Assignment({ pressed }: { pressed: boolean }) {
  return (
    <>
      <span {...stylex.props(styles.badges)}>
        <Pill tone="blue">Assigned to you</Pill>
      </span>
      <span {...stylex.props(styles.title)}>
        Jean Miller assigned you #8 Track referral turnaround per county
      </span>
      <span {...stylex.props(styles.byline)}>
        <Avatar person={jean} size={18} />
        <span {...stylex.props(parts.strong)}>Jean Miller</span>
        <span {...stylex.props(parts.muted)}>· Referrals lead</span>
      </span>
      <span {...stylex.props(styles.quote)}>
        The county leads want weekly numbers before the review on the 20th. Can
        you own this?
      </span>
      <span {...stylex.props(styles.actions)}>
        <span
          data-target="done"
          {...stylex.props(parts.control, pressed && parts.controlPressed)}
        >
          <CheckIcon size={14} /> Done{" "}
          <kbd {...stylex.props(styles.key)}>E</kbd>
        </span>
        <span {...stylex.props(parts.control)}>
          <AlarmIcon size={14} /> Snooze{" "}
          <kbd {...stylex.props(styles.key)}>H</kbd>
        </span>
        <span {...stylex.props(styles.quiet)}>
          <XIcon size={13} /> Dismiss <kbd {...stylex.props(styles.key)}>X</kbd>
        </span>
      </span>
      <span {...stylex.props(styles.label)}>On the card</span>
      <span {...stylex.props(styles.card)}>
        <KanbanIcon size={14} {...stylex.props(parts.faint)} />
        <CardNumber>8</CardNumber>
        <span {...stylex.props(styles.grow)}>
          Track referral turnaround per county
        </span>
        <Pill tone="neutral">Maybe?</Pill>
      </span>
    </>
  );
}

function Group({ label, count }: { label: string; count: number }) {
  return (
    <span {...stylex.props(styles.group)}>
      {label} <span {...stylex.props(parts.faint)}>{count}</span>
    </span>
  );
}

function Item({
  who,
  title,
  why,
  tone,
  when,
  on,
}: {
  who: ReactNode;
  title: ReactNode;
  why: string;
  tone?: "amber" | "blue" | "green";
  when: string;
  on: boolean;
}) {
  return (
    <div {...stylex.props(styles.item, on && styles.itemOn)}>
      {who}
      <span {...stylex.props(styles.itemText)}>
        <span {...stylex.props(styles.itemTitle)}>{title}</span>
        <span
          {...stylex.props(
            styles.why,
            tone === "amber" && styles.whyAmber,
            tone === "blue" && styles.whyBlue,
            tone === "green" && styles.whyGreen
          )}
        >
          {why}
        </span>
      </span>
      <span {...stylex.props(styles.when)}>{when}</span>
    </div>
  );
}

const styles = stylex.create({
  root: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    height: "100%",
  },
  tabs: {
    display: {
      default: "flex",
      "@media (max-width: 899px)": "none",
    },
    padding: space.xxs,
    borderRadius: radius.md,
    backgroundColor: color.ui,
  },
  tab: {
    display: "inline-flex",
    gap: space.xs,
    height: 24,
    alignItems: "center",
    paddingInline: space.md,
    borderRadius: radius.sm,
    fontSize: text.meta,
    color: color.fgMuted,
  },
  tabOn: {
    backgroundColor: color.raised,
    color: color.fg,
    fontWeight: 500,
    boxShadow: `0 0 0 1px ${color.line}`,
  },
  split: {
    display: "flex",
    flexGrow: 1,
    minHeight: 0,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    width: {
      default: 340,
      "@media (max-width: 899px)": "100%",
    },
    flexShrink: 0,
    paddingBlock: space.md,
    paddingInline: space.sm,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: color.line,
  },
  group: {
    display: "block",
    paddingTop: space.lg,
    paddingBottom: space.sm,
    paddingInline: space.md,
    fontSize: text.meta,
    fontWeight: 500,
    color: color.fgMuted,
  },
  item: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.lg,
    padding: space.md,
    borderRadius: radius.md,
    transitionProperty: "background-color",
    transitionDuration: "260ms",
  },
  itemOn: {
    backgroundColor: color.uiActive,
  },
  itemText: {
    display: "flex",
    flexDirection: "column",
    gap: space.xxs,
    flexGrow: 1,
    minWidth: 0,
  },
  itemTitle: {
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  why: {
    fontSize: text.meta,
    lineHeight: "16px",
    color: color.fgMuted,
  },
  whyAmber: {
    color: color.amberFg,
  },
  whyBlue: {
    color: color.blueFg,
  },
  whyGreen: {
    color: color.greenFg,
  },
  when: {
    flexShrink: 0,
    fontSize: text.meta,
    color: color.fgMuted,
  },
  detail: {
    position: "relative",
    display: {
      default: "block",
      "@media (max-width: 899px)": "none",
    },
    flexGrow: 1,
    minWidth: 0,
  },
  page: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    paddingTop: space.x3,
    paddingInline: space.x4,
    transitionProperty: "opacity, transform",
    transitionDuration: "320ms",
    transitionTimingFunction: "cubic-bezier(0.25, 0.8, 0.25, 1)",
    transitionDelay: "160ms",
  },
  pageGone: {
    opacity: 0,
    transform: "translateY(-8px)",
    pointerEvents: "none",
    transitionDuration: "140ms",
    transitionDelay: "0ms",
  },
  pageWaiting: {
    opacity: 0,
    transform: "translateY(8px)",
  },
  badges: {
    display: "flex",
    gap: space.sm,
  },
  title: {
    marginTop: space.lg,
    maxWidth: 440,
    fontSize: 19,
    lineHeight: "26px",
    fontWeight: 600,
    letterSpacing: "-0.01em",
  },
  byline: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    marginTop: space.md,
  },
  quote: {
    alignSelf: "stretch",
    marginTop: space.xl,
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    boxShadow: `inset 0 0 0 1px ${color.line}`,
  },
  actions: {
    display: "flex",
    alignItems: "center",
    alignSelf: "stretch",
    gap: space.md,
    marginTop: space.xl,
    paddingBottom: space.xl,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
  },
  key: {
    display: "inline-grid",
    placeItems: "center",
    minWidth: 18,
    height: 18,
    paddingInline: space.xs,
    borderRadius: radius.xs,
    backgroundColor: color.ui,
    color: color.fgMuted,
    fontFamily: font.mono,
    fontSize: text.caption,
    lineHeight: 1,
  },
  quiet: {
    display: "inline-flex",
    whiteSpace: "nowrap",
    alignItems: "center",
    gap: space.sm,
    paddingInline: space.sm,
    color: color.fgMuted,
  },
  label: {
    marginTop: space.xl,
    fontSize: text.meta,
    fontWeight: 500,
    color: color.fgMuted,
  },
  card: {
    display: "flex",
    alignItems: "center",
    alignSelf: "stretch",
    gap: space.md,
    marginTop: space.sm,
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderRadius: radius.md,
    boxShadow: `inset 0 0 0 1px ${color.line}`,
  },
  grow: {
    flexGrow: 1,
  },
  toast: {
    position: "absolute",
    right: space.xxl,
    bottom: 80,
    display: "flex",
    alignItems: "center",
    gap: space.md,
    height: 40,
    paddingInline: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.raised,
    boxShadow:
      "0 0 0 1px oklch(0.2 0.01 80 / 0.08), 0 8px 24px oklch(0.2 0.01 80 / 0.14)",
    opacity: 0,
    transform: "translateY(8px) scale(0.98)",
    transitionProperty: "opacity, transform",
    transitionDuration: "420ms",
    transitionTimingFunction: "cubic-bezier(0.25, 0.8, 0.25, 1)",
  },
  toastShown: {
    opacity: 1,
    transform: "none",
  },
  toastIcon: {
    color: color.greenFg,
  },
  toastUndo: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    marginLeft: space.md,
    color: color.fgMuted,
  },
});
