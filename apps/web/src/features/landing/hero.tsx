import { ArrowUpRightIcon, GithubLogoIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { color, media, motion, radius, space, text } from "#ui/tokens.stylex";

import { useReducedMotion } from "./script";
import { cta, page, type } from "./styles";

export const SOURCE = "https://github.com/Irere123/worklog";

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
      <a href={SOURCE} {...stylex.props(styles.badge)}>
        <GithubLogoIcon size={14} weight="fill" />
        <span>Self-host it · Source on GitHub</span>
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
          href={SOURCE}
          {...stylex.props(cta.base, cta.secondary, styles.action)}
        >
          <GithubLogoIcon size={16} weight="fill" />
          View on GitHub
        </a>
      </div>
      <ul {...stylex.props(styles.facts)}>
        <li>Web and phone</li>
        <li {...stylex.props(styles.sep)} aria-hidden>
          ·
        </li>
        <li>GitHub, Slack and Discord</li>
        <li {...stylex.props(styles.sep)} aria-hidden>
          ·
        </li>
        <li>OpenAPI for agents</li>
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
  actions: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: space.lg,
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
    columnGap: space.md,
    rowGap: space.xs,
    marginTop: space.xxl,
    padding: 0,
    listStyle: "none",
    fontSize: text.label,
    color: color.fgMuted,
  },
  sep: {
    color: color.fgFaint,
  },
});
