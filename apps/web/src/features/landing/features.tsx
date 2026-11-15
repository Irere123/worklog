import { HourglassMediumIcon, TicketIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Avatar } from "#ui/avatar";
import { Logo } from "#ui/logo";
import { ProductMark } from "#ui/product-mark";
import type { Product } from "#ui/product-mark";
import { color, font, radius, shadow, space, text } from "#ui/tokens.stylex";

import { Intro } from "./intro";
import { useInView, useReducedMotion } from "./script";
import { page, type } from "./styles";
import { atlas, grace, jean } from "./team";

type Person = typeof jean | typeof atlas;

/**
 * What Worklog does, one tile each: what needs you, the stream, the brief and the board. Every
 * tile holds an object from the product at its real size, and shows its point in its first
 * frame; motion only adds to it.
 */
export function Features() {
  return (
    <section id="features" {...stylex.props(page.wide, page.section)}>
      <Intro
        title={
          <>
            The tools write it.
            <br />
            Everyone can read it.
          </>
        }
        lede="Nobody reports status. Worklog keeps the record from the work itself, filters it, credits it and shows each person what’s theirs."
      />
      <div {...stylex.props(styles.grid)}>
        <Tile
          size="wide"
          title="Only what needs you"
          copy="Worklog pings you when something is blocked on you, and says why, within a daily budget you set. Everything else waits for your brief."
          at={0}
        >
          {() => <NeedsYou />}
        </Tile>
        <Tile
          title="Every tool, one stream"
          copy="GitHub, Slack, Discord and your agents in one feed, credited to the right person. Bot noise never reaches it."
          at={2}
        >
          {(on) => <Stream on={on} />}
        </Tile>
        <Tile
          title="A brief, not a feed"
          copy="Each morning: what moved, what’s stuck and what needs you, by email, Slack, Discord or webhook."
          at={3}
        >
          {() => <Brief />}
        </Tile>
        <Tile
          size="wide"
          title="A board that stays honest"
          copy="A golden ticket marks the one card that matters, instead of ranking them all. Cards nobody touches drift to Not now, and finished ones are stamped."
          at={4}
        >
          {(on) => <Board on={on} />}
        </Tile>
      </div>
    </section>
  );
}

function Tile({
  title,
  copy,
  badge,
  size = "third",
  at,
  children,
}: {
  title: string;
  copy: string;
  badge?: string;
  /** A third of the row, or two thirds for a lead. */
  size?: "third" | "wide";
  at: number;
  children: (on: boolean) => ReactNode;
}) {
  // Each tile watches itself: a whole grid is never a quarter on screen on a phone. Tiles that
  // arrive together still take turns across the row, so a row settles as one wave.
  const ref = useRef<HTMLElement>(null);
  const on = useInView(ref, { margin: "0px 0px -10% 0px", once: true });
  const [turn, setTurn] = useState(false);
  // With reduced motion every tile is simply finished: nothing waits to be scrolled to.
  const reduced = useReducedMotion();
  useEffect(() => {
    const timer = on
      ? setTimeout(() => setTurn(true), (at % 3) * 110)
      : undefined;
    return () => clearTimeout(timer);
  }, [on, at]);
  return (
    <article ref={ref} {...stylex.props(page.tile, styles.tile, styles[size])}>
      <div aria-hidden {...stylex.props(styles.art)}>
        {children(turn || reduced)}
      </div>
      <div {...stylex.props(styles.words)}>
        <h3 {...stylex.props(type.tileTitle, styles.title)}>
          {title}
          {badge && (
            <span {...stylex.props(type.chip, styles.badge)}>{badge}</span>
          )}
        </h3>
        <p {...stylex.props(type.tileCopy)}>{copy}</p>
      </div>
    </article>
  );
}

const WAITING: {
  who: Person;
  title: string;
  why: string;
  tone: "amber" | "blue" | "violet";
}[] = [
  {
    who: atlas,
    title: "Postgres 18 upgrade plan",
    why: "Needs a decision",
    tone: "amber",
  },
  {
    who: jean,
    title: "Track referral turnaround",
    why: "Assigned to you",
    tone: "blue",
  },
  {
    who: grace,
    title: "FHIR R4 profile for referrals",
    why: "Waiting on your review",
    tone: "violet",
  },
];

/** What needs you, and the budget that keeps it short: the promise the sign-in page shows too. */
export function NeedsYou() {
  return (
    <div {...stylex.props(styles.needs)}>
      <div {...stylex.props(styles.list)}>
        <span {...stylex.props(styles.listHead)}>
          Needs you <span {...stylex.props(styles.listCount)}>3</span>
        </span>
        {WAITING.map((item) => (
          <span key={item.title} {...stylex.props(styles.waiting)}>
            <Avatar person={item.who} size={20} />
            <span {...stylex.props(styles.waitingText)}>
              <span {...stylex.props(styles.waitingTitle)}>{item.title}</span>
              <span {...stylex.props(styles.why, styles[item.tone])}>
                {item.why}
              </span>
            </span>
          </span>
        ))}
      </div>
      <Budget />
    </div>
  );
}

