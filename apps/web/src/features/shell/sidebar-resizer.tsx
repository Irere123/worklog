import * as stylex from "@stylexjs/stylex";
import { useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

import { SIDEBAR_WIDTH, setSidebarWidth, useSidebarWidth } from "#lib/sidebar";
import { color, panel } from "#ui/tokens.stylex";

const STEP = 16;
const BIG_STEP = 64;

/**
 * The sidebar's right edge, to drag wider or narrower. Arrow keys nudge it, Home and End take it to
 * its bounds, and a double click puts it back. The width is remembered in this browser.
 */
export function SidebarResizer({
  onResizing,
}: {
  onResizing: (resizing: boolean) => void;
}) {
  const width = useSidebarWidth();
  const drag = useRef<{ x: number; from: number; to: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) {
      return;
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, from: width, to: width };
    onResizing(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (start) {
      start.to = start.from + e.clientX - start.x;
      setSidebarWidth(start.to, false);
    }
  };
  const onPointerEnd = () => {
    const end = drag.current;
    if (end) {
      drag.current = null;
      setSidebarWidth(end.to);
      onResizing(false);
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const by = e.shiftKey ? BIG_STEP : STEP;
    const next: Record<string, number> = {
      ArrowLeft: width - by,
      ArrowRight: width + by,
      Home: SIDEBAR_WIDTH.min,
      End: SIDEBAR_WIDTH.max,
    };
    const to = next[e.key];
    if (to !== undefined) {
      e.preventDefault();
      setSidebarWidth(to);
    }
  };

  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a focusable window splitter, which an hr can't be
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR_WIDTH.min}
      aria-valuemax={SIDEBAR_WIDTH.max}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onDoubleClick={() => setSidebarWidth(SIDEBAR_WIDTH.default)}
      onKeyDown={onKeyDown}
      {...stylex.props(styles.handle)}
    />
  );
}

const styles = stylex.create({
  handle: {
    position: "absolute",
    top: panel.inset,
    bottom: panel.inset,
    left: -4,
    zIndex: 5,
    width: 8,
    cursor: "col-resize",
    touchAction: "none",
    outline: "none",
    "::after": {
      content: "''",
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 3,
      width: panel.radius,
      borderLeftWidth: 2,
      borderLeftStyle: "solid",
      borderLeftColor: color.focus,
      borderTopLeftRadius: panel.radius,
      borderBottomLeftRadius: panel.radius,
      pointerEvents: "none",
      opacity: { default: 0, ":focus-visible": 1 },
    },
  },
});
