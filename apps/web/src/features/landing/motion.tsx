import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * A row that opens its own room as it arrives, so the rows below it move down with it instead of
 * jumping. Its words fade in only once the room is nearly open, so a moving edge never slices them.
 */
export function Collapse({
  open,
  children,
  from = "drop",
}: {
  open: boolean;
  children: ReactNode;
  from?: "drop" | "none";
}) {
  return (
    <div
      aria-hidden={!open}
      {...stylex.props(styles.collapse, open && styles.collapseOpen)}
    >
      <div {...stylex.props(styles.collapseInner)}>
        <div
          {...stylex.props(
            styles.collapseContent,
            from === "drop" && styles.drop,
            open && styles.contentOpen
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * A number or short word that rolls to its new value: the old one leaves upward as the new one
 * rises into its place, so the change reads as a change rather than a swap.
 */
export function Roll({ value }: { value: string | number }) {
  const [shown, setShown] = useState({ now: value, before: value, turn: 0 });
  const last = useRef(value);
  // Once the old value has left, it leaves the layout too, so the slot is the new value's width.
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (last.current === value) {
      return;
    }
    setGone(false);
    setShown((current) => ({
      now: value,
      before: last.current,
      turn: current.turn + 1,
    }));
    last.current = value;
  }, [value]);
  return (
    <span {...stylex.props(styles.roll)}>
      {shown.turn > 0 && !gone && (
        <span
          key={`out-${shown.turn}`}
          aria-hidden
          onAnimationEnd={() => setGone(true)}
          {...stylex.props(styles.rollItem, styles.rollOut)}
        >
          {shown.before}
        </span>
      )}
      <span
        key={`in-${shown.turn}`}
        {...stylex.props(styles.rollItem, shown.turn > 0 && styles.rollIn)}
      >
        {shown.now}
      </span>
    </span>
  );
}

const rise = stylex.keyframes({
  from: { transform: "translateY(70%)", opacity: 0 },
  to: { transform: "translateY(0)", opacity: 1 },
});

const leave = stylex.keyframes({
  from: { transform: "translateY(0)", opacity: 1 },
  to: { transform: "translateY(-70%)", opacity: 0 },
});

const ARRIVE = "cubic-bezier(0.25, 0.8, 0.25, 1)";

const styles = stylex.create({
  collapse: {
    display: "grid",
    gridTemplateRows: "0fr",
    transitionProperty: "grid-template-rows",
    transitionDuration: "520ms",
    transitionTimingFunction: "cubic-bezier(0.45, 0, 0.1, 1)",
  },
  collapseOpen: {
    gridTemplateRows: "1fr",
  },
  collapseInner: {
    minHeight: 0,
    overflow: "hidden",
  },
  collapseContent: {
    opacity: 0,
    transitionProperty: "opacity, transform",
    transitionDuration: "180ms",
    transitionTimingFunction: ARRIVE,
  },
  drop: {
    transform: "translateY(-6px)",
  },
  contentOpen: {
    opacity: 1,
    transform: "none",
    transitionDuration: "640ms",
    transitionDelay: "220ms",
  },
  roll: {
    display: "inline-grid",
    overflow: "hidden",
    verticalAlign: "bottom",
    fontVariantNumeric: "tabular-nums",
  },
  rollItem: {
    gridArea: "1 / 1",
    textAlign: "start",
    whiteSpace: "nowrap",
  },
  rollIn: {
    animationName: rise,
    animationDuration: "420ms",
    animationTimingFunction: ARRIVE,
    animationFillMode: "both",
  },
  rollOut: {
    animationName: leave,
    animationDuration: "420ms",
    animationTimingFunction: ARRIVE,
    animationFillMode: "both",
  },
});
