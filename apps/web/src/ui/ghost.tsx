import * as stylex from "@stylexjs/stylex";
import { useId } from "react";

import { color, motion } from "./tokens.stylex";

export type Mood =
  | "idle"
  | "listening"
  | "thinking"
  | "writing"
  | "waiting"
  | "done"
  | "error";

/**
 * An agent as a small ghost whose pose and motion say what it's doing, the way a colleague's
 * face would. It's drawn in the page's ink, so it's dark on light and light on dark with no
 * variant to pick. With reduced motion nothing moves, but each mood keeps its own pose (eyes,
 * colour, the pencil or the curl), so the state still reads.
 */
export function Ghost({
  mood = "idle",
  size = 16,
  still = false,
  tinted = false,
  label,
}: {
  mood?: Mood;
  size?: number;
  /** Holds the pose without moving: for an old reply in a thread, where only the latest lives. */
  still?: boolean;
  /** Takes the colour of the text around it, for a ghost inside a coloured badge. */
  tinted?: boolean;
  /** Spoken to screen readers; leave it off where the state is printed beside the ghost. */
  label?: string;
}) {
  const clip = `ghost-${useId().replaceAll(/[^a-zA-Z0-9]/gu, "")}`;
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined}
      {...stylex.props(styles.svg, !tinted && styles.pageInk)}
    >
      <ellipse
        cx="16"
        cy="30.4"
        rx="6.6"
        ry="1.1"
        {...stylex.props(
          styles.shadow,
          styles.looping,
          shadows[mood],
          still && styles.halt
        )}
      />
      <g
        {...stylex.props(
          styles.part,
          styles.looping,
          floats[mood],
          still && styles.halt
        )}
      >
        <g
          {...stylex.props(
            styles.part,
            styles.looping,
            styles.body,
            bodies[mood],
            mood === "thinking" && styles.faded,
            still && styles.halt
          )}
        >
          <defs>
            <clipPath id={clip}>
              <rect x="5" y="18" width="22" height="12" />
            </clipPath>
          </defs>
          <path
            d="M5.7 13a10.3 10.3 0 0 1 20.6 0L27 22H5Z"
            {...stylex.props(styles.ink)}
          />
          <g clipPath={`url(#${clip})`}>
            <path
              d={HEM}
              {...stylex.props(
                styles.ink,
                styles.hem,
                hems[mood],
                still && styles.halt
              )}
            />
          </g>
          <g {...stylex.props(styles.eyes, looks[mood])}>
            <Eyes mood={mood} still={still} />
          </g>
        </g>
        {mood === "thinking" && (
          <path
            d="M27.3 4.6a1.5 1.5 0 1 1-1.2-2.4 2.5 2.5 0 0 1 2.9 2.9"
            {...stylex.props(styles.stroke, styles.faded, styles.curl)}
          />
        )}
        {mood === "done" && (
          <g
            {...stylex.props(styles.stroke, styles.shine, still && styles.halt)}
          >
            <path d="M26.2 4.4l1.4-1.6" />
            <path d="M28 6.8h2" />
            <path d="M23.6 2.8v-1.8" />
          </g>
        )}
      </g>
      {mood === "writing" && (
        <>
          <path
            d="M18.5 30.2l1.6-1.3 1.2 1.1 1.5-1.3 1.2 1.1 1.5-1.3"
            pathLength={1}
            {...stylex.props(styles.stroke, styles.scribble)}
          />
          <g {...stylex.props(styles.part, styles.pencil)}>
            <path
              d="M29.9 22.6l1.4 1.4-5.6 5.6-1.9.5.5-1.9Z"
              {...stylex.props(styles.ink)}
            />
          </g>
        </>
      )}
    </svg>
  );
}

// A strip of scallops wider than the body, clipped to it and slid one wavelength on a loop, so the
// hem ripples without morphing a path (which Safari can't animate).
const HEM = `M5 20v4.5${" q1.833 4 3.667 0 t3.667 0".repeat(5)}V20Z`;

function Eyes({ mood, still }: { mood: Mood; still: boolean }) {
  if (mood === "done") {
    return (
      <g {...stylex.props(styles.eyeStroke)}>
        <path d="M10.6 14.2q1.6-2.2 3.2 0" />
        <path d="M18.2 14.2q1.6-2.2 3.2 0" />
      </g>
    );
  }
  if (mood === "error") {
    return (
      <g {...stylex.props(styles.eyeStroke)}>
        <path d="M10.8 14.4l2.8-1.4" />
        <path d="M18.4 13l2.8 1.4" />
      </g>
    );
  }
  return (
    <g {...stylex.props(styles.part, styles.blink, still && styles.halt)}>
      <ellipse cx="12.2" cy="13.6" rx="1.6" ry="2.2" />
      <ellipse cx="19.8" cy="13.6" rx="1.6" ry="2.2" />
    </g>
  );
}