const EVENTS: { product: Product | "agent"; text: string; noise: boolean }[] = [
  { product: "github", text: "Eric merged #212", noise: false },
  { product: "github", text: "dependabot bumped axios", noise: true },
  { product: "slack", text: "Grace: ship it Friday", noise: false },
  { product: "github", text: "CI passed on main", noise: true },
  { product: "agent", text: "Atlas opened #209", noise: false },
];

function Stream({ on }: { on: boolean }) {
  return (
    <div {...stylex.props(styles.stream)}>
      {EVENTS.map((event, at) => (
        <span
          key={event.text}
          {...stylex.props(styles.event, styles.delay(500 + at * 120))}
        >
          {event.product === "agent" ? (
            <Avatar person={atlas} size={14} />
          ) : (
            <ProductMark product={event.product} size={14} />
          )}
          <span
            {...stylex.props(
              styles.eventText,
              event.noise && on && styles.struck,
              styles.delay(500 + at * 120)
            )}
          >
            {event.text}
          </span>
        </span>
      ))}
    </div>
  );
}

const BRIEF = [
  { mark: "1", text: "needs you: approve Atlas’s plan", lead: true },
  { mark: "✓", text: "Shipped: SMS fallback (#4)", lead: false },
  { mark: "!", text: "Stuck: sync on the Denver server", lead: false },
];

function Brief() {
  return (
    <div {...stylex.props(styles.brief)}>
      <span {...stylex.props(styles.briefHead)}>
        <Logo size={16} />
        <span {...stylex.props(styles.briefTitle)}>Morning brief</span>
        <span {...stylex.props(styles.briefTime)}>8:00</span>
      </span>
      {BRIEF.map((line) => (
        <span key={line.text} {...stylex.props(styles.briefLine)}>
          <span
            {...stylex.props(styles.briefMark, line.lead && styles.briefLead)}
          >
            {line.mark}
          </span>
          {line.text}
        </span>
      ))}
    </div>
  );
}

function Board({ on }: { on: boolean }) {
  return (
    <div {...stylex.props(styles.board)}>
      <div {...stylex.props(styles.boardColumn, styles.boardMaybe)}>
        <span {...stylex.props(styles.boardHead)}>
          <span {...stylex.props(styles.boardDot, styles.dotViolet)} />
          Maybe?
        </span>
        <Drift on={on} fluid />
      </div>
      <div {...stylex.props(styles.boardColumn)}>
        <span {...stylex.props(styles.boardHead)}>
          <span {...stylex.props(styles.boardDot, styles.dotBlue)} />
          In progress
        </span>
        <Golden on={on} fluid />
      </div>
      <div {...stylex.props(styles.boardColumn)}>
        <span {...stylex.props(styles.boardHead)}>
          <span {...stylex.props(styles.boardDot, styles.dotGreen)} />
          Done
        </span>
        <Stamp on={on} fluid />
      </div>
    </div>
  );
}

function Golden({ on, fluid = false }: { on: boolean; fluid?: boolean }) {
  return (
    <div
      {...stylex.props(
        styles.card,
        fluid && styles.fluid,
        styles.golden,
        on && styles.goldenOn
      )}
    >
      <span {...stylex.props(styles.cardTop)}>
        <span
          {...stylex.props(styles.mono, styles.numberChip, styles.numberGolden)}
        >
          #1
        </span>
        <TicketIcon size={16} weight="fill" {...stylex.props(styles.ticket)} />
      </span>
      <span {...stylex.props(styles.cardTitle)}>
        Referral form loses attachments on slow connections
      </span>
    </div>
  );
}

function Drift({ on, fluid = false }: { on: boolean; fluid?: boolean }) {
  return (
    <div
      {...stylex.props(
        styles.card,
        fluid && styles.fluid,
        styles.drift,
        on && styles.driftOn
      )}
    >
      <span {...stylex.props(styles.cardTop)}>
        <span
          {...stylex.props(styles.mono, styles.numberChip, styles.numberFaded)}
        >
          #9
        </span>
        <span {...stylex.props(styles.countdown)}>
          <HourglassMediumIcon size={12} weight="fill" /> 3 days
        </span>
      </span>
      <span {...stylex.props(styles.cardTitle)}>
        Let receiving clinicians reply on a referral
      </span>
    </div>
  );
}

