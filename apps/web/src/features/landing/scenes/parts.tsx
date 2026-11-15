import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { color, font, radius, space, text } from "#ui/tokens.stylex";

/** What every chapter of the tour gets from the tour. */
export type SceneProps = {
  /** On screen and the tour's turn: the script runs. */
  play: boolean;
  /** Someone pressed Pause: the script holds where it is. */
  paused: boolean;
  /** Reduced motion: the scene shows its finished frame and never moves. */
  still: boolean;
};

/** The app's page header: a title, an optional note beside it, and controls at the end. */
export function PaneHeader({
  title,
  note,
  end,
}: {
  title: string;
  note?: ReactNode;
  end?: ReactNode;
}) {
  return (
    <div {...stylex.props(parts.header)}>
      <span {...stylex.props(parts.headerTitle)}>{title}</span>
      {note !== undefined && (
        <span {...stylex.props(parts.headerNote)}>{note}</span>
      )}
      <span {...stylex.props(parts.headerEnd)}>{end}</span>
    </div>
  );
}

export function CardNumber({
  children,
  sx,
}: {
  children: ReactNode;
  sx?: StyleXStyles;
}) {
  return <span {...stylex.props(parts.number, sx)}>#{children}</span>;
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "amber" | "blue" | "green" | "gold";
}) {
  return (
    <span {...stylex.props(parts.pill, parts[`pill_${tone}`])}>{children}</span>
  );
}

export const parts = stylex.create({
  header: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    height: 48,
    paddingInline: space.xxl,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
    whiteSpace: "nowrap",
  },
  headerTitle: {
    fontSize: text.titleSm,
    fontWeight: 600,
  },
  headerNote: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: color.fgMuted,
  },
  headerEnd: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    marginLeft: "auto",
  },
  number: {
    fontFamily: font.mono,
    fontSize: text.meta,
    color: color.fgFaint,
    fontVariantNumeric: "tabular-nums",
  },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    height: 22,
    paddingInline: space.md,
    borderRadius: radius.sm,
    fontSize: text.meta,
    fontWeight: 500,
    whiteSpace: "nowrap",
  },
  pill_neutral: {
    backgroundColor: color.ui,
    color: color.fgMuted,
  },
  pill_amber: {
    backgroundColor: color.amberSubtle,
    color: color.amberFg,
  },
  pill_blue: {
    backgroundColor: color.blueSubtle,
    color: color.blueFg,
  },
  pill_green: {
    backgroundColor: color.greenSubtle,
    color: color.greenFg,
  },
  pill_gold: {
    backgroundColor: color.goldSubtle,
    color: color.goldFg,
  },
  control: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    height: 28,
    paddingInline: space.md,
    borderRadius: radius.md,
    backgroundColor: color.raised,
    boxShadow: `inset 0 0 0 1px ${color.lineUi}`,
    color: color.fg,
    fontWeight: 500,
    whiteSpace: "nowrap",
    transitionProperty: "background-color, transform",
    transitionDuration: "120ms",
  },
  // A control the pointer is pressing: it darkens and gives a little, as the app's buttons do.
  controlPressed: {
    backgroundColor: color.uiActive,
    transform: "scale(0.96)",
  },
  faint: {
    color: color.fgFaint,
  },
  muted: {
    color: color.fgMuted,
  },
  strong: {
    fontWeight: 600,
  },
  ellipsis: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});
