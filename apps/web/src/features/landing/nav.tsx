import {
  BookOpenIcon,
  BracketsCurlyIcon,
  GitPullRequestIcon,
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
import { ProductMark } from "#ui/product-mark";
import { color, media, motion, radius, shadow, space } from "#ui/tokens.stylex";

import { DEPLOY, doc, SOURCE } from "./links";
import { NavMenu } from "./menus";
import type { NavItem } from "./menus";
import { cta, focus } from "./styles";

// Full paths, so the bar works the same from the pricing page as from the front page.
const LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/changelog", label: "Changelog" },
];

// Each tile's glyph in a colour of its own, as resurf's are: on the dark panel they're how the eye
// tells six tiles apart before reading them.
const RESOURCES: NavItem[] = [
  {
    title: "Self-hosting",
    href: DEPLOY,
    icon: BookOpenIcon,
    tint: "oklch(0.74 0.17 55)",
  },
  {
    title: "FAQ",
    href: "/faq",
    icon: QuestionIcon,
    tint: "oklch(0.72 0.15 235)",
  },
  {
    title: "API docs",
    href: "/docs",
    icon: BracketsCurlyIcon,
    tint: "oklch(0.72 0.14 295)",
  },
  {
    title: "Connectors",
    href: doc("CONNECTORS"),
    icon: PlugsIcon,
    tint: "oklch(0.72 0.17 350)",
  },
  {
    title: "Roadmap",
    href: `${SOURCE}#roadmap`,
    icon: MapTrifoldIcon,
    tint: "oklch(0.82 0.16 85)",
  },
  {
    title: "Contributing",
    href: `${SOURCE}/blob/main/CONTRIBUTING.md`,
    icon: GitPullRequestIcon,
    tint: "oklch(0.76 0.14 175)",
  },
];

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
  // An open menu keeps the highlight on its trigger, as the pressed state of the button.
  const held = useRef(false);
  function point(event: MouseEvent<HTMLElement>) {
    clearTimeout(clear.current);
    const target = event.currentTarget;
    setHover({ left: target.offsetLeft, width: target.offsetWidth });
  }
  function leave() {
    if (held.current) {
      return;
    }
    clear.current = setTimeout(() => setHover(null), 40);
  }
  function hold(menuOpen: boolean) {
    held.current = menuOpen;
    if (!menuOpen) {
      leave();
    }
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

  // Getting started is signing in: a new person names their workspace next. A fresh server
  // starts by setting up its first workspace instead.
  const to = setupOpen ? "/setup" : "/login";

  return (
    <nav aria-label="Worklog" {...stylex.props(styles.bar)}>
      <div aria-hidden {...stylex.props(styles.blur)} />
      <div aria-hidden {...stylex.props(styles.fade)} />
      <a href="/" {...stylex.props(focus.ring, styles.brand)}>
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
              {...stylex.props(focus.ring, styles.link)}
            >
              {link.label}
            </a>
          </li>
        ))}
        <li>
          <NavMenu
            label="Resources"
            items={RESOURCES}
            trigger={[focus.ring, styles.link]}
            onPoint={point}
            onLeave={leave}
            onOpenChange={hold}
          />
        </li>
      </ul>
      <div {...stylex.props(styles.end)}>
        <a
          href={SOURCE}
          {...stylex.props(focus.ring, styles.quietLink, styles.desktopOnly)}
        >
          <ProductMark product="github" size={16} />
          GitHub
        </a>
        <Link
          to={to}
          {...stylex.props(
            cta.base,
            cta.small,
            past ? cta.primary : styles.quiet,
            styles.desktopOnly
          )}
        >
          Get started
        </Link>
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="landing-menu"
          onClick={() => setOpen((now) => !now)}
          {...stylex.props(focus.ring, styles.menuButton)}
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
              {...stylex.props(focus.ring, styles.menuLink)}
            >
              {link.label}
            </a>
          ))}
          <a
            href="/faq"
            onClick={() => setOpen(false)}
            {...stylex.props(focus.ring, styles.menuLink)}
          >
            FAQ
          </a>
          <a
            href={SOURCE}
            onClick={() => setOpen(false)}
            {...stylex.props(focus.ring, styles.menuLink)}
          >
            GitHub
          </a>
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
      "linear-gradient(to bottom, oklch(0.982 0.003 80 / 0.85), oklch(0.982 0.003 80 / 0.45), transparent)",
  },
  brand: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.md,
    justifySelf: "start",
    // A 22px mark is too small to tap; the padding gives it a 40px target and the margin takes the
    // padding back, so the mark stays where it was.
    padding: 9,
    margin: -9,
    color: color.fg,
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    textDecoration: "none",
    borderRadius: radius.sm,
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
    backgroundColor: "oklch(0.2 0.01 80 / 0.07)",
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
      default: "oklch(0.22 0.01 80 / 0.7)",
      ":hover": { default: null, [media.hover]: color.fg },
    },
    fontSize: 13,
    fontWeight: 500,
    textDecoration: "none",
    transitionProperty: "color",
    transitionDuration: "200ms",
  },
  end: {
    display: "flex",
    alignItems: "center",
    gap: space.xs,
    justifySelf: "end",
  },
  quietLink: {
    alignItems: "center",
    gap: space.sm,
    height: 28,
    paddingInline: 10,
    borderRadius: radius.md,
    color: {
      default: "oklch(0.22 0.01 80 / 0.7)",
      ":hover": { default: null, [media.hover]: color.fg },
    },
    fontSize: 13,
    fontWeight: 500,
    textDecoration: "none",
    transitionProperty: "color",
    transitionDuration: "200ms",
  },
  quiet: {
    backgroundColor: {
      default: "oklch(0.2 0.01 80 / 0.08)",
      ":hover": {
        default: null,
        [media.hover]: "oklch(0.2 0.01 80 / 0.13)",
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
      ":active": "oklch(0.2 0.01 80 / 0.06)",
    },
    color: color.fgMuted,
    cursor: "pointer",
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
  },
  menuAction: {
    marginTop: space.md,
    height: 44,
  },
});
