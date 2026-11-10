import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { Logo } from "#ui/logo";
import { color, leading, media, radius, space, text } from "#ui/tokens.stylex";

export function AuthFrame({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.column)}>
        <Logo size={36} draw />
        <div {...stylex.props(styles.card)}>
          <div {...stylex.props(styles.head)}>
            <h1 {...stylex.props(styles.title)}>{title}</h1>
            {subtitle !== undefined && (
              <p {...stylex.props(styles.subtitle)}>{subtitle}</p>
            )}
          </div>
          {children}
        </div>
        {footer !== undefined && (
          <div {...stylex.props(styles.footer)}>{footer}</div>
        )}
      </div>
    </main>
  );
}

export const authStyles = stylex.create({
  form: { display: "flex", flexDirection: "column", gap: space.lg },
  divider: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    fontSize: text.meta,
    color: color.fgFaint,
    "::before": {
      content: '""',
      flexGrow: 1,
      height: 1,
      backgroundColor: color.line,
    },
    "::after": {
      content: '""',
      flexGrow: 1,
      height: 1,
      backgroundColor: color.line,
    },
  },
  note: {
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgMuted,
  },
  link: {
    color: color.accentFg,
    fontWeight: 500,
    textDecoration: {
      default: "none",
      ":hover": { default: null, [media.hover]: "underline" },
    },
  },
  full: { width: "100%" },
});

const styles = stylex.create({
  // A logbook's ruled page, fading out toward the edges: the first screen says what Worklog is
  // before a word is read. The card sits on it like an index card.
  page: {
    position: "relative",
    isolation: "isolate",
    minHeight: "100dvh",
    display: "grid",
    placeItems: "center",
    padding: space.x3,
    backgroundColor: color.surface,
    "::before": {
      content: '""',
      position: "absolute",
      inset: 0,
      zIndex: -1,
      backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 27px, ${color.line} 27px 28px)`,
      maskImage:
        "radial-gradient(ellipse 70% 60% at 50% 45%, black 20%, transparent 75%)",
      pointerEvents: "none",
    },
  },
  column: {
    width: "100%",
    maxWidth: 380,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.xxl,
  },
  card: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: space.xl,
    padding: space.x3,
    borderRadius: radius.lg,
    backgroundColor: color.raised,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.line,
  },
  head: { display: "flex", flexDirection: "column", gap: space.xs },
  title: {
    fontSize: text.title,
    lineHeight: leading.title,
    fontWeight: 600,
    letterSpacing: "-0.01em",
  },
  subtitle: {
    fontSize: text.label,
    lineHeight: leading.label,
    color: color.fgMuted,
  },
  footer: {
    fontSize: text.meta,
    color: color.fgMuted,
    textAlign: "center",
  },
});
