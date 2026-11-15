import { ArrowRightIcon, GithubLogoIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Ghost } from "#ui/ghost";
import { color, media, motion, radius, space, text } from "#ui/tokens.stylex";

import { useReducedMotion } from "./script";
import { cta, page, type } from "./styles";

export const SOURCE = "https://github.com/Irere123/worklog";
export const DEPLOY = `${SOURCE}/blob/main/docs/DEPLOY.md`;

const ENDINGS = [
  "that writes itself.",
  "without the status meetings.",
  "that knows what needs you.",
  "for people and agents.",
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
  return (
    <header {...stylex.props(page.wide, styles.hero)}>
      <a href="#agents" {...stylex.props(styles.badge)}>
        <span {...stylex.props(styles.badgeNew)}>New</span>
        <Ghost size={14} still />
        <span>The assistant shows what it’s doing</span>
        <ArrowRightIcon size={12} {...stylex.props(styles.badgeArrow)} />
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
                at === index && styles.endingOn,
                at === (index + ENDINGS.length - 1) % ENDINGS.length &&
                  turn > 0 &&
                  styles.endingOff
              )}
            >
              {ending}
            </span>
          ))}
        </span>
      </h1>
      <p {...stylex.props(type.lede, styles.lede)}>
        GitHub, Slack, Discord and your agents write it as they work. See what
        everyone is doing, get pinged only for what’s blocked on you, and ask
        anyone’s assistant.
      </p>
      <div {...stylex.props(styles.actions)}>
        <Link
          to={setupOpen ? "/setup" : "/login"}
          {...stylex.props(cta.base, cta.primary, styles.action)}
        >
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
        <li>On the web and your phone</li>
        <li {...stylex.props(styles.sep)} aria-hidden>
          ·
        </li>
        <li>Your server, your Postgres</li>
        <li {...stylex.props(styles.sep)} aria-hidden>
          ·
        </li>
        <li>An API for agents</li>
      </ul>
    </header>
  );
}

const styles = stylex.create({
  hero: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingTop: {
      default: 88,
      "@media (max-width: 640px)": 56,
    },
    textAlign: "center",
  },
  badge: {
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
    outlineOffset: 3,
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    height: 28,
    paddingInline: space.lg,
    borderRadius: radius.full,
    backgroundColor: color.raised,
    boxShadow: {
      default: `0 0 0 1px ${color.line}, 0 1px 2px light-dark(oklch(0.2 0.01 80 / 0.06), oklch(0 0 0 / 0.3))`,
      ":hover": {
        default: null,
        [media.hover]: `0 0 0 1px ${color.lineUi}, 0 2px 6px light-dark(oklch(0.2 0.01 80 / 0.08), oklch(0 0 0 / 0.3))`,
      },
    },
    color: color.fg,
    fontSize: text.label,
    fontWeight: 500,
    textDecoration: "none",
    transitionProperty: "box-shadow",
    transitionDuration: motion.fast,
  },
  badgeNew: {
    display: "inline-flex",
    alignItems: "center",
    height: 18,
    paddingInline: space.sm,
    marginLeft: `calc(${space.sm} * -1)`,
    borderRadius: radius.full,
    backgroundColor: color.fg,
    color: color.bg,
    fontSize: text.caption,
    fontWeight: 600,
  },
  badgeArrow: {
    color: color.fgFaint,
  },
  title: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    marginTop: space.x3,
  },
  endings: {
    display: "grid",
    color: color.fgFaint,
    // On a phone every ending keeps to one line, so the space held for the longest is never a
    // blank line under a short one.
    fontSize: {
      default: "1em",
      "@media (max-width: 520px)": "0.76em",
    },
    whiteSpace: "nowrap",
  },
  ending: {
    gridArea: "1 / 1",
    opacity: 0,
    transform: "translateY(0.35em)",
    filter: "blur(4px)",
    transitionProperty: "opacity, transform, filter",
    transitionDuration: "620ms",
    transitionTimingFunction: "cubic-bezier(0.25, 0.8, 0.25, 1)",
  },
  endingOn: {
    opacity: 1,
    transform: "none",
    filter: "none",
    transitionDelay: "120ms",
  },
  endingOff: {
    transform: "translateY(-0.35em)",
    transitionDuration: "420ms",
    transitionDelay: "0ms",
  },
  lede: {
    maxWidth: 520,
    marginTop: space.x3,
  },
  // On a phone the two buttons stack, full width: side by side they fit or wrap depending on
  // which font has arrived, and the page would jump when Inter swaps in.
  actions: {
    display: "flex",
    flexDirection: {
      default: "row",
      "@media (max-width: 520px)": "column",
    },
    flexWrap: "wrap",
    justifyContent: "center",
    gap: {
      default: space.lg,
      "@media (max-width: 520px)": space.md,
    },
    marginTop: space.x4,
    width: {
      default: "auto",
      "@media (max-width: 640px)": "100%",
    },
  },
  action: {
    flexGrow: {
      default: 0,
      "@media (max-width: 640px)": 1,
    },
  },
  facts: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    columnGap: {
      default: space.md,
      "@media (max-width: 640px)": space.xl,
    },
    rowGap: space.xs,
    marginTop: space.xxl,
    padding: 0,
    listStyle: "none",
    fontSize: text.label,
    color: color.fgMuted,
  },
  // A wrapped row would strand a dot at a line's end, so narrow screens drop them for space.
  sep: {
    display: {
      default: "list-item",
      "@media (max-width: 640px)": "none",
    },
    color: color.fgFaint,
  },
});
