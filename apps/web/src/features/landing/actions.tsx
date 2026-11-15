import { ArrowRightIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { Fragment } from "react";

import { ProductMark } from "#ui/product-mark";
import { color, media, motion, space } from "#ui/tokens.stylex";

import { SOURCE } from "./links";
import { useStart } from "./start";
import { cta, links } from "./styles";

export type Fact = { label: string; href?: string; to?: string };

/**
 * A row of short facts with dots between, as under resurf's buttons. A phone stacks them, so no
 * dot is ever left at a line's end.
 */
export function Facts({ items, sx }: { items: Fact[]; sx?: StyleXStyles }) {
  return (
    <ul {...stylex.props(styles.facts, sx)}>
      {items.map((item, at) => (
        <Fragment key={item.label}>
          {at > 0 && (
            <li aria-hidden {...stylex.props(styles.sep)}>
              ·
            </li>
          )}
          <li>
            {item.to !== undefined && (
              <Link to={item.to} {...stylex.props(links.quiet)}>
                {item.label}
              </Link>
            )}
            {item.href !== undefined && (
              <a href={item.href} {...stylex.props(links.quiet)}>
                {item.label}
              </a>
            )}
            {item.to === undefined && item.href === undefined && item.label}
          </li>
        </Fragment>
      ))}
    </ul>
  );
}

/** The way in, wherever a public page asks for it: sign in, and name your workspace next. */
export function StartLink({ sx }: { sx?: StyleXStyles }) {
  const start = useStart();
  return (
    <Link to={start} {...stylex.props(cta.base, cta.primary, styles.start, sx)}>
      Get started free
      <ArrowRightIcon size={15} weight="bold" {...stylex.props(styles.nudge)} />
    </Link>
  );
}

/** The source, in GitHub's own mark, as the second way to look closer. */
export function GitHubLink({ sx }: { sx?: StyleXStyles }) {
  return (
    <a href={SOURCE} {...stylex.props(cta.base, styles.github, sx)}>
      <ProductMark product="github" size={16} />
      Star on GitHub
    </a>
  );
}

const PHONE = "@media (max-width: 640px)";

const styles = stylex.create({
  facts: {
    display: "flex",
    flexDirection: {
      default: "row",
      [PHONE]: "column",
    },
    justifyContent: "center",
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
  sep: {
    display: {
      default: "list-item",
      [PHONE]: "none",
    },
    color: "oklch(0.22 0.01 80 / 0.3)",
  },
  start: {
    paddingRight: 18,
  },
  nudge: {
    transitionProperty: "transform",
    transitionDuration: motion.base,
    transitionTimingFunction: motion.out,
    transform: {
      default: "none",
      ":is(:hover > *)": { default: null, [media.hover]: "translateX(3px)" },
    },
  },
  github: {
    backgroundColor: {
      default: color.raised,
      ":hover": { default: null, [media.hover]: color.surface },
    },
    boxShadow:
      "0 0 0 1px oklch(0.2 0.01 80 / 0.1), 0 1px 2px oklch(0 0 0 / 0.06)",
    color: color.fg,
  },
});
