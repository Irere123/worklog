import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
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
  const id = `ghost-${useId().replaceAll(/[^a-zA-Z0-9]/gu, "")}`;
  // Shading and the hem's underside are sub-pixel at icon sizes: they'd cost paint for nothing.
  const detailed = size >= 28;
  const halt = still && styles.halt;
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
      <defs>
        <clipPath id={`${id}-skirt`}>
          <path d={SKIRT} />
        </clipPath>
        <radialGradient id={`${id}-shadow`}>
          <stop offset="0" {...stylex.props(styles.shadowCore)} />
          <stop offset="1" {...stylex.props(styles.shadowEdge)} />
        </radialGradient>
        {detailed && (
          <linearGradient
            id={`${id}-shade`}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="3"
            x2="0"
            y2="26"
          >
            <stop offset="0" {...stylex.props(styles.sheen)} />
            <stop
              offset="0.5"
              stopOpacity="0"
              {...stylex.props(styles.sheen)}
            />
            <stop
              offset="0.8"
              stopOpacity="0"
              {...stylex.props(styles.shade)}
            />
            <stop offset="1" {...stylex.props(styles.shade)} />
          </linearGradient>
        )}
      </defs>
      <ellipse
        cx="16"
        cy="29.6"
        rx="7.4"
        ry="1.6"
        fill={`url(#${id}-shadow)`}
        {...stylex.props(styles.shadow, styles.looping, shadows[mood], halt)}
      />
      <g {...stylex.props(styles.part, styles.looping, floats[mood], halt)}>
        <g
          {...stylex.props(
            styles.part,
            styles.looping,
            styles.body,
            bodies[mood],
            mood === "thinking" && styles.faded,
            halt
          )}
        >
          <path d={BODY} {...stylex.props(styles.ink)} />
          <g clipPath={`url(#${id}-skirt)`}>
            {detailed && (
              <g transform="translate(0 0.75)">
                <Hem
                  mood={mood}
                  detailed={detailed}
                  still={still}
                  sx={styles.ink}
                />
                <Hem
                  mood={mood}
                  detailed={detailed}
                  still={still}
                  sx={styles.underside}
                />
              </g>
            )}
            <Hem
              mood={mood}
              detailed={detailed}
              still={still}
              sx={styles.ink}
            />
            {detailed && (
              <Hem
                mood={mood}
                detailed={detailed}
                still={still}
                fill={`url(#${id}-shade)`}
              />
            )}
          </g>
          {detailed && <path d={BODY} fill={`url(#${id}-shade)`} />}
          <g {...stylex.props(styles.eyes, looks[mood])}>
            <Eyes mood={mood} detailed={detailed} still={still} />
          </g>
        </g>
        <Props mood={mood} still={still} />
      </g>
      {mood === "writing" && <Pencil still={still} />}
    </svg>
  );
}

// A bell: a round head on sides that flare a little toward the hem, as cloth falls.
const BODY =
  "M7.4 11.6a8.6 8.6 0 0 1 17.2 0c0 4.6.3 8 1 11.2v.8H6.4v-.8c.7-3.2 1-6.6 1-11.2Z";

// The hem's outline below where the body stops, so the scallops keep the body's flare.
const SKIRT =
  "M7.3 17c-.2 2.6-.4 4-.9 5.6l-.7 4.4h20.6l-.7-4.4c-.5-1.6-.7-3-.9-5.6Z";

// Four scallops across the body, plus two spare: the strip slides one lobe on a loop under the
// skirt's clip, so the hem ripples without morphing a path (which Safari can't animate). At icon
// sizes four turn into a fringe, so a small ghost has three deeper ones.
const HEM = {
  large: `M6.4 19v4.2${" c.3 0 .8 1.9 2.4 1.9s2.1-1.9 2.4-1.9".repeat(6)}V19Z`,
  small: `M6.4 19v4${" c.4 0 1.1 2.3 3.2 2.3s2.8-2.3 3.2-2.3".repeat(5)}V19Z`,
};

function Hem({
  mood,
  detailed,
  still,
  sx,
  fill,
}: {
  mood: Mood;
  detailed: boolean;
  still: boolean;
  sx?: StyleXStyles;
  fill?: string;
}) {
  return (
    <path
      d={detailed ? HEM.large : HEM.small}
      fill={fill}
      {...stylex.props(
        styles.hem,
        !detailed && styles.hemSmall,
        hems[mood],
        still && styles.halt,
        sx
      )}
    />
  );
}

// Eyes are sized for the drawing they're in: a hero ghost has the reference's small, set-apart
// eyes, and an icon-sized one gets bigger ones that still read at 14px.
const EYE = {
  large: { left: 13, right: 19, y: 12.4, rx: 1.15, ry: 1.6, line: 1.3 },
  small: { left: 12.6, right: 19.4, y: 12.6, rx: 1.5, ry: 2.05, line: 1.7 },
} as const;

