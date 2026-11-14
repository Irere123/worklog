import {
  ArrowBendDownRightIcon,
  CheckIcon,
  HourglassMediumIcon,
  KeyIcon,
  LightbulbIcon,
  LockSimpleIcon,
  MicrophoneIcon,
  TicketIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Avatar } from "#ui/avatar";
import { Logo } from "#ui/logo";
import { ProductMark } from "#ui/product-mark";
import type { Product } from "#ui/product-mark";
import { color, font, radius, space, text } from "#ui/tokens.stylex";

import { useInView } from "./script";
import { page, type } from "./styles";
import { eric } from "./team";

/**
 * The small things that make Worklog itself, one tile each. Every tile holds one object from the
 * product at its real size, and does one small thing as the grid scrolls in.
 */
export function Features() {
  return (
    <section id="features" {...stylex.props(page.wide, page.section)}>
      <div {...stylex.props(page.intro)}>
        <h2 {...stylex.props(type.heading)}>
          The tools write it.
          <br />
          Everyone can read it.
        </h2>
        <p {...stylex.props(type.lede, styles.lede)}>
          Nobody reports status. Worklog keeps the record from the work itself,
          filters it, credits it and shows each person what’s theirs.
        </p>
      </div>
      <div {...stylex.props(styles.grid)}>
        <Tile
          title="Connect in a click"
          copy="GitHub and Slack install in one step and bring their recent history with them."
          at={0}
        >
          {(on) => <Marks on={on} />}
        </Tile>
        <Tile
          title="Noise left out"
          copy="Bot comments, CI pings and duplicates never reach the stream."
          at={1}
        >
          {(on) => <Noise on={on} />}
        </Tile>
        <Tile
          title="One person, every handle"
          copy="GitHub, Slack and Discord names resolve to the teammate behind them."
          at={2}
        >
          {(on) => <Handles on={on} />}
        </Tile>
        <Tile
          title="Golden tickets"
          copy="Mark the one card that matters instead of ranking all of them."
          at={3}
        >
          {(on) => <Golden on={on} />}
        </Tile>
        <Tile
          title="Cards drift"
          copy="Cards nobody touches fade to Not now instead of rotting on the board."
          at={4}
        >
          {(on) => <Drift on={on} />}
        </Tile>
        <Tile
          title="Stamped when it’s done"
          copy="Closing a card stamps it, so finished looks finished."
          at={5}
        >
          {(on) => <Stamp on={on} />}
        </Tile>
        <Tile
          title="A budget for pings"
          copy="Only what’s blocked on you interrupts, up to a limit you set. The rest waits for your brief."
          at={6}
        >
          {(on) => <Budget on={on} />}
        </Tile>
        <Tile
          title="Log it in a sentence"
          copy="A call, a decision, a fix off the radar. Type it or say it: dictation knows your team’s names."
          at={7}
        >
          {(on) => <QuickLog on={on} />}
        </Tile>
        <Tile
          title="Private stays private"
          copy="Teammates, and their assistants, only ever see what you shared with the team."
          at={8}
        >
          {(on) => <Privacy on={on} />}
        </Tile>
        <Tile
          title="Every action has a key"
          copy="J and K to move, E to finish, H to snooze. ⌘K finds anything."
          at={9}
        >
          {(on) => <Keys on={on} />}
        </Tile>
        <Tile
          title="The tab knows"
          copy="The browser tab carries what needs you, the way a calendar’s icon shows the date."
          at={10}
        >
          {(on) => <BrowserTab on={on} />}
        </Tile>
        <Tile
          title="AI if you want it"
          badge="Opt-in"
          copy="Add a model key for the assistant and written briefs. Without one, templates and rules do the job."
          at={11}
        >
          {(on) => <ModelKey on={on} />}
        </Tile>
      </div>
    </section>
  );
}

