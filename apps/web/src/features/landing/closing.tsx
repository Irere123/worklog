import { DesktopIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { useRef } from "react";

import { setTheme, useTheme } from "#lib/theme";
import type { Theme } from "#lib/theme";
import { Logo } from "#ui/logo";
import { color, media, motion, radius, space } from "#ui/tokens.stylex";

import { DEPLOY, SOURCE, doc } from "./links";
import { useReveal } from "./script";
import { useStart } from "./start";
import { cta, page, reveal, type } from "./styles";

/** The last ask, then the way around. */
export function Closing() {
  const start = useStart();
  const ref = useRef<HTMLElement>(null);
  const on = useReveal(ref);
  const rise = (ms: number) => [reveal.line, reveal.delay(ms), on && reveal.on];
  return (
    <section
      ref={ref}
      {...stylex.props(page.wide, page.section, styles.closing)}
    >
      <h2 {...stylex.props(type.heading, rise(50))}>
        Start your team’s logbook.
      </h2>
      <Link
        to={start}
        {...stylex.props(cta.base, cta.primary, styles.action, rise(200))}
      >
        <Logo size={16} tinted />
        Start free
      </Link>
      <ul {...stylex.props(styles.fine, rise(250))}>
        <li>Free for up to 3 people</li>
        <li aria-hidden {...stylex.props(styles.sep)}>
          ·
        </li>
        <li>No card to start</li>
        <li aria-hidden {...stylex.props(styles.sep)}>
          ·
        </li>
        <li>
          <a href={DEPLOY} {...stylex.props(styles.fineLink)}>
            Or host it yourself, free
          </a>
        </li>
      </ul>
    </section>
  );
}

// Full paths, so the footer works the same from every public page.
const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/#features" },
      { label: "Pricing", href: "/pricing" },
      { label: "Changelog", href: "/changelog" },
      { label: "Self-hosting", href: DEPLOY },
    ],
  },
  {
    title: "Learn",
    links: [
      { label: "FAQ", href: "/faq" },
      { label: "API reference", href: "/docs" },
      { label: "Connectors", href: doc("CONNECTORS") },
      { label: "Architecture", href: doc("ARCHITECTURE") },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "Source on GitHub", href: SOURCE },
      { label: "Roadmap", href: `${SOURCE}#roadmap` },
      { label: "Contributing", href: `${SOURCE}/blob/main/CONTRIBUTING.md` },
      { label: "License", href: `${SOURCE}/blob/main/LICENSE` },
    ],
  },
];

export function Footer({ setupOpen }: { setupOpen: boolean }) {
  const start = useStart();
  return (
    <footer {...stylex.props(page.narrow, styles.footer)}>
      <div {...stylex.props(styles.top)}>
        <div {...stylex.props(styles.brand)}>
          <a href="/" {...stylex.props(styles.wordmark)}>
            <Logo size={18} />
            Worklog
          </a>
          <p {...stylex.props(styles.tagline)}>
            The open-source team logbook. On Worklog Cloud, or on your own
            server.
          </p>
        </div>
        <div {...stylex.props(styles.columns)}>
          {COLUMNS.map((column) => (
            <nav
              key={column.title}
              aria-label={column.title}
              {...stylex.props(styles.column)}
            >
              <span {...stylex.props(styles.columnTitle)}>{column.title}</span>
              {column.links.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  {...stylex.props(styles.link)}
                >
                  {link.label}
                </a>
              ))}
            </nav>
          ))}
          <nav aria-label="Get started" {...stylex.props(styles.column)}>
            <span {...stylex.props(styles.columnTitle)}>Get started</span>
            <Link to={start} {...stylex.props(styles.link)}>
              {setupOpen ? "Set up a workspace" : "Start free"}
            </Link>
            <Link to="/login" {...stylex.props(styles.link)}>
              Sign in
            </Link>
            <Link to="/pricing" {...stylex.props(styles.link)}>
              Compare plans
            </Link>
          </nav>
        </div>
      </div>
      <div {...stylex.props(styles.bottom)}>
        <span>© 2026 Worklog</span>
        <ThemeSwitch />
      </div>
    </footer>
  );
}

const THEMES: { theme: Theme; label: string; icon: Icon }[] = [
  { theme: "system", label: "System", icon: DesktopIcon },
  { theme: "light", label: "Light", icon: SunIcon },
  { theme: "dark", label: "Dark", icon: MoonIcon },
];

