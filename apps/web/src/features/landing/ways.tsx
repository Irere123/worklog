import {
  ArrowRightIcon,
  CheckIcon,
  CloudIcon,
  HardDrivesIcon,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";

import { color, media, motion, radius, shadow, space } from "#ui/tokens.stylex";

import { DEPLOY } from "./links";
import { useStart } from "./start";
import { page, type } from "./styles";

/**
 * Where Worklog runs, as resurf's card shows where its library lives: one panel, the two homes
 * side by side, each with what it costs and how to begin.
 */
export function Ways() {
  const start = useStart();
  return (
    <section id="ways" {...stylex.props(page.wide, page.section)}>
      <div {...stylex.props(page.tile, styles.panel)}>
        <div {...stylex.props(styles.words)}>
          <h2 {...stylex.props(type.heading)}>Ours to run, or yours.</h2>
          <p {...stylex.props(type.lede)}>
            Start on Worklog Cloud with an email address, or run the same
            open-source code on your own server. Your team works the same either
            way.
          </p>
        </div>
        <div {...stylex.props(styles.options)}>
          <Option
            icon={CloudIcon}
            title="Worklog Cloud"
            lines={[
              "Free for up to 3 people",
              "$49 a month for the whole team, with AI included",
              "Start with an email address, no card",
            ]}
            action="Start free"
            to={start}
          />
          <Option
            icon={HardDrivesIcon}
            title="Your own server"
            lines={[
              "Every feature, free, under the AGPL-3.0",
              "Docker Compose or Railway, with your Postgres",
              "Invite-only, if you want it",
            ]}
            action="Read the deploy guide"
            href={DEPLOY}
          />
        </div>
      </div>
    </section>
  );
}

function Option({
  icon: Glyph,
  title,
  lines,
  action,
  to,
  href,
}: {
  icon: Icon;
  title: string;
  lines: string[];
  action: string;
  to?: string;
  href?: string;
}) {
  const link = stylex.props(styles.action);
  const label = (
    <>
      {action}
      <ArrowRightIcon size={14} {...stylex.props(styles.arrow)} />
    </>
  );
  return (
    <article {...stylex.props(styles.option)}>
      <span {...stylex.props(styles.mark)}>
        <Glyph size={20} />
      </span>
      <h3 {...stylex.props(type.tileTitle)}>{title}</h3>
      <ul {...stylex.props(styles.lines)}>
        {lines.map((line) => (
          <li key={line} {...stylex.props(styles.line)}>
            <CheckIcon size={14} weight="bold" {...stylex.props(styles.tick)} />
            {line}
          </li>
        ))}
      </ul>
      {to === undefined ? (
        <a href={href} {...link}>
          {label}
        </a>
      ) : (
        <Link to={to} {...link}>
          {label}
        </Link>
      )}
    </article>
  );
}

const styles = stylex.create({
  panel: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 48,
    paddingTop: {
      default: 80,
      "@media (max-width: 640px)": 56,
    },
    paddingBottom: {
      default: space.x5,
      "@media (max-width: 640px)": space.x3,
    },
    paddingInline: {
      default: space.x5,
      "@media (max-width: 640px)": space.xl,
    },
  },
  words: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.xxl,
    maxWidth: 560,
    textAlign: "center",
  },
  options: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(2, minmax(0, 1fr))",
      "@media (max-width: 720px)": "1fr",
    },
    gap: space.md,
    width: "100%",
    maxWidth: 760,
  },
  option: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.md,
    padding: space.x3,
    borderRadius: 14,
    backgroundColor: color.raised,
    boxShadow: shadow.object,
  },
  mark: {
    display: "grid",
    placeItems: "center",
    width: 36,
    height: 36,
    marginBottom: space.xs,
    borderRadius: 10,
    backgroundColor: color.ui,
    color: color.fg,
  },
  lines: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  line: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.md,
    fontSize: 14,
    lineHeight: "20px",
    color: color.fgMuted,
  },
  tick: {
    flexShrink: 0,
    marginTop: 3,
    color: color.green,
  },
  action: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    marginTop: "auto",
    paddingTop: space.lg,
    fontSize: 14,
    fontWeight: 500,
    color: {
      default: color.fg,
      ":hover": { default: null, [media.hover]: color.accentFg },
    },
    textDecoration: "none",
    transitionProperty: "color",
    transitionDuration: motion.fast,
    borderRadius: radius.xs,
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
    outlineOffset: 2,
  },
  arrow: {
    transitionProperty: "transform",
    transitionDuration: motion.base,
    transitionTimingFunction: motion.out,
    transform: {
      default: "none",
      ":is(:hover > *)": { default: null, [media.hover]: "translateX(2px)" },
    },
  },
});