const float = stylex.keyframes({
  "0%, 100%": { transform: "translateY(0)" },
  "50%": { transform: "translateY(-1.6px)" },
});

// The shadow shrinks and fades as the ghost rises, so the float reads as height, not a wobble.
const shadowFloat = stylex.keyframes({
  "0%, 100%": { transform: "scaleX(1)", opacity: 1 },
  "50%": { transform: "scaleX(0.78)", opacity: 0.6 },
});

const ripple = stylex.keyframes({
  from: { transform: "translateX(0)" },
  to: { transform: "translateX(-7.333px)" },
});

const blink = stylex.keyframes({
  "0%, 92%, 100%": { transform: "scaleY(1)" },
  "95%": { transform: "scaleY(0.1)" },
});

const lean = stylex.keyframes({
  "0%, 100%": { transform: "rotate(-5deg)" },
  "50%": { transform: "rotate(-2deg)" },
});

// A hop and settle, like someone looking up from their desk to catch your eye.
const hop = stylex.keyframes({
  "0%, 55%, 100%": { transform: "translateY(0)" },
  "65%": { transform: "translateY(-3px)" },
  "75%": { transform: "translateY(0)" },
  "82%": { transform: "translateY(-1px)" },
});

const spin = stylex.keyframes({
  from: { transform: "rotate(0deg)" },
  to: { transform: "rotate(360deg)" },
});

const pop = stylex.keyframes({
  "0%": { transform: "scale(1)" },
  "40%": { transform: "scale(1.12, 0.92)" },
  "70%": { transform: "scale(0.96, 1.05)" },
  "100%": { transform: "scale(1)" },
});

const shineIn = stylex.keyframes({
  from: { opacity: 0, transform: "scale(0.4)" },
  to: { opacity: 1, transform: "scale(1)" },
});

const shake = stylex.keyframes({
  "0%, 100%": { transform: "translateX(0)" },
  "20%": { transform: "translateX(-1.2px)" },
  "40%": { transform: "translateX(1.2px)" },
  "60%": { transform: "translateX(-0.8px)" },
  "80%": { transform: "translateX(0.6px)" },
});

const scribble = stylex.keyframes({
  "0%": { strokeDashoffset: 1, opacity: 1 },
  "70%": { strokeDashoffset: 0, opacity: 1 },
  "100%": { strokeDashoffset: 0, opacity: 0 },
});

const jot = stylex.keyframes({
  "0%": { transform: "translate(-6px, 0)" },
  "12%, 30%, 48%, 66%": { transform: "translate(-4.4px, -0.6px)" },
  "21%, 39%, 57%": { transform: "translate(-3px, 0.4px)" },
  "70%": { transform: "translate(0, 0)" },
  "100%": { transform: "translate(-6px, 0)" },
});

const REDUCED = "@media (prefers-reduced-motion: reduce)";

