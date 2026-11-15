import { ArrowUpRightIcon, GithubLogoIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Ghost } from "#ui/ghost";
import { Logo } from "#ui/logo";
import { color, media, motion, space } from "#ui/tokens.stylex";

import { useReducedMotion } from "./script";
import { cta, page, type } from "./styles";

export const SOURCE = "https://github.com/Irere123/worklog";
export const DEPLOY = `${SOURCE}/blob/main/docs/DEPLOY.md`;

// Short enough to hold one line on a phone: the cell keeps the height of one line, never two.
const ENDINGS = [
  "that writes itself.",
  "for people and agents.",
  "with no status meetings.",
  "that knows who’s waiting.",
];

const TURN = 3200;

/** The headline and the way in. */
export function Hero({ setupOpen }: { setupOpen: boolean }) {
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
        <a href="#agents" {...stylex.props(styles.badge)}>
          <span {...stylex.props(styles.badgeMark)}>
            <Ghost size={12} still />
          </span>
          The assistant now shows its work
          <ArrowUpRightIcon size={12} {...stylex.props(styles.badgeArrow)} />
        </a>
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
          <Link
            to={setupOpen ? "/setup" : "/login"}
            {...stylex.props(cta.base, cta.primary, styles.action)}
          >
            <Logo size={16} tinted />
            {setupOpen ? "Set up your workspace" : "Sign in to Worklog"}
          </Link>
          <a
            href={DEPLOY}
            {...stylex.props(cta.base, cta.secondary, styles.action)}
          >
            <GithubLogoIcon size={16} weight="fill" />
            Host your own
          </a>
        </div>
        <ul {...stylex.props(styles.facts)}>
          <li>
            <a href="#tour" {...stylex.props(styles.fact)}>
              On the web and your phone
            </a>
          </li>
          <li aria-hidden {...stylex.props(styles.sep)}>
            ·
          </li>
          <li>
            <a href={DEPLOY} {...stylex.props(styles.fact)}>
              Your server, your Postgres
            </a>
          </li>
          <li aria-hidden {...stylex.props(styles.sep)}>
            ·
          </li>
          <li>
            <a href="#open" {...stylex.props(styles.fact)}>
              An API for agents
            </a>
          </li>
        </ul>
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
      "0 0 0 1px light-dark(oklch(0 0 0 / 0.06), oklch(1 0 0 / 0.12)), inset 0 0.85px 0.5px light-dark(oklch(1 0 0), oklch(1 0 0 / 0.05)), 0 1px 2px light-dark(oklch(0 0 0 / 0.09), oklch(0 0 0 / 0.4))",
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
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
    outlineOffset: 3,
  },
  badgeMark: {
    display: "grid",
    placeItems: "center",
    width: 16,
    height: 16,
    borderRadius: 999,
    backgroundColor: color.fg,
    color: color.bg,
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
    color: "light-dark(oklch(0.22 0.01 80 / 0.52), oklch(0.94 0.004 80 / 0.5))",
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
  action: {
    paddingLeft: 18,
  },
  facts: {
    display: "flex",
    flexDirection: {
      default: "row",
      [PHONE]: "column",
    },
    alignItems: "center",
    gap: {
      default: space.lg,
      [PHONE]: space.sm,
    },
    margin: 0,
    padding: 0,
    listStyle: "none",
    fontSize: 13,
    lineHeight: "20px",
    color: color.fgMuted,
  },
  fact: {
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    textDecoration: "none",
    transitionProperty: "color",
    transitionDuration: motion.base,
    borderRadius: 4,
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
    outlineOffset: 2,
  },
  sep: {
    display: {
      default: "list-item",
      [PHONE]: "none",
    },
    color: "light-dark(oklch(0.22 0.01 80 / 0.3), oklch(0.94 0.004 80 / 0.3))",
  },
});
