import {
  BracketsCurlyIcon,
  CloudIcon,
  GitPullRequestIcon,
  GithubLogoIcon,
  HardDrivesIcon,
  ListIcon,
  MapTrifoldIcon,
  PlugsIcon,
  QuestionIcon,
  XIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";

import { Logo } from "#ui/logo";
import { color, media, motion, radius, shadow, space } from "#ui/tokens.stylex";

import { DEPLOY, SOURCE } from "./links";
import { NavMenu } from "./menus";
import type { NavItem } from "./menus";
import { cta } from "./styles";

// Full paths, so the bar works the same from the pricing page as from the front page.
const LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/changelog", label: "Changelog" },
];

const RESOURCES: NavItem[] = [
  {
    title: "FAQ",
    detail: "Plain answers before you start",
    href: "/faq",
    icon: QuestionIcon,
  },
  {
    title: "Connectors",
    detail: "Every tool Worklog reads, and how",
    href: `${SOURCE}/blob/main/docs/CONNECTORS.md`,
    icon: PlugsIcon,
  },
  {
    title: "Roadmap",
    detail: "What we’re building next",
    href: `${SOURCE}#roadmap`,
    icon: MapTrifoldIcon,
  },
  {
    title: "Contributing",
    detail: "Set up the code and send a change",
    href: `${SOURCE}/blob/main/CONTRIBUTING.md`,
    icon: GitPullRequestIcon,
  },
];

function waysIn(start: string): NavItem[] {
  return [
    {
      title: "Worklog Cloud",
      detail: "Start free in your browser",
      href: start,
      icon: CloudIcon,
    },
    {
      title: "Self-host",
      detail: "Docker Compose or Railway",
      href: DEPLOY,
      icon: HardDrivesIcon,
    },
    {
      title: "API and agents",
      detail: "One API for scripts and agents",
      href: "/docs",
      icon: BracketsCurlyIcon,
    },
  ];
}

// Past the hero's own buttons, the bar's button takes over as the way in, so it darkens to match.
const PAST_HERO = 460;

/**
 * The bar along the top. It has no edge: the page fades and blurs beneath it instead, so content
 * scrolls away under it rather than being cut by a line.
 */
export function Nav({ setupOpen }: { setupOpen: boolean }) {
  const [past, setPast] = useState(false);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<{ left: number; width: number } | null>(
    null
  );

  // Leaving one link for the next clears and then sets the highlight; the clear waits a tick so
  // the move between neighbours slides instead of fading out and back in.
  const clear = useRef<ReturnType<typeof setTimeout>>(undefined);
  function point(event: MouseEvent<HTMLElement>) {
    clearTimeout(clear.current);
    const target = event.currentTarget;
    setHover({ left: target.offsetLeft, width: target.offsetWidth });
  }
  function leave() {
    clear.current = setTimeout(() => setHover(null), 40);
  }

  useEffect(() => {
    const check = () => setPast(window.scrollY > PAST_HERO);
    check();
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, []);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    if (open) {
      window.addEventListener("keydown", close);
    }
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  // A fresh server starts with setting up its first workspace; any other starts at sign-in.
  const to = setupOpen ? "/setup" : "/login";

  return (
    <nav aria-label="Worklog" {...stylex.props(styles.bar)}>
      <div aria-hidden {...stylex.props(styles.blur)} />
      <div aria-hidden {...stylex.props(styles.fade)} />
      <a href="#top" {...stylex.props(styles.brand)}>
        <Logo size={22} />
      </a>
      <ul {...stylex.props(styles.links)}>
        <li
          aria-hidden
          {...stylex.props(
            styles.highlight,
            hover && styles.highlightOn,
            hover && styles.place(hover.left, hover.width)
          )}
        />
        {LINKS.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              onMouseEnter={point}
              onMouseLeave={leave}
              {...stylex.props(styles.link)}
            >
              {link.label}
            </a>
          </li>
        ))}
        <li>
          <NavMenu
            label="Resources"
            items={RESOURCES}
            trigger={styles.link}
            onPoint={point}
            onLeave={leave}
          />
        </li>
      </ul>
      <div {...stylex.props(styles.end)}>
        <a
          href={SOURCE}
          aria-label="Worklog on GitHub"
          {...stylex.props(styles.quietLink, styles.desktopOnly)}
        >
          <GithubLogoIcon size={16} weight="fill" />
        </a>
        <Link
          to="/login"
          {...stylex.props(styles.quietLink, styles.desktopOnly)}
        >
          Sign in
        </Link>
        <span {...stylex.props(styles.desktopOnly)}>
          <NavMenu
            label="Get started"
            items={waysIn(to)}
            align="end"
            trigger={[cta.base, cta.small, past ? cta.primary : styles.quiet]}
          />
        </span>
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="landing-menu"
          onClick={() => setOpen((now) => !now)}
          {...stylex.props(styles.menuButton)}
        >
          {open ? <XIcon size={18} /> : <ListIcon size={18} />}
        </button>
      </div>
      {open && (
        <div id="landing-menu" {...stylex.props(styles.menu)}>
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              {...stylex.props(styles.menuLink)}
            >
              {link.label}
            </a>
          ))}
          <a
            href="/faq"
            onClick={() => setOpen(false)}
            {...stylex.props(styles.menuLink)}
          >
            FAQ
          </a>
          <a
            href={SOURCE}
            onClick={() => setOpen(false)}
            {...stylex.props(styles.menuLink)}
          >
            GitHub
          </a>
          <Link to="/login" {...stylex.props(styles.menuLink)}>
            Sign in
          </Link>
          <Link
            to={to}
            {...stylex.props(cta.base, cta.primary, styles.menuAction)}
          >
            Get started
          </Link>
        </div>
      )}
    </nav>
  );
}

