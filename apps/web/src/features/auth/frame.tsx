import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { NeedsYou } from "#features/landing/features";
import ink from "#features/landing/plates/ink.webp";
import { Logo } from "#ui/logo";
import {
  color,
  font,
  leading,
  media,
  radius,
  space,
  text,
} from "#ui/tokens.stylex";

/**
 * The sign-in and setup screens: the form on one side, and on the other the promise it leads
 * to, the short list of what needs you, on one of the front page's wallpapers. A phone keeps
 * only the form.
 */
export function AuthFrame({
  title,
  subtitle,
  children,
  footer,
  legal = false,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Where an account is made: say which terms it's made under. */
  legal?: boolean;
}) {
  return (
    <main {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.side)}>
        <a href="/" {...stylex.props(styles.brand)}>
          <Logo size={22} />
          Worklog
        </a>
        <div {...stylex.props(styles.column)}>
          <div {...stylex.props(styles.head)}>
            <h1 {...stylex.props(styles.title)}>{title}</h1>
            {subtitle !== undefined && (
              <p {...stylex.props(styles.subtitle)}>{subtitle}</p>
            )}
          </div>
          {children}
          {footer !== undefined && (
            <div {...stylex.props(styles.footer)}>{footer}</div>
          )}
        </div>
        <p {...stylex.props(styles.legal)}>
          {legal && (
            <>
              By continuing you agree to the{" "}
              <a href="/terms" {...stylex.props(styles.legalLink)}>
                Terms of use
              </a>{" "}
              and{" "}
              <a href="/privacy" {...stylex.props(styles.legalLink)}>
                Privacy policy
              </a>
              .
            </>
          )}
        </p>
      </div>
      <aside aria-hidden {...stylex.props(styles.art)}>
        <img
          src={ink}
          alt=""
          decoding="async"
          {...stylex.props(styles.plate)}
        />
        <div {...stylex.props(styles.preview)}>
          <NeedsYou />
        </div>
        <p {...stylex.props(styles.caption)}>
          Only what needs you, each with why it’s there.
        </p>
      </aside>
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

const WIDE = "@media (min-width: 960px)";

const styles = stylex.create({
  page: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr)",
      [WIDE]: "minmax(0, 1fr) minmax(0, 1fr)",
    },
    minHeight: "100dvh",
    backgroundColor: color.surface,
  },
  side: {
    display: "flex",
    flexDirection: "column",
    paddingBlock: space.x3,
    paddingInline: {
      default: space.x3,
      [WIDE]: space.x5,
    },
  },
  brand: {
    display: "inline-flex",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: space.md,
    color: color.fg,
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    textDecoration: "none",
    borderRadius: radius.sm,
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
    outlineOffset: 3,
  },
  // The form sits a little above the middle, where the eye starts on a tall screen.
  column: {
    display: "flex",
    flexDirection: "column",
    gap: space.x3,
    width: "100%",
    maxWidth: 360,
    marginInline: "auto",
    marginBlock: "auto",
    paddingBlock: space.x5,
  },
  head: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
  },
  title: {
    margin: 0,
    fontFamily: font.display,
    fontSize: 34,
    lineHeight: "40px",
    // design-allow: the public pages' serif headline weight, between Newsreader's light and regular
    fontWeight: 360,
    fontOpticalSizing: "none",
    fontVariationSettings: "'opsz' 18",
    letterSpacing: "-0.025em",
    textWrap: "balance",
  },
  subtitle: {
    margin: 0,
    fontSize: 15,
    lineHeight: "23px",
    color: color.fgMuted,
    textWrap: "pretty",
  },
  footer: {
    fontSize: text.label,
    lineHeight: leading.label,
    color: color.fgMuted,
  },
  legal: {
    margin: 0,
    minHeight: 18,
    maxWidth: 360,
    marginInline: "auto",
    fontSize: text.meta,
    lineHeight: "18px",
    color: color.fgMuted,
    textAlign: "center",
    textWrap: "balance",
  },
  legalLink: {
    color: "inherit",
    textDecorationLine: "underline",
    textDecorationColor: color.lineStrong,
    textUnderlineOffset: 2,
    borderRadius: radius.xs,
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
    outlineOffset: 2,
  },
  // The picture is always light, as the front page is, whatever theme the app is in.
  // Its text colour is set here too: inherited from a dark page, it would stay light on the
  // picture's white cards.
  art: {
    colorScheme: "light",
    color: color.fg,
    position: "relative",
    display: {
      default: "none",
      [WIDE]: "flex",
    },
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: space.x3,
    margin: space.md,
    overflow: "hidden",
    isolation: "isolate",
    borderRadius: 16,
    backgroundColor: color.ui,
  },
  plate: {
    position: "absolute",
    inset: 0,
    zIndex: -1,
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  // Drawn at the grid's own size and enlarged, so the panel shows it at a reading size.
  preview: {
    width: "100%",
    maxWidth: 560,
    paddingInline: space.x4,
    transform: "scale(1.2)",
    marginBottom: space.x4,
  },
  caption: {
    margin: 0,
    paddingBlock: space.sm,
    paddingInline: space.lg,
    borderRadius: radius.full,
    backgroundColor: "oklch(1 0 0 / 0.85)",
    backdropFilter: "blur(12px)",
    color: color.fg,
    fontSize: text.label,
    fontWeight: 500,
  },
});