function Stamp({ on, fluid = false }: { on: boolean; fluid?: boolean }) {
  return (
    <div {...stylex.props(styles.card, fluid && styles.fluid)}>
      <span {...stylex.props(styles.cardTop)}>
        <span {...stylex.props(styles.mono, styles.numberChip)}>#12</span>
      </span>
      <span {...stylex.props(styles.cardTitle, styles.stamped)}>
        Search by patient ID
      </span>
      <span {...stylex.props(styles.stamp, on && styles.stampOn)}>
        <span {...stylex.props(styles.stampWord)}>Done</span>
        <span {...stylex.props(styles.stampDate)}>9 Nov</span>
      </span>
    </div>
  );
}

function Budget() {
  return (
    <div {...stylex.props(styles.budget)}>
      <span {...stylex.props(styles.budgetHead)}>
        <span>Pings today</span>
        <span {...stylex.props(styles.budgetCount)}>2 of 4</span>
      </span>
      <span {...stylex.props(styles.meter)}>
        {[0, 1, 2, 3].map((at) => (
          <span
            key={at}
            {...stylex.props(styles.segment, at < 2 && styles.segmentOn)}
          />
        ))}
      </span>
      <span {...stylex.props(styles.budgetNote)}>
        Everything else waits for 8:00
      </span>
    </div>
  );
}

const ARRIVE = "cubic-bezier(0.25, 0.8, 0.25, 1)";

