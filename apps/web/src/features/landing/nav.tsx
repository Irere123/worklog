import { ListIcon, XIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { Logo } from "#ui/logo";
import { color, media, motion, radius, shadow, space } from "#ui/tokens.stylex";

import { cta } from "./styles";

const LINKS = [
  { href: "#tour", label: "Tour" },
  { href: "#features", label: "Features" },
  { href: "#agents", label: "Agents" },
  { href: "#open", label: "Developers" },
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
  function point(left: number, width: number) {
    clearTimeout(clear.current);
    setHover({ left, width });
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

  const to = setupOpen ? "/setup" : "/login";
  const label = setupOpen ? "Get started" : "Sign in";

  return (
    <nav aria-label="Worklog" {...stylex.props(styles.bar)}>
      <div aria-hidden {...stylex.props(styles.blur)} />
      <div aria-hidden {...stylex.props(styles.fade)} />
      <a href="#top" aria-label="Worklog" {...stylex.props(styles.brand)}>
        <Logo size={20} />
        <span>Worklog</span>
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
              onMouseEnter={(event) =>
                point(
                  event.currentTarget.offsetLeft,
                  event.currentTarget.offsetWidth
                )
              }
              onMouseLeave={leave}
              {...stylex.props(styles.link)}
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
      <div {...stylex.props(styles.end)}>
        <Link
          to={to}
          {...stylex.props(
            cta.base,
            cta.small,
            past ? cta.primary : styles.quiet,
            styles.desktopOnly
          )}
        >
          {label}
        </Link>
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
          <Link
            to={to}
            {...stylex.props(cta.base, cta.primary, styles.menuAction)}
          >
            {setupOpen ? "Set up your workspace" : "Sign in to Worklog"}
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
    border: "none",
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