function Eyes({
  mood,
  detailed,
  still,
}: {
  mood: Mood;
  detailed: boolean;
  still: boolean;
}) {
  const eye = detailed ? EYE.large : EYE.small;
  if (mood === "done") {
    const w = eye.rx * 1.5;
    return (
      <g {...stylex.props(styles.eyeLine)} strokeWidth={eye.line}>
        {[eye.left, eye.right].map((x) => (
          <path
            key={x}
            d={`M${x - w} ${eye.y + 0.7}q${w} ${-eye.ry * 1.7} ${w * 2} 0`}
          />
        ))}
      </g>
    );
  }
  if (mood === "error") {
    return (
      <>
        <g {...stylex.props(styles.eyeLine)} strokeWidth={eye.line * 0.8}>
          <path d={`M${eye.left - 1.6} ${eye.y - 2.2}l2.6-1.1`} />
          <path d={`M${eye.right + 1.6} ${eye.y - 2.2}l-2.6-1.1`} />
        </g>
        <ellipse cx={eye.left} cy={eye.y + 0.5} rx={eye.rx} ry={eye.ry * 0.7} />
        <ellipse
          cx={eye.right}
          cy={eye.y + 0.5}
          rx={eye.rx}
          ry={eye.ry * 0.7}
        />
      </>
    );
  }
  return (
    <g
      {...stylex.props(
        styles.part,
        mood === "idle" && styles.glance,
        still && styles.halt
      )}
    >
      <g {...stylex.props(styles.part, styles.blink, still && styles.halt)}>
        <ellipse cx={eye.left} cy={eye.y} rx={eye.rx} ry={eye.ry} />
        <ellipse cx={eye.right} cy={eye.y} rx={eye.rx} ry={eye.ry} />
      </g>
    </g>
  );
}

/** What floats beside it: the curl while it thinks, glints when it's done, a drop when it fails. */
function Props({ mood, still }: { mood: Mood; still: boolean }) {
  const halt = still && styles.halt;
  if (mood === "thinking") {
    return (
      <g {...stylex.props(styles.stroke, styles.faded, styles.spinning, halt)}>
        <path
          d="M27.7 5a.7.7 0 0 0-1.4 0 1.3 1.3 0 0 0 2.6 0 1.9 1.9 0 0 0-3.8 0"
          pathLength={1}
          {...stylex.props(styles.curl, halt)}
        />
      </g>
    );
  }
  if (mood === "done") {
    return (
      <g {...stylex.props(styles.stroke, styles.appear, halt)}>
        <path d="M25.6 5.2l1.4-1.6" {...stylex.props(styles.glint, halt)} />
        <path
          d="M27 7.8h1.9"
          {...stylex.props(styles.glint, styles.glintLate, halt)}
        />
        <path
          d="M23 3.2v-1.8"
          {...stylex.props(styles.glint, styles.glintLater, halt)}
        />
      </g>
    );
  }
  if (mood === "error") {
    return (
      <path
        d="M26.2 6.2q1.5 1.9 0 3.1-1.5-1.2 0-3.1Z"
        {...stylex.props(styles.stroke, styles.drop, halt)}
      />
    );
  }
  return null;
}

/** A pencil that writes a line out under the ghost, then lifts and starts the next. */
function Pencil({ still }: { still: boolean }) {
  const halt = still && styles.halt;
  return (
    <g {...stylex.props(styles.appear, halt)}>
      <path
        d={`M18 29.6${" q.6-1.3 1.25 0 t1.25 0".repeat(3)}`}
        pathLength={1}
        {...stylex.props(styles.stroke, styles.scribble, halt)}
      />
      <g {...stylex.props(styles.part, styles.pencil, halt)}>
        <g {...stylex.props(styles.part, styles.nib, halt)}>
          <path
            d="M25.5 29.6l.5-1.9 4.5-4.5 1.4 1.4-4.5 4.5Z"
            {...stylex.props(styles.ink)}
          />
        </g>
      </g>
    </g>
  );
}

const float = stylex.keyframes({
  "0%, 100%": { transform: "translateY(0)" },
  "50%": { transform: "translateY(-1.2px)" },
});

// The shadow shrinks and fades as the ghost rises, so the float reads as height, not a wobble.
const shadowFloat = stylex.keyframes({
  "0%, 100%": { transform: "scaleX(1)", opacity: 1 },
  "50%": { transform: "scaleX(0.8)", opacity: 0.55 },
});

const ripple = stylex.keyframes({
  from: { transform: "translateX(0)" },
  to: { transform: "translateX(-4.8px)" },
});

const rippleSmall = stylex.keyframes({
  from: { transform: "translateX(0)" },
  to: { transform: "translateX(-6.4px)" },
});