function Tile({
  title,
  copy,
  badge,
  at,
  children,
}: {
  title: string;
  copy: string;
  badge?: string;
  at: number;
  children: (on: boolean) => ReactNode;
}) {
  // Each tile watches itself: a whole grid is never a quarter on screen on a phone. Tiles that
  // arrive together still take turns across the row, so a row settles as one wave.
  const ref = useRef<HTMLElement>(null);
  const on = useInView(ref, { margin: "0px 0px -10% 0px", once: true });
  const [turn, setTurn] = useState(false);
  useEffect(() => {
    const timer = on
      ? setTimeout(() => setTurn(true), (at % 3) * 110)
      : undefined;
    return () => clearTimeout(timer);
  }, [on, at]);
  return (
    <article ref={ref} {...stylex.props(styles.tile)}>
      <div aria-hidden {...stylex.props(styles.art)}>
        {children(turn)}
      </div>
      <div {...stylex.props(styles.words)}>
        <h3 {...stylex.props(type.tileTitle, styles.title)}>
          {title}
          {badge && <span {...stylex.props(styles.badge)}>{badge}</span>}
        </h3>
        <p {...stylex.props(type.tileCopy)}>{copy}</p>
      </div>
    </article>
  );
}

const PRODUCTS: { product: Product; name: string; connected: boolean }[] = [
  { product: "github", name: "GitHub", connected: true },
  { product: "slack", name: "Slack", connected: true },
];

