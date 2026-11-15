import * as stylex from "@stylexjs/stylex";

import { color, font, media, motion, space } from "#ui/tokens.stylex";

// The landing page's measure and type. The app inside the demos keeps the app's own sizes; the
// page around them is quieter: a light serif over small, grey sans, and a 960px column.

const PHONE = "@media (max-width: 640px)";

export const page = stylex.create({
  wide: {
    width: "100%",
    maxWidth: 1024,
    marginInline: "auto",
    paddingInline: {
      default: space.x4,
      [PHONE]: space.x3,
    },
  },
  narrow: {
    width: "100%",
    maxWidth: 896,
    marginInline: "auto",
    paddingInline: {
      default: space.x4,
      [PHONE]: space.x3,
    },
  },
  section: {
    paddingTop: {
      default: 128,
      [PHONE]: 96,
    },
    // A nav link lands with the heading a comfortable step under the sticky bar, not a whole
    // section's padding below it.
    scrollMarginTop: {
      default: -64,
      [PHONE]: -40,
    },
  },
  intro: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.xxl,
    marginBottom: {
      default: 48,
      [PHONE]: 40,
    },
    textAlign: "center",
  },
  // The page's surfaces: a quiet fill a step off the page, with no edge drawn.
  tile: {
    borderRadius: 16,
    backgroundColor: "oklch(0.2 0.01 80 / 0.04)",
  },
});

export const type = stylex.create({
  display: {
    margin: 0,
    fontFamily: font.display,
    // A step above resurf's 45px: Newsreader's x-height is smaller than Signifier's, so the same
    // size reads small beside it.
    fontSize: {
      default: 48,
      "@media (max-width: 768px)": 42,
      [PHONE]: 36,
    },
    lineHeight: {
      default: "54px",
      "@media (max-width: 768px)": "48px",
      [PHONE]: "41px",
    },
    // Newsreader's display cut is all hairline at this weight; its text cut, set large, has the
    // even, sturdy stroke of a book face, which is the voice the page wants.
    // design-allow: the serif headlines sit between Newsreader's light and regular
    fontWeight: 360,
    fontOpticalSizing: "none",
    fontVariationSettings: "'opsz' 18",
    letterSpacing: "-0.035em",
    textWrap: "balance",
  },
  heading: {
    margin: 0,
    maxWidth: 640,
    fontFamily: font.display,
    fontSize: {
      default: 42,
      "@media (max-width: 768px)": 38,
      [PHONE]: 34,
    },
    lineHeight: 1.1,
    // design-allow: the serif headlines sit between Newsreader's light and regular
    fontWeight: 360,
    fontOpticalSizing: "none",
    fontVariationSettings: "'opsz' 18",
    letterSpacing: "-0.025em",
    textWrap: "balance",
  },
  lede: {
    margin: 0,
    maxWidth: 520,
    fontSize: 16,
    lineHeight: "24px",
    color: color.fgMuted,
    textWrap: "balance",
  },
  tileTitle: {
    margin: 0,
    fontSize: 16,
    lineHeight: "24px",
    fontWeight: 500,
    letterSpacing: "-0.025em",
    color: color.fg,
  },
  tileCopy: {
    margin: 0,
    fontSize: 13,
    lineHeight: "21px",
    color: color.fgMuted,
    textWrap: "pretty",
  },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    height: 20,
    paddingInline: space.md,
    borderRadius: 999,
    backgroundColor: "oklch(0.2 0.01 80 / 0.08)",
    color: color.fg,
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: "normal",
    whiteSpace: "nowrap",
  },
});

// The ring a keyboard focus draws, shared by every control on the public pages.
const RING = {
  outline: {
    default: "none",
    ":focus-visible": `2px solid ${color.focus}`,
  },
  outlineOffset: 2,
} as const;

export const focus = stylex.create({
  ring: RING,
});

// The two kinds of link the pages use: a quiet grey one that darkens on hover (facts, footers),
// and an underlined one inside a sentence.
export const links = stylex.create({
  quiet: {
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    textDecoration: "none",
    transitionProperty: "color",
    transitionDuration: motion.fast,
    borderRadius: 4,
    ...RING,
  },
  inline: {
    color: {
      default: color.fg,
      ":hover": { default: null, [media.hover]: color.accentFg },
    },
    textDecorationLine: "underline",
    textDecorationColor: color.lineStrong,
    textUnderlineOffset: 3,
    transitionProperty: "color",
    transitionDuration: motion.fast,
    borderRadius: 4,
    ...RING,
  },
});

export const cta = stylex.create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    height: 40,
    paddingInline: space.xxl,
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 500,
    textDecoration: "none",
    whiteSpace: "nowrap",
    cursor: "pointer",
    transitionProperty: "background-color, color, transform",
    transitionDuration: "200ms",
    transitionTimingFunction: motion.out,
    transform: { default: null, ":active": "scale(0.97)" },
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
    outlineOffset: 2,
  },
  primary: {
    backgroundColor: {
      default: color.fg,
      ":hover": {
        default: null,
        [media.hover]: "oklch(0.32 0.01 80)",
      },
    },
    color: color.bg,
  },
  secondary: {
    backgroundColor: {
      default: "oklch(0.2 0.01 80 / 0.05)",
      ":hover": {
        default: null,
        [media.hover]: "oklch(0.2 0.01 80 / 0.1)",
      },
    },
    color: color.fg,
  },
  small: {
    height: 28,
    gap: space.xs,
    paddingInline: 10,
    fontSize: 12,
  },
});
