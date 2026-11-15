import { DesktopIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { useRef } from "react";

import { setTheme, useTheme } from "#lib/theme";
import type { Theme } from "#lib/theme";
import { Logo } from "#ui/logo";
import { color, media, motion, radius, space } from "#ui/tokens.stylex";

import { DEPLOY, SOURCE } from "./hero";
import { useReveal } from "./script";
import { cta, page, reveal, type } from "./styles";

/** The last ask, then the way around. */
export function Closing({ setupOpen }: { setupOpen: boolean }) {
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
        to={setupOpen ? "/setup" : "/login"}
        {...stylex.props(cta.base, cta.primary, styles.action, rise(200))}
      >
        <Logo size={16} tinted />
        {setupOpen ? "Set up your workspace" : "Sign in to Worklog"}
      </Link>
      <p {...stylex.props(styles.fine, rise(250))}>
        <a href={DEPLOY} {...stylex.props(styles.fineLink)}>
          Docker Compose or Railway
        </a>{" "}
        · Your own Postgres · AI optional
      </p>
    </section>
  );
}

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Tour", href: "#tour" },
      { label: "Features", href: "#features" },
      { label: "Agents", href: "#agents" },
      { label: "Open by design", href: "#open" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "Connectors", href: `${SOURCE}/blob/main/docs/CONNECTORS.md` },
      {
        label: "Architecture",
        href: `${SOURCE}/blob/main/docs/ARCHITECTURE.md`,
      },
      { label: "Source on GitHub", href: SOURCE },
    ],
  },
];

export function Footer({ setupOpen }: { setupOpen: boolean }) {
  return (
    <footer {...stylex.props(page.narrow, styles.footer)}>
      <div {...stylex.props(styles.top)}>
        <div {...stylex.props(styles.brand)}>
          <a href="#top" {...stylex.props(styles.wordmark)}>
            <Logo size={18} />
            Worklog
          </a>
          <p {...stylex.props(styles.tagline)}>
            A shared record of what your team and its agents did, and of what
            needs whom.
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
            {setupOpen && (
              <Link to="/setup" {...stylex.props(styles.link)}>
                Set up a workspace
              </Link>
            )}
            <Link to="/login" {...stylex.props(styles.link)}>
              Sign in
            </Link>
            <a href={DEPLOY} {...stylex.props(styles.link)}>
              Host your own
            </a>
            <a href="/docs" {...stylex.props(styles.link)}>
              API reference
            </a>
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
          <Glyph size={14} weight={theme === each ? "fill" : "regular"} />
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
  fine: {
    margin: 0,
    marginTop: space.xxl,
    fontSize: 13,
    color: color.fgMuted,
    textWrap: "balance",
  },
  fineLink: {
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    textDecorationLine: "underline",
    textDecorationColor: color.lineStrong,
    textUnderlineOffset: 3,
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
      default: "repeat(3, minmax(0, 1fr))",
      "@media (max-width: 640px)": "repeat(2, minmax(0, 1fr))",
    },
    columnGap: space.x4,
    rowGap: 40,
    flexGrow: 1,
    maxWidth: 480,
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
    border: "none",
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
    border: "none",
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
