import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { isShown } from "#lib/node";

import { color, leading, space, text } from "./tokens.stylex";

/** Every page's header: title on the left, actions on the right, in the same place everywhere. */
export function PageHeader({
  title,
  icon,
  subtitle,
  actions,
  children,
}: {
  title: ReactNode;
  icon?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header {...stylex.props(styles.header)}>
      <div {...stylex.props(styles.headerRow)}>
        <div {...stylex.props(styles.titleWrap)}>
          {isShown(icon) && <span {...stylex.props(styles.icon)}>{icon}</span>}
          <h1 {...stylex.props(styles.title)}>{title}</h1>
          {isShown(subtitle) && (
            <span {...stylex.props(styles.subtitle)}>{subtitle}</span>
          )}
        </div>
        {isShown(actions) && (
          <div {...stylex.props(styles.actions)}>{actions}</div>
        )}
      </div>
      {children}
    </header>
  );
}

export function Page({
  children,
  width = "wide",
  sx,
}: {
  children: ReactNode;
  width?: "narrow" | "reading" | "wide" | "full";
  sx?: StyleXStyles;
}) {
  return (
    <div {...stylex.props(styles.scroll)}>
      <div {...stylex.props(styles.page, widths[width], sx)}>{children}</div>
    </div>
  );
}

export function Section({
  title,
  aside,
  children,
  sx,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  sx?: StyleXStyles;
}) {
  return (
    <section {...stylex.props(styles.section, sx)}>
      <div {...stylex.props(styles.sectionHead)}>
        <h2 {...stylex.props(styles.sectionTitle)}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export const layout = stylex.create({
  row: { display: "flex", alignItems: "center", gap: space.md },
  rowTight: { display: "flex", alignItems: "center", gap: space.xs },
  stack: { display: "flex", flexDirection: "column", gap: space.md },
  grow: { flexGrow: 1, minWidth: 0 },
  muted: { color: color.fgMuted },
  faint: { color: color.fgFaint },
  meta: { fontSize: text.meta, lineHeight: leading.meta, color: color.fgMuted },
  num: { fontVariantNumeric: "tabular-nums" },
  truncate: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
});

const styles = stylex.create({
  header: {
    position: "sticky",
    top: 0,
    zIndex: 5,
    // Pages are fixed-height columns: a header whose actions wrap on a phone must grow, not be
    // squeezed under the scrolling content beside it.
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    paddingInline: { default: space.x3, "@media (max-width: 640px)": space.lg },
    paddingBlock: space.md,
    minHeight: 48,
    justifyContent: "center",
    backgroundColor: color.bg,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: space.lg,
    minHeight: 32,
    flexWrap: "wrap",
  },
  titleWrap: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    flexGrow: 1,
    minWidth: 0,
  },
  icon: { display: "grid", placeItems: "center", color: color.fgMuted },
  title: {
    fontSize: text.titleSm,
    lineHeight: leading.titleSm,
    fontWeight: 600,
    color: color.fg,
    whiteSpace: "nowrap",
  },
  subtitle: {
    display: { default: null, "@media (max-width: 640px)": "none" },
    fontSize: text.label,
    color: color.fgMuted,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.sm,
  },
  scroll: { flexGrow: 1, minHeight: 0, overflowY: "auto" },
  page: {
    marginInline: "auto",
    paddingInline: { default: space.x3, "@media (max-width: 640px)": space.lg },
    paddingTop: { default: space.x3, "@media (max-width: 640px)": space.xl },
    paddingBottom: 96,
  },
  section: { display: "flex", flexDirection: "column", gap: space.md },
  sectionHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    minHeight: 24,
  },
  sectionTitle: {
    fontSize: text.label,
    fontWeight: 600,
    color: color.fg,
  },
});

const widths = stylex.create({
  narrow: { maxWidth: 640 },
  reading: { maxWidth: 760 },
  wide: { maxWidth: 1120 },
  full: { maxWidth: "none" },
});