const blink = stylex.keyframes({
  "0%, 92%, 100%": { transform: "scaleY(1)" },
  "95%": { transform: "scaleY(0.1)" },
});

// Now and then it looks one way, then the other, as anyone waiting at a desk does.
const glance = stylex.keyframes({
  "0%, 40%, 60%, 84%, 100%": { transform: "translateX(0)" },
  "44%, 56%": { transform: "translateX(-0.7px)" },
  "64%, 80%": { transform: "translateX(0.7px)" },
});

// Head still, hem swung out: leaning in to hear you.
const lean = stylex.keyframes({
  "0%, 100%": { transform: "rotate(-6deg) scale(1.03)" },
  "50%": { transform: "rotate(-3deg) scale(1.03)" },
});

// A hop and settle, like someone looking up from their desk to catch your eye.
const hop = stylex.keyframes({
  "0%, 55%, 100%": { transform: "translateY(0) scale(1)" },
  "60%": { transform: "translateY(0) scale(1.06, 0.94)" },
  "68%": { transform: "translateY(-3px) scale(0.97, 1.04)" },
  "76%": { transform: "translateY(0) scale(1.04, 0.96)" },
  "82%": { transform: "translateY(-0.8px) scale(1)" },
});

const spin = stylex.keyframes({
  from: { transform: "rotate(0deg)" },
  to: { transform: "rotate(360deg)" },
});

// Drawn in from the centre, then erased from it, so the spiral seems to wind and unwind.
const draw = stylex.keyframes({
  "0%": { strokeDashoffset: 1 },
  "50%": { strokeDashoffset: 0 },
  "100%": { strokeDashoffset: -1 },
});

const pop = stylex.keyframes({
  "0%": { transform: "scale(1)" },
  "35%": { transform: "scale(1.12, 0.9)" },
  "65%": { transform: "scale(0.95, 1.06)" },
  "100%": { transform: "scale(1)" },
});

const appear = stylex.keyframes({
  from: { opacity: 0, transform: "scale(0.5)" },
  to: { opacity: 1, transform: "scale(1)" },
});

const twinkle = stylex.keyframes({
  "0%, 100%": { opacity: 1, transform: "scale(1)" },
  "50%": { opacity: 0.35, transform: "scale(0.5)" },
});

const shake = stylex.keyframes({
  "0%, 100%": { transform: "translateX(0)" },
  "20%": { transform: "translateX(-1.2px)" },
  "40%": { transform: "translateX(1.2px)" },
  "60%": { transform: "translateX(-0.8px)" },
  "80%": { transform: "translateX(0.6px)" },
});

const drip = stylex.keyframes({
  "0%": { opacity: 0, transform: "translateY(-1px)" },
  "20%": { opacity: 1, transform: "translateY(0)" },
  "75%": { opacity: 1, transform: "translateY(2.6px)" },
  "100%": { opacity: 0, transform: "translateY(3.6px)" },
});

const scribble = stylex.keyframes({
  "0%": { strokeDashoffset: 1, opacity: 1 },
  "72%": { strokeDashoffset: 0, opacity: 1 },
  "86%, 100%": { strokeDashoffset: 0, opacity: 0 },
});

// The pencil keeps pace with the line's end, then goes back to start the next.
const jot = stylex.keyframes({
  "0%": { transform: "translateX(-7.5px)" },
  "72%, 86%": { transform: "translateX(0)" },
  "100%": { transform: "translateX(-7.5px)" },
});