function Marks({ on }: { on: boolean }) {
  return (
    <div {...stylex.props(styles.row)}>
      {PRODUCTS.map((each, at) => (
        <span key={each.product} {...stylex.props(styles.app)}>
          <ProductMark product={each.product} size={24} />
          <span {...stylex.props(styles.appName)}>{each.name}</span>
          {each.connected && (
            <span
              {...stylex.props(
                styles.check,
                on && styles.checkOn,
                styles.delay(500 + at * 220)
              )}
            >
              <CheckIcon size={10} weight="bold" />
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

function Noise({ on }: { on: boolean }) {
  return (
    <div {...stylex.props(styles.stack)}>
      <span {...stylex.props(styles.mini, styles.noise)}>
        <ProductMark product="github" size={14} />
        <span {...stylex.props(styles.miniText)}>
          dependabot bumped axios
          <span
            {...stylex.props(
              styles.strike,
              on && styles.strikeOn,
              styles.delay(500)
            )}
          />
        </span>
      </span>
      <span {...stylex.props(styles.mini, styles.noise)}>
        <ProductMark product="github" size={14} />
        <span {...stylex.props(styles.miniText)}>
          CI passed on main
          <span
            {...stylex.props(
              styles.strike,
              on && styles.strikeOn,
              styles.delay(750)
            )}
          />
        </span>
      </span>
      <span {...stylex.props(styles.mini, styles.kept)}>
        <Avatar person={eric} size={16} />
        <span {...stylex.props(styles.miniText)}>
          Eric merged <span {...stylex.props(styles.mono)}>#212</span>
        </span>
      </span>
    </div>
  );
}

function Handles({ on }: { on: boolean }) {
  return (
    <div {...stylex.props(styles.handles)}>
      <div {...stylex.props(styles.handleList)}>
        <span {...stylex.props(styles.handle)}>
          <ProductMark product="github" size={13} /> eric-nk
        </span>
        <span {...stylex.props(styles.handle)}>
          <ProductMark product="slack" size={13} /> Eric N.
        </span>
        <span {...stylex.props(styles.handle)}>
          <ProductMark product="discord" size={13} /> ericn
        </span>
      </div>
      <ArrowBendDownRightIcon
        size={18}
        {...stylex.props(styles.arrow, on && styles.arrowOn)}
      />
      <span {...stylex.props(styles.person, on && styles.personOn)}>
        <Avatar person={eric} size={40} />
        <span {...stylex.props(styles.personName)}>Eric</span>
      </span>
    </div>
  );
}

function Golden({ on }: { on: boolean }) {
  return (
    <div {...stylex.props(styles.card, styles.golden, on && styles.goldenOn)}>
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

function Drift({ on }: { on: boolean }) {
  return (
    <div {...stylex.props(styles.card, styles.drift, on && styles.driftOn)}>
      <span {...stylex.props(styles.cardTop)}>
        <span {...stylex.props(styles.mono, styles.numberChip)}>#9</span>
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

function Stamp({ on }: { on: boolean }) {
  return (
    <div {...stylex.props(styles.card)}>
      <span {...stylex.props(styles.cardTop)}>
        <span {...stylex.props(styles.mono, styles.numberChip)}>#12</span>
      </span>
      <span {...stylex.props(styles.cardTitle, styles.stamped)}>
        Search referrals by national ID
      </span>
      <span {...stylex.props(styles.stamp, on && styles.stampOn)}>
        <span {...stylex.props(styles.stampWord)}>Done</span>
        <span {...stylex.props(styles.stampDate)}>9 Nov</span>
      </span>
    </div>
  );
}

function Budget({ on }: { on: boolean }) {
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
            {...stylex.props(
              styles.segment,
              at < 2 && on && styles.segmentOn,
              styles.delay(400 + at * 200)
            )}
          />
        ))}
      </span>
      <span {...stylex.props(styles.budgetNote)}>
        Everything else waits for 8:00
      </span>
    </div>
  );
}

function QuickLog({ on }: { on: boolean }) {
  return (
    <div {...stylex.props(styles.log)}>
      <span {...stylex.props(styles.logField)}>
        <span {...stylex.props(styles.logText)}>
          Agreed on FHIR R4 for referrals
          <span {...stylex.props(styles.caret, on && styles.caretOn)} />
        </span>
        <MicrophoneIcon size={15} weight="fill" {...stylex.props(styles.mic)} />
      </span>
      <span {...stylex.props(styles.logFoot)}>
        <span {...stylex.props(styles.kind)}>
          <LightbulbIcon size={12} weight="fill" /> Decision
        </span>
        <kbd {...stylex.props(styles.kbd)}>L</kbd>
      </span>
    </div>
  );
}

function Privacy({ on }: { on: boolean }) {
  return (
    <div {...stylex.props(styles.segmented)}>
      <span {...stylex.props(styles.thumb, on && styles.thumbOn)} />
      <span {...stylex.props(styles.option, !on && styles.optionOn)}>
        <UsersThreeIcon size={14} /> Team
      </span>
      <span {...stylex.props(styles.option, on && styles.optionOn)}>
        <LockSimpleIcon size={14} weight="fill" /> Only me
      </span>
    </div>
  );
}

function Keys({ on }: { on: boolean }) {
  return (
    <div {...stylex.props(styles.row)}>
      {["J", "K", "E", "H"].map((key) => (
        <kbd
          key={key}
          {...stylex.props(
            styles.cap,
            key === "E" && on && styles.capPressed,
            styles.delay(700)
          )}
        >
          {key}
        </kbd>
      ))}
    </div>
  );
}

function BrowserTab({ on }: { on: boolean }) {
  return (
    <div {...stylex.props(styles.tabStrip)}>
      <span {...stylex.props(styles.tab)}>
        <span {...stylex.props(styles.favicon)}>
          <Logo size={16} />
          <span
            {...stylex.props(styles.faviconCount, on && styles.faviconCountOn)}
          >
            3
          </span>
        </span>
        <span {...stylex.props(styles.tabTitle)}>Inbox · Worklog</span>
      </span>
      <span {...stylex.props(styles.tab, styles.tabBehind)}>
        <span {...stylex.props(styles.tabTitle)}>Pull requests</span>
      </span>
    </div>
  );
}

function ModelKey({ on }: { on: boolean }) {
  return (
    <div {...stylex.props(styles.keyField)}>
      <KeyIcon size={14} {...stylex.props(styles.keyIcon)} />
      <span {...stylex.props(styles.keyText)}>OPENROUTER_API_KEY</span>
      <span {...stylex.props(styles.keyState, on && styles.keyStateOn)}>
        {on ? "Added" : "Not set"}
      </span>
    </div>
  );
}

const ARRIVE = "cubic-bezier(0.25, 0.8, 0.25, 1)";

const styles = stylex.create({
  lede: {
    maxWidth: 540,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(3, 1fr)",
      "@media (max-width: 960px)": "repeat(2, 1fr)",
      "@media (max-width: 600px)": "1fr",
    },
    gap: space.md,
  },
  tile: {
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderRadius: 18,
    backgroundColor: "light-dark(oklch(0.958 0.004 80), oklch(0.215 0.005 80))",
    // In the dark a surface a step up isn't edge enough; a hairline carries it, as in the app.
    boxShadow: "inset 0 0 0 1px light-dark(transparent, oklch(1 0 0 / 0.06))",
  },
  delay: (ms: number) => ({
    transitionDelay: `${ms}ms`,
  }),
  art: {
    display: "grid",
    placeItems: "center",
    height: {
      default: 200,
      "@media (max-width: 600px)": 156,
    },
    paddingInline: space.xl,
  },
  words: {
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
    paddingTop: space.xs,
    paddingBottom: {
      default: space.xxl,
      "@media (max-width: 600px)": space.xl,
    },
    paddingInline: space.xxl,
  },
  title: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
  },
  badge: {
    marginLeft: "auto",
    paddingInline: space.md,
    height: 22,
    display: "inline-flex",
    alignItems: "center",
    borderRadius: radius.full,
    backgroundColor: "light-dark(oklch(0.912 0.005 80), oklch(0.28 0.005 80))",
    color: color.fgMuted,
    fontSize: text.meta,
    fontWeight: 500,
    letterSpacing: "normal",
  },
  row: {
    display: "flex",
    gap: space.md,
  },
  app: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    width: 76,
    height: 76,
    borderRadius: 14,
    backgroundColor: color.raised,
    boxShadow: `0 0 0 1px ${color.line}, 0 1px 2px light-dark(oklch(0.2 0.01 80 / 0.06), oklch(0 0 0 / 0.3))`,
  },
  appName: {
    fontSize: text.caption,
    fontWeight: 500,
    color: color.fgMuted,
  },
  check: {
    position: "absolute",
    top: -5,
    right: -5,
    display: "grid",
    placeItems: "center",
    width: 18,
    height: 18,
    borderRadius: radius.full,
    backgroundColor: color.green,
    color: color.fgOnSolid,
    boxShadow: `0 0 0 2px light-dark(oklch(0.958 0.004 80), oklch(0.215 0.005 80))`,
    opacity: 0,
    transform: "scale(0.4)",
    transitionProperty: "opacity, transform",
    transitionDuration: "380ms",
    transitionTimingFunction: "cubic-bezier(0.34, 1.4, 0.64, 1)",
  },
  checkOn: {
    opacity: 1,
    transform: "none",
  },
  stack: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    width: "100%",
    maxWidth: 240,
  },
  mini: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: space.md,
    height: 34,
    paddingInline: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.raised,
    boxShadow: `0 0 0 1px ${color.line}`,
    fontSize: text.label,
    whiteSpace: "nowrap",
  },
  miniText: {
    position: "relative",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  noise: {
    color: color.fgMuted,
  },
  kept: {
    color: color.fg,
    fontWeight: 500,
  },
  strike: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "55%",
    height: 1,
    backgroundColor: color.fgMuted,
    transformOrigin: "left",
    transform: "scaleX(0)",
    transitionProperty: "transform",
    transitionDuration: "420ms",
    transitionTimingFunction: "cubic-bezier(0.45, 0, 0.1, 1)",
  },
  strikeOn: {
    transform: "scaleX(1)",
  },
  mono: {
    fontFamily: font.mono,
    fontWeight: 400,
  },
  handles: {
    display: "flex",
    alignItems: "center",
    gap: space.lg,
  },
  handleList: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
  },
  handle: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    height: 28,
    paddingInline: space.md,
    borderRadius: radius.full,
    backgroundColor: color.raised,
    boxShadow: `0 0 0 1px ${color.line}`,
    fontSize: text.meta,
    fontWeight: 500,
  },
  arrow: {
    color: color.fgFaint,
    opacity: 0,
    transform: "translateX(-6px)",
    transitionProperty: "opacity, transform",
    transitionDuration: "500ms",
    transitionDelay: "400ms",
    transitionTimingFunction: ARRIVE,
  },
  arrowOn: {
    opacity: 1,
    transform: "none",
  },
  person: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.xs,
    opacity: 0,
    transform: "scale(0.9)",
    transitionProperty: "opacity, transform",
    transitionDuration: "560ms",
    transitionDelay: "650ms",
    transitionTimingFunction: ARRIVE,
  },
  personOn: {
    opacity: 1,
    transform: "none",
  },
  personName: {
    fontSize: text.meta,
    fontWeight: 600,
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
    boxShadow: `0 0 0 1px ${color.line}, 0 4px 12px light-dark(oklch(0.2 0.01 80 / 0.06), oklch(0 0 0 / 0.3))`,
    textAlign: "start",
    transitionProperty: "opacity, transform, box-shadow, background-color",
    transitionDuration: "900ms",
    transitionTimingFunction: ARRIVE,
  },
  golden: {
    transform: "rotate(-2deg)",
  },
  goldenOn: {
    backgroundColor: "light-dark(oklch(0.95 0.08 88), oklch(0.4 0.085 84))",
    boxShadow: `0 0 0 1px ${color.gold}, 0 8px 20px light-dark(oklch(0.78 0.15 82 / 0.35), oklch(0 0 0 / 0.35))`,
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
    opacity: 0.72,
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
    backgroundColor: "light-dark(oklch(0 0 0 / 0.05), oklch(1 0 0 / 0.08))",
    fontSize: text.meta,
    color: color.fgMuted,
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
    color: color.fgMuted,
  },
  cardTitle: {
    fontSize: text.label,
    lineHeight: "19px",
    fontWeight: 500,
  },
  stamped: {
    paddingRight: 64,
  },
  stamp: {
    position: "absolute",
    right: 12,
    bottom: 10,
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
  stampDate: {
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
    boxShadow: `0 0 0 1px ${color.line}`,
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
    backgroundColor: color.ui,
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
  log: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    width: "100%",
    maxWidth: 260,
  },
  logField: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    minHeight: 40,
    paddingInline: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.raised,
    boxShadow: `0 0 0 1px ${color.lineUi}`,
    fontSize: text.label,
  },
  logText: {
    flexGrow: 1,
  },
  caret: {
    display: "inline-block",
    width: 1.5,
    height: 15,
    marginLeft: 1,
    verticalAlign: "-2px",
    backgroundColor: color.accent,
    opacity: 0,
  },
  caretOn: {
    animationName: stylex.keyframes({
      "0%, 49%": { opacity: 1 },
      "50%, 100%": { opacity: 0 },
    }),
    animationDuration: "1s",
    animationIterationCount: 4,
  },
  mic: {
    flexShrink: 0,
    color: color.fgMuted,
  },
  logFoot: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  kind: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    height: 24,
    paddingInline: space.md,
    borderRadius: radius.full,
    backgroundColor: color.goldSubtle,
    color: color.goldFg,
    fontSize: text.meta,
    fontWeight: 500,
  },
  kbd: {
    display: "inline-grid",
    placeItems: "center",
    minWidth: 20,
    height: 20,
    borderRadius: radius.xs,
    backgroundColor: color.raised,
    boxShadow: `0 0 0 1px ${color.line}`,
    fontFamily: font.mono,
    fontSize: text.caption,
    color: color.fgMuted,
  },
  segmented: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    width: 220,
    padding: 3,
    borderRadius: radius.full,
    backgroundColor: "light-dark(oklch(0.912 0.005 80), oklch(0.27 0.005 80))",
  },
  thumb: {
    position: "absolute",
    top: 3,
    bottom: 3,
    left: 3,
    width: "calc(50% - 3px)",
    borderRadius: radius.full,
    backgroundColor: color.raised,
    boxShadow:
      "0 1px 3px light-dark(oklch(0.2 0.01 80 / 0.12), oklch(0 0 0 / 0.4))",
    transitionProperty: "transform",
    transitionDuration: "520ms",
    transitionDelay: "600ms",
    transitionTimingFunction: "cubic-bezier(0.45, 0, 0.1, 1)",
  },
  thumbOn: {
    transform: "translateX(100%)",
  },
  option: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    height: 34,
    fontSize: text.label,
    fontWeight: 500,
    color: color.fgMuted,
    transitionProperty: "color",
    transitionDuration: "300ms",
    transitionDelay: "700ms",
  },
  optionOn: {
    color: color.fg,
  },
  cap: {
    display: "grid",
    placeItems: "center",
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: color.raised,
    boxShadow: `0 0 0 1px ${color.line}, 0 3px 0 light-dark(oklch(0.88 0.005 80), oklch(0.13 0.004 80))`,
    fontFamily: font.sans,
    fontSize: 18,
    fontWeight: 500,
    color: color.fg,
    transitionProperty: "transform, box-shadow",
    transitionDuration: "140ms",
  },
  capPressed: {
    transform: "translateY(2px)",
    boxShadow: `0 0 0 1px ${color.line}, 0 1px 0 light-dark(oklch(0.88 0.005 80), oklch(0.13 0.004 80))`,
  },
  tabStrip: {
    display: "flex",
    alignItems: "flex-end",
    width: "100%",
    maxWidth: 280,
    paddingTop: space.md,
    paddingInline: space.md,
    borderRadius: `${radius.lg} ${radius.lg} 0 0`,
    backgroundColor: "light-dark(oklch(0.912 0.005 80), oklch(0.15 0.004 80))",
  },
  tab: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    height: 38,
    paddingInline: space.lg,
    borderRadius: `${radius.md} ${radius.md} 0 0`,
    backgroundColor: color.raised,
    fontSize: text.label,
    fontWeight: 500,
    whiteSpace: "nowrap",
  },
  tabBehind: {
    backgroundColor: "transparent",
    color: color.fgMuted,
    fontWeight: 400,
  },
  tabTitle: {
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  favicon: {
    position: "relative",
    display: "flex",
  },
  faviconCount: {
    position: "absolute",
    top: -5,
    right: -7,
    display: "grid",
    placeItems: "center",
    minWidth: 14,
    height: 14,
    borderRadius: radius.full,
    backgroundColor: color.red,
    color: color.fgOnSolid,
    fontSize: 9,
    fontWeight: 600,
    boxShadow: `0 0 0 1.5px ${color.raised}`,
    opacity: 0,
    transform: "scale(0.4)",
    transitionProperty: "opacity, transform",
    transitionDuration: "380ms",
    transitionDelay: "700ms",
    transitionTimingFunction: "cubic-bezier(0.34, 1.4, 0.64, 1)",
  },
  faviconCountOn: {
    opacity: 1,
    transform: "none",
  },
  keyField: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    width: "100%",
    maxWidth: 270,
    height: 40,
    paddingInline: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.raised,
    boxShadow: `0 0 0 1px ${color.lineUi}`,
  },
  keyIcon: {
    color: color.fgFaint,
    flexShrink: 0,
  },
  keyText: {
    flexGrow: 1,
    fontFamily: font.mono,
    fontSize: text.meta,
    color: color.fgMuted,
  },
  keyState: {
    paddingInline: space.sm,
    borderRadius: radius.xs,
    fontSize: text.caption,
    fontWeight: 500,
    color: color.fgMuted,
    backgroundColor: color.ui,
    transitionProperty: "background-color, color",
    transitionDuration: "400ms",
    transitionDelay: "600ms",
  },
  keyStateOn: {
    backgroundColor: color.greenSubtle,
    color: color.greenFg,
  },
});
