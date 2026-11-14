import { DesktopIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";

import { setTheme, useTheme } from "#lib/theme";
import type { Theme } from "#lib/theme";
import { Logo } from "#ui/logo";
import { color, media, motion, radius, space, text } from "#ui/tokens.stylex";

import { DEPLOY, SOURCE } from "./hero";
import { cta, page, type } from "./styles";

/** The last ask, then the way around. */
export function Closing({ setupOpen }: { setupOpen: boolean }) {
  return (
    <section {...stylex.props(page.narrow, page.section, styles.closing)}>
      <h2 {...stylex.props(type.heading)}>Start your team’s logbook.</h2>
      <Link
        to={setupOpen ? "/setup" : "/login"}
        {...stylex.props(cta.base, cta.primary, styles.action)}
      >
        {setupOpen ? "Set up your workspace" : "Sign in to Worklog"}
      </Link>
      <p {...stylex.props(styles.fine)}>
        A few minutes with Docker Compose, and your team’s tools start writing
        it.
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
    <footer {...stylex.props(page.wide, styles.footer)}>
      <div {...stylex.props(styles.top)}>
        <div {...stylex.props(styles.brand)}>
          <span {...stylex.props(styles.wordmark)}>
            <Logo size={22} />
            Worklog
          </span>
          <p {...stylex.props(styles.tagline)}>
            Your team’s logbook. The tools and agents write it; everyone can
            read it.
          </p>
        </div>
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
    gap: space.x4,
    textAlign: "center",
  },
  action: {
    minWidth: 220,
  },
  fine: {
    margin: 0,
    marginTop: {
      default: `calc(${space.lg} * -1)`,
    },
    fontSize: text.label,
    color: color.fgMuted,
    textWrap: "balance",
  },
  footer: {
    marginTop: 140,
  },
  top: {
    display: "grid",
    gridTemplateColumns: {
      default: "2fr 1fr 1fr 1fr",
      "@media (max-width: 760px)": "1fr 1fr",
    },
    gap: space.x4,
    paddingTop: space.x5,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: color.line,
  },
  brand: {
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
    gridColumn: {
      default: "auto",
      "@media (max-width: 760px)": "1 / -1",
    },
  },
  wordmark: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.md,
    fontSize: 16,
    fontWeight: 600,
  },
  tagline: {
    margin: 0,
    maxWidth: 260,
    fontSize: text.copy,
    lineHeight: "21px",
    color: color.fgMuted,
  },
  column: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.md,
  },
  columnTitle: {
    marginBottom: space.xs,
    fontSize: text.copy,
    fontWeight: 600,
  },
  link: {
    fontSize: text.copy,
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
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space.x5,
    paddingBlock: space.x3,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: color.line,
    fontSize: text.label,
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
