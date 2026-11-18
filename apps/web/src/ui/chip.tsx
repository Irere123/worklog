import {
  CheckCircleIcon,
  CircleDashedIcon,
  CircleHalfIcon,
  ClockIcon,
  MinusCircleIcon,
  PauseCircleIcon,
  QuestionIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { color, font, media, radius, space, text } from "./tokens.stylex";

export type Tone =
  | "neutral"
  | "accent"
  | "gold"
  | "green"
  | "amber"
  | "red"
  | "violet"
  | "blue";

/** Where something stands. Each has its own shape, so a row of badges reads without colour. */
export type Status =
  | "idle"
  | "maybe"
  | "waiting"
  | "working"
  | "needs_you"
  | "paused"
  | "skipped"
  | "done"
  | "failed";

const GLYPH_SIZE = 12;

const GLYPHS: Record<Status, ReactNode> = {
  idle: <CircleDashedIcon size={GLYPH_SIZE} weight="bold" />,
  maybe: <QuestionIcon size={GLYPH_SIZE} weight="fill" />,
  waiting: <ClockIcon size={GLYPH_SIZE} weight="fill" />,
  working: <CircleHalfIcon size={GLYPH_SIZE} weight="fill" />,
  needs_you: <WarningCircleIcon size={GLYPH_SIZE} weight="fill" />,
  paused: <PauseCircleIcon size={GLYPH_SIZE} weight="fill" />,
  skipped: <MinusCircleIcon size={GLYPH_SIZE} weight="fill" />,
  done: <CheckCircleIcon size={GLYPH_SIZE} weight="fill" />,
  failed: <XCircleIcon size={GLYPH_SIZE} weight="fill" />,
};

export function Badge({
  tone = "neutral",
  status,
  icon,
  children,
  sx,
  title,
}: {
  tone?: Tone;
  status?: Status;
  icon?: ReactNode;
  children?: ReactNode;
  sx?: StyleXStyles;
  title?: string;
}) {
  const glyph = icon ?? (status === undefined ? null : GLYPHS[status]);
  return (
    <span
      title={title}
      {...stylex.props(
        styles.badge,
        glyph !== null && styles.badgeGlyph,
        tones[tone],
        sx
      )}
    >
      {glyph !== null && <span {...stylex.props(styles.glyph)}>{glyph}</span>}
      {children}
    </span>
  );
}

export function Dot({
  tone = "neutral",
  pulse = false,
}: {
  tone?: Tone;
  pulse?: boolean;
}) {
  return (
    <span
      aria-hidden
      {...stylex.props(styles.dot, dots[tone], pulse && styles.pulse)}
    />
  );
}

const APPLE =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/u.test(navigator.userAgent);

/** The modifier as this device writes it, for hints inside sentences and placeholders. */
export const MOD = APPLE ? "⌘" : "Ctrl";

/** One key, or a chord written "⌘ K"; spaces split it into separate caps. */
export function Kbd({ children, sx }: { children: string; sx?: StyleXStyles }) {
  return (
    <span {...stylex.props(styles.keys, sx)}>
      {children.split(" ").map((key) => (
        <kbd key={key} {...stylex.props(styles.kbd)}>
          {key === "⌘" ? MOD : key}
        </kbd>
      ))}
    </span>
  );
}

export function Count({
  children,
  tone = "neutral",
}: {
  children: number;
  tone?: Tone;
}) {
  return (
    <span
      {...stylex.props(styles.count, tone === "accent" && styles.countAccent)}
    >
      {children}
    </span>
  );
}

const pulse = stylex.keyframes({
  "0%, 100%": { opacity: 1 },
  "50%": { opacity: 0.35 },
});

const styles = stylex.create({
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    height: 20,
    paddingInline: space.sm,
    borderRadius: radius.sm,
    fontSize: text.meta,
    fontWeight: 500,
    lineHeight: 1,
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  badgeGlyph: { paddingInlineStart: space.xs },
  glyph: { display: "inline-flex", flexShrink: 0 },
  dot: {
    display: "inline-block",
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  pulse: {
    animationName: pulse,
    animationDuration: "1.6s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
    "@media (prefers-reduced-motion: reduce)": { animationName: "none" },
  },
  keys: {
    display: {
      default: "inline-flex",
      [media.touch]: "none",
    },
    gap: space.xxs,
  },
  kbd: {
    display: "inline-grid",
    placeItems: "center",
    minWidth: 18,
    height: 18,
    paddingInline: space.xs,
    borderRadius: radius.xs,
    fontFamily: font.mono,
    fontSize: 11,
    fontWeight: 500,
    lineHeight: 1,
    whiteSpace: "nowrap",
    color: color.fgMuted,
    backgroundColor: color.ui,
    boxShadow: `inset 0 -1px 0 ${color.lineUi}, 0 0 0 1px ${color.line}`,
  },
  count: {
    minWidth: 18,
    height: 18,
    paddingInline: 5,
    display: "inline-grid",
    placeItems: "center",
    borderRadius: radius.full,
    fontSize: 11,
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
    color: color.fgMuted,
    backgroundColor: color.uiActive,
  },
  countAccent: { color: color.fgOnSolid, backgroundColor: color.accent },
});

const tones = stylex.create({
  neutral: { color: color.fgMuted, backgroundColor: color.ui },
  accent: { color: color.accentFg, backgroundColor: color.accentSubtle },
  gold: { color: color.goldFg, backgroundColor: color.goldSubtle },
  green: { color: color.greenFg, backgroundColor: color.greenSubtle },
  amber: { color: color.amberFg, backgroundColor: color.amberSubtle },
  red: { color: color.redFg, backgroundColor: color.redSubtle },
  violet: { color: color.violetFg, backgroundColor: color.violetSubtle },
  blue: { color: color.blueFg, backgroundColor: color.blueSubtle },
});

const dots = stylex.create({
  neutral: { backgroundColor: color.fgFaint, color: color.fgFaint },
  accent: { backgroundColor: color.accent, color: color.accent },
  gold: { backgroundColor: color.gold, color: color.gold },
  green: { backgroundColor: color.green, color: color.green },
  amber: { backgroundColor: color.amber, color: color.amber },
  red: { backgroundColor: color.red, color: color.red },
  violet: { backgroundColor: color.violet, color: color.violet },
  blue: { backgroundColor: color.blue, color: color.blue },
});
