import * as stylex from "@stylexjs/stylex";

import {
  color,
  font,
  media,
  motion,
  radius,
  space,
  text,
} from "#ui/tokens.stylex";

// The landing page's type and buttons. The app inside the demos keeps the app's own sizes; these
// are the page around them, set larger, as print sets a headline over its body.

export const page = stylex.create({
  wide: {
    width: "100%",
    maxWidth: 1104,
    marginInline: "auto",
    paddingInline: {
      default: space.x3,
      "@media (max-width: 640px)": space.xl,
    },
  },
  narrow: {
    width: "100%",
    maxWidth: 760,
    marginInline: "auto",
    paddingInline: {
      default: space.x3,
      "@media (max-width: 640px)": space.xl,
    },
  },
  section: {
    paddingTop: {
      default: 160,
      "@media (max-width: 640px)": 104,
    },
    // A nav link lands with the heading a comfortable step under the sticky bar, not a whole
    // section's padding below it.
    scrollMarginTop: {
      default: -80,
      "@media (max-width: 640px)": -40,
    },
  },
  intro: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.xl,
    marginBottom: {
      default: 56,
      "@media (max-width: 640px)": 40,
    },
    textAlign: "center",
  },
});

export const type = stylex.create({
  display: {
    margin: 0,
    fontFamily: font.display,
    fontSize: "clamp(40px, 6.4vw, 66px)",
    lineHeight: 1.02,
    fontWeight: 500,
    letterSpacing: "-0.028em",
    fontOpticalSizing: "auto",
    textWrap: "balance",
  },
  heading: {
    margin: 0,
    fontFamily: font.display,
    fontSize: "clamp(34px, 5vw, 48px)",
    lineHeight: 1.06,
    fontWeight: 500,
    letterSpacing: "-0.022em",
    textWrap: "balance",
  },
  lede: {
    margin: 0,
    fontSize: {
      default: 18,
      "@media (max-width: 640px)": 17,
    },
    lineHeight: 1.55,
    color: color.fgMuted,
    textWrap: "pretty",
  },
  tileTitle: {
    margin: 0,
    fontSize: 17,
    lineHeight: "24px",
    fontWeight: 500,
    letterSpacing: "-0.01em",
    color: color.fg,
  },
  tileCopy: {
    margin: 0,
    fontSize: text.copy,
    lineHeight: "21px",
    color: color.fgMuted,
    textWrap: "pretty",
  },
});

export const cta = stylex.create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.md,
    height: 44,
    paddingInline: space.xxl,
    borderRadius: radius.lg,
    fontSize: 15,
    fontWeight: 500,
    textDecoration: "none",
    whiteSpace: "nowrap",
    cursor: "pointer",
    transitionProperty: "background-color, transform",
    transitionDuration: motion.fast,
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
        [media.hover]: "light-dark(oklch(0.32 0.01 80), oklch(0.86 0.004 80))",
      },
    },
    color: color.bg,
  },
  secondary: {
    backgroundColor: {
      default: color.ui,
      ":hover": { default: null, [media.hover]: color.uiActive },
    },
    color: color.fg,
  },
  small: {
    height: 32,
    paddingInline: space.lg,
    borderRadius: radius.md,
    fontSize: text.label,
  },
});
