import {
  ArrowRightIcon,
  ArrowUpIcon,
  MicrophoneIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { ReactNode } from "react";

import { AppWindow, Cursor } from "#features/landing/frame";
import { Collapse, Roll } from "#features/landing/motion";
import { pointAt, useScript } from "#features/landing/script";
import type { Point } from "#features/landing/script";
import { atlas, grace, jean } from "#features/landing/team";
import { Avatar } from "#ui/avatar";
import { Ghost } from "#ui/ghost";
import { color, radius, space, text } from "#ui/tokens.stylex";

import { CardNumber, parts } from "./parts";
import type { SceneProps } from "./parts";

type State = {
  arrived: boolean;
  cursor: Point;
  shown: boolean;
  pressed: boolean;
  hover: boolean;
};

const START: State = {
  arrived: false,
  cursor: { x: 520, y: 470 },
  shown: false,
  pressed: false,
  hover: false,
};

// The finished frame: what someone with reduced motion sees, and the beat the story builds to.
const END: State = { ...START, arrived: true };

/**
 * Home: a new assignment arrives while you look, the count that waits on you rolls from three
 * to four, and you open it, which is where the Inbox chapter begins.
 */
export function HomeScene({ play, paused, still }: SceneProps) {
  const root = useRef<HTMLDivElement>(null);
  const [s, setS] = useState(still ? END : START);
  const set = (next: Partial<State>) => setS((now) => ({ ...now, ...next }));

  useScript(
    async (a) => {
      await a.wait(1400);
      set({ arrived: true });
      await a.wait(2200);
      const assigned = pointAt(root.current, "assigned", 0.62, 0.55);
      set({ shown: assigned !== null });
      await a.wait(200);
      set({ cursor: assigned ?? START.cursor });
      await a.wait(760);
      set({ hover: true });
      await a.wait(700);
      set({ pressed: true });
      await a.wait(140);
      set({ pressed: false });
    },
    { running: play && !still, paused }
  );

  const count = s.arrived ? 4 : 3;
  return (
    <AppWindow nav="home" inbox={count}>
      <div ref={root} {...stylex.props(styles.page)}>
        <div {...stylex.props(styles.column)}>
          <span {...stylex.props(styles.date)}>Monday 9 November</span>
          <span {...stylex.props(styles.greeting)}>Good morning, Ada</span>
          <span {...stylex.props(styles.lede)}>
            <span {...stylex.props(styles.underline)}>
              <Roll value={count} /> things need you
            </span>
            , including a decision for Atlas.
            <br />
            <span {...stylex.props(parts.muted)}>
              Jean and Grace moved 5 cards since Friday.
            </span>
          </span>

          <div {...stylex.props(styles.composer)}>
            <span {...stylex.props(parts.faint)}>
              Ask about the team’s work…
            </span>
            <span {...stylex.props(styles.composerFoot)}>
              <Ghost size={14} still />
              <span {...stylex.props(styles.composerHint)}>
                Your assistant answers from the team’s activity
              </span>
              <MicrophoneIcon size={15} {...stylex.props(parts.faint)} />
              <span {...stylex.props(styles.send)}>
                <ArrowUpIcon size={13} weight="bold" />
              </span>
            </span>
          </div>

          <div {...stylex.props(styles.sectionHead)}>
            <span {...stylex.props(parts.strong)}>Needs you</span>
            <span {...stylex.props(styles.link)}>
              Inbox <ArrowRightIcon size={12} />
            </span>
          </div>

          <Collapse open={s.arrived}>
            <Row
              target="assigned"
              hover={s.hover}
              who={<Avatar person={jean} size={24} />}
              title={
                <>
                  Jean Habimana assigned you{" "}
                  <CardNumber sx={styles.inline}>8</CardNumber> Track referral
                  turnaround per district
                </>
              }
              why="Assigned to you"
              when="Just now"
              fresh
            />
          </Collapse>
          <Row
            who={<Avatar person={atlas} size={24} />}
            title="Atlas needs you: Postgres 18 upgrade plan ready, approve the maintenance window?"
            why="Agent needs a decision"
            when="8:12"
            urgent
          />
          <Row
            who={<Avatar person={grace} size={24} />}
            title={
              <>
                New comments on <CardNumber sx={styles.inline}>2</CardNumber>{" "}
                Agree on FHIR R4 profile for referral bundles
              </>
            }
            why="Card you follow"
            when="Yesterday"
          />
          <Row
            who={<Avatar person={atlas} size={24} />}
            title="Atlas finished: SMS fallback queues messages until the clinic is back"
            why="Agent finished"
            when="Sat"
          />
        </div>
        <Cursor at={s.cursor} pressed={s.pressed} shown={s.shown} />
      </div>
    </AppWindow>
  );
}

function Row({
  who,
  title,
  why,
  when,
  urgent = false,
  fresh = false,
  hover = false,
  target,
}: {
  who: ReactNode;
  title: ReactNode;
  why: string;
  when: string;
  urgent?: boolean;
  fresh?: boolean;
  hover?: boolean;
  target?: string;
}) {
  return (
    <div
      data-target={target}
      {...stylex.props(styles.row, hover && styles.rowHover)}
    >
      {who}
      <span {...stylex.props(styles.rowText)}>
        <span {...stylex.props(styles.title)}>{title}</span>
        <span {...stylex.props(styles.why, fresh && styles.whyFresh)}>
          {why}
        </span>
      </span>
      {urgent && <span {...stylex.props(styles.dot)} />}
      <span {...stylex.props(styles.when)}>{when}</span>
    </div>
  );
}

const styles = stylex.create({
  page: {
    position: "relative",
    height: "100%",
    paddingTop: {
      default: 56,
      "@media (max-width: 719px)": space.x3,
    },
    paddingInline: {
      default: space.x3,
      "@media (max-width: 719px)": space.xl,
    },
  },
  column: {
    display: "flex",
    flexDirection: "column",
    maxWidth: 600,
    marginInline: "auto",
  },
  date: {
    fontSize: text.label,
    color: color.fgMuted,
  },
  greeting: {
    marginTop: space.xs,
    fontSize: 28,
    lineHeight: "36px",
    fontWeight: 600,
    letterSpacing: "-0.02em",
  },
  lede: {
    marginTop: space.sm,
    fontSize: 15,
    lineHeight: "23px",
  },
  underline: {
    // A border rather than text-decoration: the rolling digit is its own box, which an
    // underline wouldn't cross.
    paddingBottom: 1,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.lineStrong,
  },
  composer: {
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
    marginTop: space.x3,
    paddingTop: space.lg,
    paddingBottom: space.md,
    paddingInline: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.raised,
    boxShadow: `0 0 0 1px ${color.line}, 0 1px 2px light-dark(oklch(0.2 0.01 80 / 0.05), oklch(0 0 0 / 0.3))`,
  },
  composerFoot: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    color: color.fgMuted,
  },
  composerHint: {
    flexGrow: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: text.meta,
  },
  send: {
    display: "grid",
    placeItems: "center",
    width: 26,
    height: 26,
    borderRadius: radius.full,
    backgroundColor: color.ui,
    color: color.fgMuted,
  },
  sectionHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 36,
    marginBottom: space.sm,
  },
  link: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    fontSize: text.meta,
    color: color.fgMuted,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: space.lg,
    marginInline: `calc(${space.md} * -1)`,
    paddingBlock: space.md,
    paddingInline: space.md,
    borderRadius: radius.md,
    transitionProperty: "background-color",
    transitionDuration: "150ms",
  },
  rowHover: {
    backgroundColor: color.uiHover,
  },
  title: {
    display: "-webkit-box",
    WebkitLineClamp: {
      default: 1,
      "@media (max-width: 719px)": 2,
    },
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  rowText: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minWidth: 0,
  },
  why: {
    fontSize: text.meta,
    lineHeight: "16px",
    color: color.fgMuted,
  },
  whyFresh: {
    color: color.accentFg,
  },
  dot: {
    width: 7,
    height: 7,
    flexShrink: 0,
    borderRadius: radius.full,
    backgroundColor: color.amber,
  },
  when: {
    flexShrink: 0,
    fontSize: text.meta,
    color: color.fgMuted,
    fontVariantNumeric: "tabular-nums",
  },
  inline: {
    fontSize: "inherit",
  },
});
