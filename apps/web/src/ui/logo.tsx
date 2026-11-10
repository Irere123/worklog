import * as stylex from "@stylexjs/stylex";
import { useId } from "react";

import {
  MARK_LOBES,
  MARK_SEAM,
  MARK_THREAD,
  MARK_VIEWBOX,
  markCuts,
} from "./logo-mark";
import { color, motion } from "./tokens.stylex";

/**
 * Two lobes with one thread written through them, a cursive "ee": the work, and the record it
 * leaves. With `draw` the thread writes itself once, for the moments the mark is the whole screen.
 */
export function Logo({
  size = 24,
  draw = false,
}: {
  size?: number;
  draw?: boolean;
}) {
  const mask = useId();
  const cuts = markCuts(size);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an <img> can't take the theme's token colors; role="img" is how an inline SVG gets announced
      role="img"
      aria-label="Worklog"
      {...stylex.props(styles.logo)}
    >
      <mask id={mask} maskUnits="userSpaceOnUse">
        <rect width={MARK_VIEWBOX} height={MARK_VIEWBOX} fill="#fff" />
        <path
          d={MARK_SEAM}
          fill="none"
          stroke="#000"
          strokeWidth={cuts.seam}
          strokeLinecap="round"
        />
        <path
          d={MARK_THREAD}
          pathLength={1}
          fill="none"
          stroke="#000"
          strokeWidth={cuts.thread}
          strokeLinecap="round"
          strokeLinejoin="round"
          {...stylex.props(draw && styles.write)}
        />
      </mask>
      <g mask={`url(#${mask})`} {...stylex.props(draw && styles.settle)}>
        {size >= RIM_FROM && (
          <path
            d={MARK_LOBES}
            transform="translate(-0.8 0.5)"
            {...stylex.props(styles.rim)}
          />
        )}
        <path d={MARK_LOBES} {...stylex.props(styles.ink)} />
      </g>
    </svg>
  );
}

// The crayon's purple edge is a fraction of a pixel in an icon, where it only muddies the outline.
const RIM_FROM = 32;

const settle = stylex.keyframes({
  from: { opacity: 0, transform: "scale(0.94)" },
  to: { opacity: 1, transform: "scale(1)" },
});

const write = stylex.keyframes({
  from: { strokeDashoffset: "1" },
  to: { strokeDashoffset: "0" },
});

const styles = stylex.create({
  logo: { flexShrink: 0 },
  ink: { fill: color.brand },
  rim: { fill: color.brandRim },
  settle: {
    transformBox: "fill-box",
    transformOrigin: "center",
    animationName: settle,
    animationDuration: motion.slow,
    animationTimingFunction: motion.out,
    animationFillMode: "backwards",
    "@media (prefers-reduced-motion: reduce)": { animationName: "none" },
  },
  // pathLength={1} makes the dash the thread's whole length, so the offset reads as progress.
  write: {
    strokeDasharray: "1",
    animationName: write,
    animationDuration: "1100ms",
    animationDelay: "160ms",
    animationTimingFunction: motion.inOut,
    animationFillMode: "backwards",
    "@media (prefers-reduced-motion: reduce)": { animationName: "none" },
  },
});