const styles = stylex.create({
  svg: { display: "block", flexShrink: 0, overflow: "visible" },
  pageInk: { color: color.fg },
  halt: { animationName: "none" },
  looping: {
    animationTimingFunction: motion.inOut,
    animationIterationCount: "infinite",
  },
  // Rotations and scales turn about the part itself, not the corner of the drawing.
  part: { transformBox: "fill-box", transformOrigin: "50% 100%" },
  ink: { fill: "currentColor" },
  body: { transitionProperty: "opacity", transitionDuration: motion.slow },
  // Faded as a whole rather than path by path, where the body and hem overlap and would show a
  // darker seam; 0.58 lands on fgFaint against the page in both themes.
  faded: { opacity: 0.58 },
  stroke: {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.3,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  shadow: {
    fill: "currentColor",
    fillOpacity: 0.13,
    transformBox: "fill-box",
    transformOrigin: "center",
  },
  hem: {
    animationName: { default: ripple, [REDUCED]: "none" },
    animationDuration: "1.8s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  eyes: {
    fill: color.bg,
    transformBox: "fill-box",
    transformOrigin: "center",
    transitionProperty: "transform",
    transitionDuration: motion.slow,
    transitionTimingFunction: motion.out,
  },
  eyeStroke: {
    fill: "none",
    stroke: color.bg,
    strokeWidth: 1.5,
    strokeLinecap: "round",
  },
  blink: {
    transformOrigin: "center",
    animationName: { default: blink, [REDUCED]: "none" },
    animationDuration: "4.2s",
    animationIterationCount: "infinite",
  },
  curl: {
    transformBox: "fill-box",
    transformOrigin: "center",
    animationName: { default: spin, [REDUCED]: "none" },
    animationDuration: "1.4s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  shine: {
    transformBox: "fill-box",
    transformOrigin: "0% 100%",
    animationName: { default: shineIn, [REDUCED]: "none" },
    animationDuration: motion.slow,
    animationTimingFunction: motion.out,
    animationFillMode: "both",
    animationDelay: "120ms",
  },
  scribble: {
    strokeWidth: 1,
    strokeDasharray: 1,
    strokeDashoffset: { default: 1, [REDUCED]: 0 },
    animationName: { default: scribble, [REDUCED]: "none" },
    animationDuration: "1.6s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  pencil: {
    transform: { default: "translate(-6px, 0)", [REDUCED]: "none" },
    animationName: { default: jot, [REDUCED]: "none" },
    animationDuration: "1.6s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
});

const floats = stylex.create({
  idle: {
    animationName: { default: float, [REDUCED]: "none" },
    animationDuration: "3.2s",
  },
  listening: {
    animationName: { default: float, [REDUCED]: "none" },
    animationDuration: "2.2s",
  },
  thinking: {
    animationName: { default: float, [REDUCED]: "none" },
    animationDuration: "4s",
  },
  writing: {
    animationName: { default: float, [REDUCED]: "none" },
    animationDuration: "2.6s",
  },
  waiting: {
    animationName: { default: hop, [REDUCED]: "none" },
    animationDuration: "2.4s",
    animationTimingFunction: "ease-out",
  },
  done: {
    animationName: { default: float, [REDUCED]: "none" },
    animationDuration: "3.2s",
  },
  // It sets down: nothing to float about.
  error: { transform: "translateY(1px)" },
});

const shadows = stylex.create({
  idle: {
    animationName: { default: shadowFloat, [REDUCED]: "none" },
    animationDuration: "3.2s",
  },
  listening: {
    animationName: { default: shadowFloat, [REDUCED]: "none" },
    animationDuration: "2.2s",
  },
  thinking: {
    animationName: { default: shadowFloat, [REDUCED]: "none" },
    animationDuration: "4s",
  },
  writing: {
    animationName: { default: shadowFloat, [REDUCED]: "none" },
    animationDuration: "2.6s",
  },
  waiting: {},
  done: {
    animationName: { default: shadowFloat, [REDUCED]: "none" },
    animationDuration: "3.2s",
  },
  error: { transform: "scaleX(1.1)" },
});

const bodies = stylex.create({
  idle: {},
  listening: {
    transform: { default: null, [REDUCED]: "rotate(-4deg)" },
    animationName: { default: lean, [REDUCED]: "none" },
    animationDuration: "2.2s",
  },
  thinking: {},
  writing: {},
  waiting: {},
  done: {
    animationName: { default: pop, [REDUCED]: "none" },
    animationDuration: "420ms",
    animationTimingFunction: motion.out,
    animationIterationCount: 1,
  },
  error: {
    animationName: { default: shake, [REDUCED]: "none" },
    animationDuration: "420ms",
    animationTimingFunction: motion.out,
    animationIterationCount: 1,
  },
});

// Writing ripples the hem faster, like it's hurrying; an error lets it hang still.
const hems = stylex.create({
  idle: {},
  listening: {},
  thinking: { animationDuration: "2.6s" },
  writing: { animationDuration: "1.1s" },
  waiting: {},
  done: {},
  error: { animationName: "none" },
});

// Where it looks: at you while listening or waiting, up and away while thinking, down at the
// pencil while writing.
const looks = stylex.create({
  idle: {},
  listening: { transform: "translateX(-0.6px) scale(1.18)" },
  thinking: { transform: "translate(1.3px, -1.6px) scale(0.85)" },
  writing: { transform: "translate(1.4px, 1.3px)" },
  waiting: { transform: "translateY(-1.2px) scale(1.12)" },
  done: {},
  error: { transform: "translateY(0.6px)" },
});