const NARROW = "@media (max-width: 640px)";

const styles = stylex.create({
  bar: {
    position: "sticky",
    top: 0,
    zIndex: 30,
    display: "grid",
    gridTemplateColumns: {
      default: "1fr auto 1fr",
      [NARROW]: "1fr auto",
    },
    alignItems: "center",
    height: 60,
    paddingInline: {
      default: space.x3,
      [NARROW]: space.xl,
    },
  },
  // Two layers under the bar, taller than it: a blur that fades out halfway down, and the page's
  // own colour thinning to nothing, so scrolled content dims and softens before it reaches the bar.
  blur: {
    position: "absolute",
    insetInline: 0,
    top: 0,
    zIndex: -1,
    height: 112,
    pointerEvents: "none",
    backdropFilter: "blur(12px)",
    maskImage:
      "linear-gradient(to bottom, #000 0%, #000 50%, transparent 100%)",
  },
  fade: {
    position: "absolute",
    insetInline: 0,
    top: 0,
    zIndex: -1,
    height: 112,
    pointerEvents: "none",
    backgroundImage:
      "linear-gradient(to bottom, light-dark(oklch(0.982 0.003 80 / 0.85), oklch(0.19 0.004 80 / 0.85)), light-dark(oklch(0.982 0.003 80 / 0.45), oklch(0.19 0.004 80 / 0.45)), transparent)",
  },
  brand: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.md,
    justifySelf: "start",
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
  links: {
    position: "relative",
    display: {
      default: "flex",
      [NARROW]: "none",
    },
    alignItems: "center",
    gap: space.xs,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  // One shape that slides to whichever link the pointer is over, rather than each link lighting
  // its own: the eye follows a single object along the bar.
  highlight: {
    position: "absolute",
    top: 0,
    left: 0,
    height: 28,
    borderRadius: radius.md,
    backgroundColor:
      "light-dark(oklch(0.2 0.01 80 / 0.07), oklch(1 0 0 / 0.08))",
    opacity: 0,
    transform: "scale(1.3)",
    filter: "blur(2px)",
    pointerEvents: "none",
    transitionProperty: "opacity, transform, filter, left, width",
    transitionDuration: "200ms, 200ms, 200ms, 0ms, 0ms",
    transitionTimingFunction: motion.out,
  },
  highlightOn: {
    opacity: 1,
    transform: "none",
    filter: "none",
    transitionDuration: "200ms, 200ms, 200ms, 240ms, 240ms",
  },
  place: (left: number, width: number) => ({
    left,
    width,
  }),
  link: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    height: 28,
    paddingInline: space.lg,
    borderRadius: radius.full,
    // A menu's trigger is a button, which brings a grey fill of its own.
    backgroundColor: "transparent",
    color: {
      default:
        "light-dark(oklch(0.22 0.01 80 / 0.7), oklch(0.94 0.004 80 / 0.7))",
      ":hover": { default: null, [media.hover]: color.fg },
    },
    fontSize: 13,
    fontWeight: 500,
    textDecoration: "none",
    transitionProperty: "color",
    transitionDuration: "200ms",
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
    outlineOffset: 1,
  },
  end: {
    display: "flex",
    alignItems: "center",
    gap: space.xs,
    justifySelf: "end",
  },
  quietLink: {
    alignItems: "center",
    height: 28,
    paddingInline: 10,
    borderRadius: radius.md,
    color: {
      default:
        "light-dark(oklch(0.22 0.01 80 / 0.7), oklch(0.94 0.004 80 / 0.7))",
      ":hover": { default: null, [media.hover]: color.fg },
    },
    fontSize: 13,
    fontWeight: 500,
    textDecoration: "none",
    transitionProperty: "color",
    transitionDuration: "200ms",
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
    outlineOffset: 1,
  },
  quiet: {
    backgroundColor: {
      default: "light-dark(oklch(0.2 0.01 80 / 0.08), oklch(1 0 0 / 0.1))",
      ":hover": {
        default: null,
        [media.hover]:
          "light-dark(oklch(0.2 0.01 80 / 0.13), oklch(1 0 0 / 0.15))",
      },
    },
    color: color.fg,
  },
  desktopOnly: {
    display: {
      default: "inline-flex",
      [NARROW]: "none",
    },
  },
  menuButton: {
    display: {
      default: "none",
      [NARROW]: "grid",
    },
    placeItems: "center",
    width: 32,
    height: 32,
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: radius.md,
    backgroundColor: {
      default: "transparent",
      ":active": "light-dark(oklch(0.2 0.01 80 / 0.06), oklch(1 0 0 / 0.08))",
    },
    color: color.fgMuted,
    cursor: "pointer",
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
  },
  menu: {
    position: "absolute",
    top: 56,
    insetInline: space.xl,
    display: {
      default: "none",
      [NARROW]: "flex",
    },
    flexDirection: "column",
    padding: space.md,
    borderRadius: 16,
    backgroundColor: color.raised,
    boxShadow: shadow.float,
  },
  menuLink: {
    display: "flex",
    alignItems: "center",
    height: 44,
    paddingInline: space.lg,
    borderRadius: radius.md,
    color: color.fg,
    fontSize: 15,
    fontWeight: 500,
    textDecoration: "none",
    backgroundColor: {
      default: "transparent",
      ":active": color.ui,
    },
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
  },
  menuAction: {
    marginTop: space.md,
    height: 44,
  },
});
