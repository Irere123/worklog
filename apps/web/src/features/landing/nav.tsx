import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Logo } from "#ui/logo";
import { color, media, motion, radius, space, text } from "#ui/tokens.stylex";

import { cta } from "./styles";

const LINKS = [
  { href: "#tour", label: "Tour" },
  { href: "#features", label: "Features" },
  { href: "#agents", label: "Agents" },
  { href: "#open", label: "Developers" },
];

/** The bar along the top. It gains a surface only once the page scrolls under it. */
export function Nav({ setupOpen }: { setupOpen: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const check = () => setScrolled(window.scrollY > 8);
    check();
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, []);

  return (
    <nav
      aria-label="Worklog"
      {...stylex.props(styles.bar, scrolled && styles.barScrolled)}
    >
      <a href="#top" {...stylex.props(styles.brand)}>
        <Logo size={26} />
        <span>Worklog</span>
      </a>
      <ul {...stylex.props(styles.links)}>
        {LINKS.map((link) => (
          <li key={link.href}>
            <a href={link.href} {...stylex.props(styles.link)}>
              {link.label}
            </a>
          </li>
        ))}
      </ul>
      <div {...stylex.props(styles.end)}>
        <Link to="/login" {...stylex.props(styles.link, styles.signIn)}>
          Sign in
        </Link>
        <Link
          to={setupOpen ? "/setup" : "/login"}
          {...stylex.props(cta.base, cta.small, cta.primary)}
        >
          {setupOpen ? "Get started" : "Open Worklog"}
        </Link>
      </div>
    </nav>
  );
}

const styles = stylex.create({
  bar: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    display: "grid",
    gridTemplateColumns: {
      default: "1fr auto 1fr",
      "@media (max-width: 760px)": "1fr auto",
    },
    alignItems: "center",
    height: 60,
    paddingInline: {
      default: space.x3,
      "@media (max-width: 640px)": space.xl,
    },
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: "transparent",
    transitionProperty: "background-color, border-color",
    transitionDuration: motion.slow,
  },
  barScrolled: {
    backgroundColor:
      "light-dark(oklch(0.982 0.003 80 / 0.82), oklch(0.165 0.004 80 / 0.82))",
    backdropFilter: "saturate(1.4) blur(14px)",
    borderBottomColor: color.line,
  },
  brand: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.md,
    justifySelf: "start",
    color: color.fg,
    fontSize: 16,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    textDecoration: "none",
  },
  links: {
    display: {
      default: "flex",
      "@media (max-width: 760px)": "none",
    },
    gap: space.xs,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  link: {
    display: "inline-flex",
    alignItems: "center",
    height: 32,
    paddingInline: space.lg,
    borderRadius: radius.md,
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    fontSize: text.copy,
    fontWeight: 500,
    textDecoration: "none",
    transitionProperty: "color, background-color",
    transitionDuration: motion.fast,
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
    outlineOffset: 1,
  },
  signIn: {
    display: {
      default: "inline-flex",
      "@media (max-width: 420px)": "none",
    },
  },
  end: {
    display: "flex",
    alignItems: "center",
    gap: space.xs,
    justifySelf: "end",
  },
});
