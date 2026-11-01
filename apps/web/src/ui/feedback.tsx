import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { isShown } from "#lib/node";

import { color, leading, radius, space, text } from "./tokens.stylex";

export function EmptyState({
  icon,
  title,
  children,
  action,
  sx,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  sx?: StyleXStyles;
}) {
  return (
    <div {...stylex.props(styles.empty, sx)}>
      {isShown(icon) && <div {...stylex.props(styles.emptyIcon)}>{icon}</div>}
      <p {...stylex.props(styles.emptyTitle)}>{title}</p>
      {isShown(children) && (
        <p {...stylex.props(styles.emptyBody)}>{children}</p>
      )}
      {isShown(action) && (
        <div {...stylex.props(styles.emptyAction)}>{action}</div>
      )}
    </div>
  );
}

/** Waits before showing, so fast loads never flash a skeleton. */
export function Skeleton({
  lines = 3,
  height = 14,
  delayMs = 180,
}: {
  lines?: number;
  height?: number;
  delayMs?: number;
}) {
  const shown = useDelayed(delayMs);
  if (!shown) {
    return null;
  }
  return (
    <div aria-hidden {...stylex.props(styles.skeletonGroup)}>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          {...stylex.props(
            styles.skeleton,
            styles.bar(height, i === lines - 1 ? 60 : 100 - i * 7)
          )}
        />
      ))}
    </div>
  );
}

export function SkeletonBlock({
  height,
  sx,
}: {
  height: number;
  sx?: StyleXStyles;
}) {
  const shown = useDelayed(180);
  return shown ? (
    <div
      aria-hidden
      {...stylex.props(styles.skeleton, styles.block(height), sx)}
    />
  ) : null;
}

export function ErrorNote({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div role="alert" {...stylex.props(styles.error)}>
      <span>
        {error instanceof Error
          ? error.message
          : "That didn’t load. Check your connection, then try again."}
      </span>
      {retry && (
        <button type="button" onClick={retry} {...stylex.props(styles.retry)}>
          Try again
        </button>
      )}
    </div>
  );
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span {...stylex.props(a11y.srOnly)}>{children}</span>;
}

function useDelayed(ms: number) {
  const [shown, setShown] = useState(ms === 0);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return shown;
}

export const a11y = stylex.create({
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
});

const shimmer = stylex.keyframes({
  "0%": { opacity: 0.55 },
  "50%": { opacity: 1 },
  "100%": { opacity: 0.55 },
});

const styles = stylex.create({
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: space.sm,
    paddingBlock: space.x5,
    paddingInline: space.x3,
    maxWidth: 380,
    marginInline: "auto",
  },
  emptyIcon: {
    display: "grid",
    placeItems: "center",
    width: 40,
    height: 40,
    marginBottom: space.sm,
    borderRadius: radius.md,
    color: color.fgMuted,
    backgroundColor: color.ui,
  },
  emptyTitle: {
    fontSize: text.titleSm,
    lineHeight: leading.titleSm,
    fontWeight: 600,
    color: color.fg,
  },
  emptyBody: {
    fontSize: text.label,
    lineHeight: leading.label,
    color: color.fgMuted,
  },
  emptyAction: { marginTop: space.md },
  skeletonGroup: { display: "flex", flexDirection: "column", gap: space.md },
  skeleton: {
    borderRadius: radius.xs,
    backgroundColor: color.ui,
    animationName: shimmer,
    animationDuration: "1.4s",
    animationIterationCount: "infinite",
  },
  bar: (height: number, width: number) => ({ height, width: `${width}%` }),
  block: (height: number) => ({ height, borderRadius: radius.md }),
  error: {
    display: "flex",
    alignItems: "center",
    gap: space.lg,
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderRadius: radius.sm,
    fontSize: text.label,
    color: color.redFg,
    backgroundColor: color.redSubtle,
  },
  retry: {
    fontWeight: 500,
    textDecoration: "underline",
    textUnderlineOffset: 2,
  },
});