// Up and down with each stroke of the line.
const nib = stylex.keyframes({
  "0%, 100%": { transform: "translateY(0)" },
  "50%": { transform: "translateY(-0.8px)" },
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
  // The hem's underside, a shade darker in either theme, so the cloth has a thickness.
  underside: { fill: color.fold },
  sheen: { stopColor: color.sheen },
  shade: { stopColor: color.shade },
  // Charcoal rather than the page's full ink, as soft cloth reads; set on the whole figure so
  // the body and hem don't show a seam where they overlap.
  body: {
    opacity: 0.9,
    transitionProperty: "opacity",
    transitionDuration: motion.slow,
  },
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
  shadowCore: { stopColor: color.castShadow },
  shadowEdge: { stopColor: "transparent" },
  shadow: {
    transformBox: "fill-box",
    transformOrigin: "center",
  },
  hem: {
    animationName: { default: ripple, [REDUCED]: "none" },
    animationDuration: "1.8s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  hemSmall: { animationName: { default: rippleSmall, [REDUCED]: "none" } },
  eyes: {
    fill: color.bg,
    transformBox: "fill-box",
    transformOrigin: "center",
    transitionProperty: "transform",
    transitionDuration: motion.slow,
    transitionTimingFunction: motion.out,
  },
  eyeLine: {
    fill: "none",
    stroke: color.bg,
    strokeLinecap: "round",
  },
  blink: {
    transformOrigin: "center",
    animationName: { default: blink, [REDUCED]: "none" },
    animationDuration: "4.2s",
    animationIterationCount: "infinite",
  },
  glance: {
    animationName: { default: glance, [REDUCED]: "none" },
    animationDuration: "9s",
    animationTimingFunction: motion.inOut,
    animationIterationCount: "infinite",
  },
  spinning: {
    transformBox: "fill-box",
    transformOrigin: "center",
    animationName: { default: spin, [REDUCED]: "none" },
    animationDuration: "2.4s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  curl: {
    strokeWidth: 1.1,
    strokeDasharray: 1,
    strokeDashoffset: 0,
    animationName: { default: draw, [REDUCED]: "none" },
    animationDuration: "1.6s",
    animationTimingFunction: motion.inOut,
    animationIterationCount: "infinite",
  },
  appear: {
    transformBox: "fill-box",
    transformOrigin: "50% 100%",
    animationName: { default: appear, [REDUCED]: "none" },
    animationDuration: motion.slow,
    animationTimingFunction: motion.out,
    animationFillMode: "both",
  },
  glint: {
    strokeWidth: 1.1,
    transformBox: "fill-box",
    transformOrigin: "center",
    animationName: { default: twinkle, [REDUCED]: "none" },
    animationDuration: "1.8s",
    animationTimingFunction: motion.inOut,
    animationIterationCount: "infinite",
    animationDelay: "300ms",
  },
  glintLate: { animationDelay: "700ms" },
  glintLater: { animationDelay: "1100ms" },
  drop: {
    strokeWidth: 0.9,
    transformBox: "fill-box",
    transformOrigin: "center",
    animationName: { default: drip, [REDUCED]: "none" },
    animationDuration: "2.4s",
    animationTimingFunction: "ease-in",
    animationIterationCount: "infinite",
  },
  scribble: {
    strokeWidth: 1,
    strokeDasharray: 1,
    strokeDashoffset: { default: 1, [REDUCED]: 0 },
    animationName: { default: scribble, [REDUCED]: "none" },
    animationDuration: "1.8s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  pencil: {
    transform: { default: "translateX(-7.5px)", [REDUCED]: "none" },
    animationName: { default: jot, [REDUCED]: "none" },
    animationDuration: "1.8s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  // Three strokes in the line's 1.3s, so the nib bobs once a stroke.
  nib: {
    animationName: { default: nib, [REDUCED]: "none" },
    animationDuration: "433ms",
    animationTimingFunction: motion.inOut,
    animationIterationCount: "infinite",
  },
});

// One float for every mood that floats, so changing mood never makes it jump.
const floating = {
  animationName: { default: float, [REDUCED]: "none" },
  animationDuration: "3.2s",
} as const;

const floats = stylex.create({
  idle: floating,
  listening: floating,
  thinking: floating,
  writing: floating,
  waiting: floating,
  done: floating,
  // It sets down: nothing to float about.
  error: { transform: "translateY(1.2px)" },
});

const shadowing = {
  animationName: { default: shadowFloat, [REDUCED]: "none" },
  animationDuration: "3.2s",
} as const;

const shadows = stylex.create({
  idle: shadowing,
  listening: shadowing,
  thinking: shadowing,
  writing: shadowing,
  waiting: shadowing,
  done: shadowing,
  error: { transform: "scaleX(1.12)" },
});

const bodies = stylex.create({
  idle: {},
  listening: {
    transformOrigin: "50% 0%",
    transform: { default: null, [REDUCED]: "rotate(-5deg)" },
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
  error: {
    animationName: { default: shake, [REDUCED]: "none" },
    animationDuration: "420ms",
    animationTimingFunction: motion.out,
    animationIterationCount: 1,
  },
});

// Listening and writing ripple the hem faster, like it's hurrying; an error lets it hang still.
const hems = stylex.create({
  idle: {},
  listening: { animationDuration: "1.3s" },
  thinking: { animationDuration: "2.6s" },
  writing: { animationDuration: "1.1s" },
  waiting: {},
  done: {},
  error: { animationName: "none" },
});

// Where it looks: at you while listening or waiting, up and away while thinking, down at the
// pencil while writing, down and in when something's gone wrong.
const looks = stylex.create({
  idle: {},
  listening: { transform: "translateX(-0.5px) scale(1.2)" },
  thinking: { transform: "translate(1.3px, -1.5px) scale(0.82)" },
  writing: { transform: "translate(1.5px, 1.4px)" },
  waiting: { transform: "translateY(-1px) scale(1.14)" },
  done: {},
  error: { transform: "translateY(0.4px)" },
});
