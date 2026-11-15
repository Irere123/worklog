import * as stylex from "@stylexjs/stylex";

import { Logo } from "#ui/logo";
import { ProductMark } from "#ui/product-mark";
import { color, media, motion, radius, space } from "#ui/tokens.stylex";

import { GitHubLink, StartLink } from "./actions";
import { DEPLOY, SOURCE, doc } from "./links";
import { page, type } from "./styles";

/** The last ask, then the way around. */
export function Closing() {
  return (
    <section {...stylex.props(page.wide, page.section, styles.closing)}>
      <h2 {...stylex.props(type.heading)}>Start your team’s logbook.</h2>
      <div {...stylex.props(styles.actions)}>
        <StartLink />
        <GitHubLink />
      </div>
      <ul {...stylex.props(styles.fine)}>
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
      { label: "Sign in", href: "/login" },
    ],
  },
  {
    title: "Learn",
    links: [
      { label: "FAQ", href: "/faq" },
      { label: "API docs", href: "/docs" },
      { label: "Connectors", href: doc("CONNECTORS") },
      { label: "Architecture", href: doc("ARCHITECTURE") },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "Source code", href: SOURCE },
      { label: "Roadmap", href: `${SOURCE}#roadmap` },
      { label: "Contributing", href: `${SOURCE}/blob/main/CONTRIBUTING.md` },
      { label: "License", href: `${SOURCE}/blob/main/LICENSE` },
    ],
  },
];

export function Footer() {
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
          <a href={SOURCE} {...stylex.props(styles.star)}>
            <ProductMark product="github" size={14} />
            Star on GitHub
          </a>
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
        </div>
      </div>
      <div {...stylex.props(styles.bottom)}>
        <span>© 2026 Worklog. Open source under the AGPL-3.0.</span>
        <nav aria-label="Legal" {...stylex.props(styles.legal)}>
          <a href="/terms" {...stylex.props(styles.fineFoot)}>
            Terms of use
          </a>
          <a href="/privacy" {...stylex.props(styles.fineFoot)}>
            Privacy policy
          </a>
        </nav>
      </div>
    </footer>
  );
}

const styles = stylex.create({
  closing: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
    marginTop: 40,
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
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    columnGap: {
      default: space.x4,
      "@media (max-width: 640px)": space.xl,
    },
    rowGap: 40,
    flexGrow: 1,
    maxWidth: 460,
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
    justifyContent: "space-between",
    columnGap: space.xl,
    rowGap: space.xs,
    paddingTop: space.xl,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor:
      "light-dark(oklch(0.2 0.01 80 / 0.07), oklch(1 0 0 / 0.08))",
    fontSize: 12,
    lineHeight: "20px",
    color: color.fgMuted,
  },
  star: {
    display: "inline-flex",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: space.sm,
    height: 28,
    marginTop: space.xs,
    paddingInline: 10,
    borderRadius: radius.md,
    backgroundColor: {
      default: color.raised,
      ":hover": { default: null, [media.hover]: color.surface },
    },
    boxShadow:
      "0 0 0 1px light-dark(oklch(0.2 0.01 80 / 0.1), oklch(1 0 0 / 0.12))",
    color: color.fg,
    fontSize: 12,
    fontWeight: 500,
    textDecoration: "none",
    transitionProperty: "background-color",
    transitionDuration: motion.fast,
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
    outlineOffset: 2,
  },
  legal: {
    display: "flex",
    gap: space.xl,
  },
  fineFoot: {
    color: {
      default: "inherit",
      ":hover": { default: null, [media.hover]: color.fg },
    },
    textDecoration: "none",
    transitionProperty: "color",
    transitionDuration: motion.fast,
    borderRadius: radius.xs,
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
    outlineOffset: 2,
  },
});