function ThemeSwitch() {
  const theme = useTheme();
  return (
    <fieldset aria-label="Theme" {...stylex.props(styles.themes)}>
      {THEMES.map(({ theme: each, label, icon: Glyph }) => (
        <button
          key={each}
          type="button"
          aria-pressed={theme === each}
          aria-label={label}
          title={label}
          onClick={() => setTheme(each)}
          {...stylex.props(styles.theme, theme === each && styles.themeOn)}
        >
          <Glyph size={14} />
        </button>
      ))}
    </fieldset>
  );
}

const styles = stylex.create({
  closing: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
  },
  action: {
    marginTop: 40,
    paddingLeft: 18,
  },
  // The hero's row of facts again: one line on a wide screen, a stack on a phone, so no dot is
  // ever left at a line's end.
  fine: {
    display: "flex",
    flexDirection: {
      default: "row",
      "@media (max-width: 640px)": "column",
    },
    alignItems: "center",
    gap: {
      default: space.md,
      "@media (max-width: 640px)": space.sm,
    },
    margin: 0,
    marginTop: space.xxl,
    padding: 0,
    listStyle: "none",
    fontSize: 13,
    lineHeight: "20px",
    color: color.fgMuted,
  },
  sep: {
    display: {
      default: "list-item",
      "@media (max-width: 640px)": "none",
    },
    color: "light-dark(oklch(0.22 0.01 80 / 0.3), oklch(0.94 0.004 80 / 0.3))",
  },
  fineLink: {
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    textDecoration: "none",
    borderRadius: radius.xs,
    transitionProperty: "color",
    transitionDuration: motion.fast,
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
    outlineOffset: 2,
  },
  footer: {
    display: "flex",
    flexDirection: "column",
    paddingTop: 128,
    paddingBottom: space.x4,
  },
  top: {
    display: "flex",
    flexDirection: {
      default: "row",
      "@media (max-width: 1023px)": "column",
    },
    justifyContent: "space-between",
    gap: {
      default: 64,
      "@media (max-width: 1023px)": 48,
    },
    paddingTop: 40,
    paddingBottom: 48,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor:
      "light-dark(oklch(0.2 0.01 80 / 0.07), oklch(1 0 0 / 0.08))",
  },
  brand: {
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
    flexShrink: 0,
    width: {
      default: 220,
      "@media (max-width: 1023px)": "auto",
    },
  },
  wordmark: {
    display: "inline-flex",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: space.sm,
    color: color.fg,
    fontSize: 14,
    fontWeight: 600,
    textDecoration: "none",
    borderRadius: radius.xs,
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
    outlineOffset: 3,
  },
  tagline: {
    margin: 0,
    maxWidth: 220,
    fontSize: 13,
    lineHeight: "20px",
    color: color.fgMuted,
  },
  columns: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(4, minmax(0, 1fr))",
      "@media (max-width: 640px)": "repeat(2, minmax(0, 1fr))",
    },
    columnGap: space.x4,
    rowGap: 40,
    flexGrow: 1,
    maxWidth: 600,
  },
  column: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    minWidth: 0,
  },
  columnTitle: {
    paddingBottom: space.md,
    fontSize: 13,
    lineHeight: "20px",
    fontWeight: 500,
    color: color.fg,
  },
  link: {
    display: "block",
    paddingBlock: space.xs,
    fontSize: 13,
    lineHeight: "20px",
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    textDecoration: "none",
    transitionProperty: "color",
    transitionDuration: motion.fast,
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
    outlineOffset: 2,
    borderRadius: radius.xs,
  },
  bottom: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    columnGap: space.xl,
    rowGap: space.xs,
    paddingTop: space.x3,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor:
      "light-dark(oklch(0.2 0.01 80 / 0.07), oklch(1 0 0 / 0.08))",
    fontSize: 12,
    lineHeight: "20px",
    color: color.fgMuted,
  },
  themes: {
    display: "flex",
    minWidth: 0,
    margin: 0,
    borderWidth: 0,
    borderStyle: "none",
    gap: space.xxs,
    padding: space.xxs,
    borderRadius: radius.full,
    backgroundColor: color.ui,
  },
  theme: {
    display: "grid",
    placeItems: "center",
    width: 28,
    height: 28,
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: radius.full,
    backgroundColor: "transparent",
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    cursor: "pointer",
    transitionProperty: "background-color, color",
    transitionDuration: motion.fast,
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
    outlineOffset: 1,
  },
  themeOn: {
    backgroundColor: color.raised,
    color: color.fg,
    boxShadow: `0 0 0 1px ${color.line}`,
  },
});
