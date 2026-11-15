import { ArrowRightIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";

import { ProductMark } from "#ui/product-mark";
import { color, media, motion } from "#ui/tokens.stylex";

import { SOURCE } from "./links";
import { useStart } from "./start";
import { cta } from "./styles";

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

const styles = stylex.create({
  // Lit from above with a soft fall beneath, so the way in sits a step off the page.
  start: {
    paddingRight: 18,
    boxShadow:
      "inset 0 1px 0 oklch(1 0 0 / 0.14), 0 1px 2px oklch(0 0 0 / 0.18), 0 6px 16px -6px oklch(0 0 0 / 0.35)",
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
      "0 0 0 1px light-dark(oklch(0.2 0.01 80 / 0.1), oklch(1 0 0 / 0.12)), 0 1px 2px light-dark(oklch(0 0 0 / 0.06), oklch(0 0 0 / 0.3))",
    color: color.fg,
  },
});
