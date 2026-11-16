import * as stylex from "@stylexjs/stylex";

import type { Mood } from "./ghost";
import type { Product } from "./product-mark";
import { motion } from "./tokens.stylex";

// Keyed by the provider squashed to letters, since "Runs on" is typed by hand: "Claude Code",
// "claude-code" and "claude_code" are one tool. Anything else (blank is stored as "custom")
// falls back to the prompt.
const TOOLS: Record<string, Product> = {
  claudecode: "claude",
  claude: "claude",
  cursor: "cursor",
  // Codex wears its maker's mark, as Claude Code does.
  codex: "openai",
  openaicodex: "openai",
  copilot: "copilot",
  githubcopilot: "copilot",
};

/**
 * The tool an agent runs on, when it has a mark of its own. A mark is another company's logo,
 * so it's shown exactly as published and never moves; only our own drawings act out a mood.
 */
export function toolOf(provider: string | null | undefined) {
  const key = (provider ?? "").toLowerCase().replaceAll(/[^a-z]/gu, "");
  return Object.hasOwn(TOOLS, key) ? TOOLS[key] : undefined;
}

/**
 * An agent on a tool without a mark, as a terminal prompt that acts like one: the cursor blinks,
 * the line types out while it works, and the prompt hops when it needs someone, pops when it's
 * done and sets down greyed when it fails. With reduced motion, or held still, nothing moves but
 * each pose still differs.
 */
export function PromptMark({
  size,
  mood = "idle",
  still = true,
}: {
  size: number;
  mood?: Mood;
  /** Holds the pose: a mark in a list or the feed is history, and a dozen moving is noise. */
  still?: boolean;
}) {
  const busy = mood === "thinking" || mood === "writing";
  const halt = still && styles.halt;
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      {...stylex.props(styles.svg, mood === "error" && styles.failed)}
    >
      <g {...stylex.props(styles.whole, moods[mood], halt)}>
        <Prompt busy={busy} still={still} />
      </g>
    </svg>
  );
}

/** A shell waiting on its next line: the cursor blinks, and runs ahead while it works. */
function Prompt({ busy, still }: { busy: boolean; still: boolean }) {
  const halt = still && styles.halt;
  return (
    <g {...stylex.props(styles.line)}>
      <path
        d="M5 7.5l4.5 4.5L5 16.5"
        {...stylex.props(styles.part, busy && styles.run, halt)}
      />
      <path
        d="M12.5 17h6.5"
        {...stylex.props(styles.part, busy ? styles.type : styles.caret, halt)}
      />
    </g>
  );
}

// A terminal cursor is on or off, never in between.
const caret = stylex.keyframes({
  "0%, 49%": { opacity: 1 },
  "50%, 100%": { opacity: 0 },
});

// Typing: the line grows from where the prompt ends, then clears for the next.
const type = stylex.keyframes({
  "0%": { transform: "scaleX(0.15)" },
  "70%, 85%": { transform: "scaleX(1)" },
  "100%": { transform: "scaleX(0.15)" },
});

// The prompt nudges forward with each command it runs.
const run = stylex.keyframes({
  "0%, 60%, 100%": { transform: "translateX(0)" },
  "30%": { transform: "translateX(1.2px)" },
});

// Leaning in to hear you, and settling back a little each beat.
const lean = stylex.keyframes({
  "0%, 100%": { transform: "rotate(-7deg)" },
  "50%": { transform: "rotate(-4deg)" },
});

// A hop and settle, like someone looking up from their desk to catch your eye.
const hop = stylex.keyframes({
  "0%, 55%, 100%": { transform: "translateY(0) scale(1)" },
  "60%": { transform: "translateY(0) scale(1.06, 0.94)" },
  "68%": { transform: "translateY(-2px) scale(0.97, 1.04)" },
  "76%": { transform: "translateY(0) scale(1.04, 0.96)" },
  "82%": { transform: "translateY(-0.5px) scale(1)" },
});

const pop = stylex.keyframes({
  "0%": { transform: "scale(1)" },
  "35%": { transform: "scale(1.16, 0.88)" },
  "65%": { transform: "scale(0.94, 1.08)" },
  "100%": { transform: "scale(1)" },
});

const shake = stylex.keyframes({
  "0%": { transform: "translate(0, 0)" },
  "20%": { transform: "translate(-1.4px, 0)" },
  "40%": { transform: "translate(1.4px, 0)" },
  "60%": { transform: "translate(-0.9px, 0.3px)" },
  "80%": { transform: "translate(0.6px, 0.6px)" },
  "100%": { transform: "translate(0, 0.8px)" },
});

const REDUCED = "@media (prefers-reduced-motion: reduce)";

const styles = stylex.create({
  svg: {
    display: "block",
    flexShrink: 0,
    overflow: "visible",
    transitionProperty: "opacity, filter",
    transitionDuration: motion.slow,
  },
  // A failed run loses its strength as well as its footing, so it reads as stopped at a glance.
  failed: { opacity: 0.6 },
  halt: { animationName: "none" },
  // Hops and leans pivot on the mark's foot, fixed in the drawing, not on a box that moves.
  whole: {
    transformBox: "view-box",
    transformOrigin: "12px 21px",
    animationTimingFunction: motion.inOut,
    animationIterationCount: "infinite",
  },
  part: {
    transformBox: "fill-box",
    transformOrigin: "center",
    animationTimingFunction: motion.inOut,
    animationIterationCount: "infinite",
  },
  line: {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.4,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  caret: {
    animationName: { default: caret, [REDUCED]: "none" },
    animationDuration: "1.1s",
    animationTimingFunction: "step-end",
  },
  type: {
    transformOrigin: "0% 50%",
    animationName: { default: type, [REDUCED]: "none" },
    animationDuration: "1.2s",
  },
  run: {
    animationName: { default: run, [REDUCED]: "none" },
    animationDuration: "1.2s",
  },
});

const moods = stylex.create({
  idle: {},
  listening: {
    transform: { default: null, [REDUCED]: "rotate(-6deg)" },
    animationName: { default: lean, [REDUCED]: "none" },
    animationDuration: "2.2s",
  },
  thinking: {},
  writing: {},
  waiting: {
    animationName: { default: hop, [REDUCED]: "none" },
    animationDuration: "2.4s",
    animationTimingFunction: "ease-out",
  },
  done: {
    animationName: { default: pop, [REDUCED]: "none" },
    animationDuration: "460ms",
    animationTimingFunction: motion.out,
    animationIterationCount: 1,
  },
  // It sets down where the shake ends, a little lower, the way the ghost does.
  error: {
    transform: "translateY(0.8px)",
    animationName: { default: shake, [REDUCED]: "none" },
    animationDuration: "420ms",
    animationTimingFunction: motion.out,
    animationIterationCount: 1,
  },
});