const styles = stylex.create({
  // Six columns, so a row is a third and two thirds, or two halves.
  grid: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(6, minmax(0, 1fr))",
      "@media (max-width: 960px)": "repeat(2, minmax(0, 1fr))",
      "@media (max-width: 600px)": "minmax(0, 1fr)",
    },
    gap: space.md,
  },
  tile: {
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  third: {
    gridColumn: {
      default: "span 2",
      "@media (max-width: 960px)": "span 1",
    },
  },
  wide: {
    gridColumn: {
      default: "span 4",
      "@media (max-width: 960px)": "span 2",
      "@media (max-width: 600px)": "span 1",
    },
  },
  board: {
    display: "flex",
    gap: space.lg,
    width: "100%",
    maxWidth: 640,
  },
  boardColumn: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
  },
  // A phone keeps two columns of the board, so no card's words are cut.
  boardMaybe: {
    display: {
      default: "flex",
      "@media (max-width: 600px)": "none",
    },
  },
  boardHead: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    paddingInline: space.xs,
    fontSize: text.meta,
    fontWeight: 600,
    color: color.fg,
  },
  boardDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
  },
  dotViolet: { backgroundColor: color.violet },
  dotBlue: { backgroundColor: color.blue },
  dotGreen: { backgroundColor: color.green },
  fluid: {
    width: "auto",
  },
  delay: (ms: number) => ({
    transitionDelay: `${ms}ms`,
  }),
  art: {
    display: "grid",
    placeItems: "center",
    // A phone gives each picture the height it needs, from a floor, so a taller one (the AI
    // tile's two panels) never runs into its own title.
    height: {
      default: 200,
      "@media (max-width: 600px)": "auto",
    },
    minHeight: {
      default: 0,
      "@media (max-width: 600px)": 156,
    },
    paddingBlock: {
      default: 0,
      "@media (max-width: 600px)": space.x3,
    },
    paddingInline: space.xl,
  },
  words: {
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
    padding: space.xl,
  },
  title: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
  },
  badge: {
    marginLeft: "auto",
  },
  mono: {
    fontFamily: font.mono,
    fontWeight: 400,
  },
  card: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    width: 220,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.raised,
    boxShadow: shadow.object,
    textAlign: "start",
    transitionProperty: "opacity, transform, box-shadow, background-color",
    transitionDuration: "900ms",
    transitionTimingFunction: ARRIVE,
  },
  golden: {
    transform: "rotate(-2deg)",
  },
  goldenOn: {
    backgroundColor: "oklch(0.95 0.08 88)",
    boxShadow: `0 0 0 1px ${color.gold}, 0 8px 20px oklch(0.78 0.15 82 / 0.35)`,
    transform: "rotate(-2deg) translateY(-3px)",
  },
  ticket: {
    color: color.goldFg,
  },
  drift: {
    opacity: 1,
  },
  // Faded enough to read as drifting, not so far that its words stop being legible.
  driftOn: {
    opacity: 0.8,
    transform: "translateY(6px) scale(0.985)",
    transitionDuration: "2400ms",
    transitionDelay: "500ms",
  },
  cardTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  numberChip: {
    display: "inline-flex",
    alignItems: "center",
    height: 20,
    paddingInline: space.sm,
    borderRadius: radius.xs,
    backgroundColor: "oklch(0 0 0 / 0.05)",
    fontSize: text.meta,
    color: color.fgMuted,
  },
  // The card it sits on is already faded, so its number starts a step darker to stay legible.
  numberFaded: {
    color: color.fg,
  },
  numberGolden: {
    color: color.goldFg,
  },
  countdown: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xxs,
    fontSize: text.caption,
    fontWeight: 500,
    color: color.fg,
  },
  cardTitle: {
    fontSize: text.label,
    lineHeight: "19px",
    fontWeight: 500,
    textWrap: "balance",
  },
  // A phone's card is too narrow to share its title's line with the stamp, so the stamp moves up
  // beside the card's number and the title gets the whole width.
  stamped: {
    paddingRight: {
      default: 64,
      "@media (max-width: 600px)": 0,
    },
  },
  stamp: {
    position: "absolute",
    right: 12,
    top: {
      default: "auto",
      "@media (max-width: 600px)": 8,
    },
    bottom: {
      default: 10,
      "@media (max-width: 600px)": "auto",
    },
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingBlock: 2,
    paddingInline: space.sm,
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: color.green,
    borderRadius: radius.xs,
    color: color.greenFg,
    lineHeight: 1.1,
    opacity: 0,
    transform: "rotate(-7deg) scale(1.8)",
    transitionProperty: "opacity, transform",
    transitionDuration: "320ms",
    transitionDelay: "600ms",
    transitionTimingFunction: "cubic-bezier(0.3, 1.5, 0.6, 1)",
  },
  stampOn: {
    opacity: 1,
    transform: "rotate(-7deg) scale(1)",
  },
  stampWord: {
    fontSize: text.label,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  // Up beside the number on a phone, the stamp keeps to one line: the date would reach the title.
  stampDate: {
    display: {
      default: "inline",
      "@media (max-width: 600px)": "none",
    },
    fontSize: 10,
    fontWeight: 500,
  },
  budget: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    width: "100%",
    maxWidth: 220,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.raised,
    boxShadow: shadow.object,
  },
  budgetHead: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: text.label,
    fontWeight: 500,
  },
  budgetCount: {
    color: color.fgMuted,
    fontVariantNumeric: "tabular-nums",
  },
  meter: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: space.xs,
  },
  segment: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: color.lineUi,
    transitionProperty: "background-color",
    transitionDuration: "300ms",
  },
  segmentOn: {
    backgroundColor: color.accent,
  },
  budgetNote: {
    fontSize: text.meta,
    color: color.fgMuted,
  },
  needs: {
    display: "flex",
    flexDirection: {
      default: "row",
      "@media (max-width: 600px)": "column",
    },
    alignItems: "center",
    justifyContent: "center",
    gap: space.lg,
    width: "100%",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    width: "100%",
    maxWidth: 280,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.raised,
    boxShadow: shadow.object,
    textAlign: "start",
  },
  listHead: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    fontSize: text.meta,
    fontWeight: 600,
  },
  listCount: {
    display: "grid",
    placeItems: "center",
    minWidth: 18,
    height: 18,
    paddingInline: space.xs,
    borderRadius: radius.full,
    backgroundColor: color.accent,
    color: color.fgOnSolid,
    fontSize: text.caption,
  },
  waiting: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.md,
  },
  waitingText: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  waitingTitle: {
    overflow: "hidden",
    fontSize: text.label,
    lineHeight: "17px",
    fontWeight: 500,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  amber: { color: color.amberFg },
  blue: { color: color.blueFg },
  violet: { color: color.violetFg },
  why: {
    fontSize: text.caption,
    lineHeight: "15px",
    fontWeight: 500,
  },
  stream: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    maxWidth: 240,
    paddingBlock: space.xs,
    paddingInline: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.raised,
    boxShadow: shadow.object,
    textAlign: "start",
  },
  event: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    height: 30,
    borderTopWidth: {
      default: 1,
      ":first-child": 0,
    },
    borderTopStyle: "solid",
    borderTopColor: color.line,
    fontSize: text.meta,
  },

  eventText: {
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    textDecorationLine: "none",
    textDecorationColor: color.fgMuted,
    transitionProperty: "color",
    transitionDuration: "600ms",
  },
  // Noise is struck out, not hidden: the point is seeing it left out. Grey, not faded, so it
  // stays legible.
  struck: {
    color: color.fgMuted,
    textDecorationLine: "line-through",
  },
  brief: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    width: "100%",
    maxWidth: 250,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.raised,
    boxShadow: shadow.object,
    textAlign: "start",
  },
  briefHead: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
  },
  briefTitle: {
    flexGrow: 1,
    fontSize: text.meta,
    fontWeight: 600,
  },
  briefTime: {
    fontSize: text.caption,
    color: color.fgMuted,
  },
  briefLine: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    fontSize: text.meta,
    lineHeight: "16px",
  },
  briefMark: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: 16,
    height: 16,
    borderRadius: radius.full,
    backgroundColor: color.ui,
    color: color.fgMuted,
    fontSize: 10,
    fontWeight: 600,
  },
  briefLead: {
    backgroundColor: color.accent,
    color: color.fgOnSolid,
  },
});
