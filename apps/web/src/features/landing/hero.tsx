import { ArrowRightIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { color, media, space } from "#ui/tokens.stylex";

import { Facts, GitHubLink, StartLink } from "./actions";
import { DEPLOY } from "./links";
import { useReducedMotion } from "./script";
import { focus, page, type } from "./styles";

// Short enough to hold one line on a phone: the cell keeps the height of one line, never two.
const ENDINGS = [
  "that writes itself.",
  "for people and agents.",
  "with no status meetings.",
  "that knows who’s waiting.",
];

const TURN = 3200;

/** The headline and the way in. */
export function Hero() {
  const reduced = useReducedMotion();
  const [turn, setTurn] = useState(0);

  useEffect(() => {
    const timer = reduced
      ? undefined
      : setInterval(() => setTurn((now) => now + 1), TURN);
    return () => clearInterval(timer);
  }, [reduced]);

  const index = turn % ENDINGS.length;
  const leaving = (index + ENDINGS.length - 1) % ENDINGS.length;
  return (
    <header {...stylex.props(page.wide, styles.hero)}>
      <div {...stylex.props(styles.words)}>
        <Link to="/changelog" {...stylex.props(focus.ring, styles.badge)}>
          <span {...stylex.props(styles.badgeNew)}>New</span>
          Worklog is now open source
          <ArrowRightIcon size={12} {...stylex.props(styles.badgeArrow)} />
        </Link>
        <h1 {...stylex.props(type.display, styles.title)}>
          Your team’s logbook
          <span {...stylex.props(styles.endings)}>
            {/* Every ending is laid out in one cell, so the line keeps the width of the longest. */}
            {ENDINGS.map((ending, at) => (
              <span
                key={ending}
                aria-hidden={at !== index}
                {...stylex.props(
                  styles.ending,
                  at === index &&
                    (turn === 0 ? styles.endingStill : styles.endingIn),
                  at === leaving && turn > 0 && styles.endingOut
                )}
              >
                {ending}
              </span>
            ))}
          </span>
        </h1>
        <p {...stylex.props(styles.lede)}>
          GitHub, Slack, Discord and your agents write it as they work.{" "}
          <br {...stylex.props(styles.wideBreak)} />
          See what moved, and hear only about what’s waiting on you.
        </p>
      </div>
      <div {...stylex.props(styles.ways)}>
        <div {...stylex.props(styles.actions)}>
          <StartLink sx={styles.action} />
          <GitHubLink sx={styles.action} />
        </div>
        <Facts
          items={[
            { label: "Free for up to 3 people", to: "/pricing" },
            { label: "Self-host with Docker", href: DEPLOY },
            { label: "API and agents", href: "#open" },
          ]}
        />
      </div>
    </header>
  );
}

const lineIn = stylex.keyframes({
  from: { opacity: 0, filter: "blur(10px)", transform: "translateY(10px)" },
  to: { opacity: 1, filter: "none", transform: "none" },
});

const lineOut = stylex.keyframes({
  from: { opacity: 1, filter: "none", transform: "none" },
  to: { opacity: 0, filter: "blur(10px)", transform: "translateY(-10px)" },
});

const PHONE = "@media (max-width: 640px)";

const styles = stylex.create({
  hero: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 40,
    paddingTop: 80,
    textAlign: "center",
  },
  words: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.xl,
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    height: 24,
    marginBottom: space.md,
    paddingLeft: space.xs,
    paddingRight: space.sm,
    borderRadius: 999,
    backgroundColor: color.raised,
    boxShadow:
      "0 0 0 1px oklch(0 0 0 / 0.06), inset 0 0.85px 0.5px oklch(1 0 0), 0 1px 2px oklch(0 0 0 / 0.09)",
    color: color.fg,
    fontSize: 12,
    fontWeight: 500,
    textDecoration: "none",
    opacity: {
      default: 0.9,
      ":hover": { default: null, [media.hover]: 1 },
    },
    transitionProperty: "opacity",
    transitionDuration: "200ms",
  },
  badgeArrow: {
    color: color.fgFaint,
  },
  title: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    maxWidth: 640,
  },
  endings: {
    display: "grid",
    width: "100%",
    // As grey as large type can go and still read: 3:1 against the page.
    color: "oklch(0.22 0.01 80 / 0.52)",
    whiteSpace: "nowrap",
  },
  ending: {
    gridArea: "1 / 1",
    opacity: 0,
    filter: "blur(10px)",
    transform: "translateY(10px)",
  },
  endingStill: {
    opacity: 1,
    filter: "none",
    transform: "none",
  },
  endingIn: {
    animationName: lineIn,
    animationDuration: "600ms",
    animationTimingFunction: "ease-out",
    animationFillMode: "both",
  },
  endingOut: {
    animationName: lineOut,
    animationDuration: "400ms",
    animationTimingFunction: "ease-in",
    animationFillMode: "both",
  },
  lede: {
    margin: 0,
    marginTop: space.md,
    maxWidth: 560,
    fontSize: 15,
    lineHeight: "24px",
    fontWeight: 400,
    color: color.fgMuted,
    textWrap: "balance",
  },
  wideBreak: {
    display: {
      default: "inline",
      [PHONE]: "none",
    },
  },
  ways: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.xxl,
    width: "100%",
  },
  // On a phone the two buttons stack, full width: side by side they fit or wrap depending on
  // which font has arrived, and the page would jump when Inter swaps in.
  actions: {
    display: "flex",
    flexDirection: {
      default: "row",
      "@media (max-width: 768px)": "column",
    },
    alignItems: "stretch",
    gap: 10,
    width: {
      default: "auto",
      "@media (max-width: 768px)": "100%",
    },
    maxWidth: {
      default: "none",
      "@media (max-width: 768px)": 384,
    },
  },
  // Full width when the pair stacks on a phone.
  action: {
    width: {
      default: "auto",
      "@media (max-width: 768px)": "100%",
    },
  },
  badgeNew: {
    display: "inline-flex",
    alignItems: "center",
    height: 16,
    paddingInline: space.sm,
    borderRadius: 999,
    backgroundColor: color.accentSubtle,
    color: color.accentFg,
    fontSize: 11,
    fontWeight: 600,
  },
});
