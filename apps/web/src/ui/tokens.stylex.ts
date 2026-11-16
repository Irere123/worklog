import * as stylex from "@stylexjs/stylex";

// Every colour is a light-dark() pair, so the root's `color-scheme` alone picks the theme: no
// class swap, no flash, and "system" is just `light dark`. Steps follow Radix's 12-step roles;
// neutrals sit at hue 80 so the grays lean warm. StyleX only accepts literals here.

export const color = stylex.defineVars({
  bg: "light-dark(oklch(0.993 0.002 80), oklch(0.165 0.004 80))",
  surface: "light-dark(oklch(0.982 0.003 80), oklch(0.19 0.004 80))",
  sidebar: "light-dark(oklch(0.972 0.004 80), oklch(0.15 0.004 80))",
  raised: "light-dark(oklch(1 0 0), oklch(0.215 0.005 80))",
  ui: "light-dark(oklch(0.958 0.004 80), oklch(0.225 0.005 80))",
  uiHover: "light-dark(oklch(0.938 0.005 80), oklch(0.25 0.005 80))",
  uiActive: "light-dark(oklch(0.918 0.005 80), oklch(0.275 0.006 80))",
  line: "light-dark(oklch(0.912 0.005 80), oklch(0.265 0.005 80))",
  lineUi: "light-dark(oklch(0.868 0.006 80), oklch(0.32 0.006 80))",
  lineStrong: "light-dark(oklch(0.78 0.007 80), oklch(0.42 0.007 80))",
  fgFaint: "light-dark(oklch(0.545 0.008 80), oklch(0.62 0.007 80))",
  fgMuted: "light-dark(oklch(0.5 0.009 80), oklch(0.71 0.007 80))",
  fg: "light-dark(oklch(0.22 0.01 80), oklch(0.94 0.004 80))",
  fgOnSolid: "oklch(0.99 0 0)",

  accent: "light-dark(oklch(0.55 0.2 268), oklch(0.54 0.19 268))",
  accentHover: "light-dark(oklch(0.5 0.2 268), oklch(0.59 0.19 268))",
  accentFg: "light-dark(oklch(0.48 0.19 268), oklch(0.78 0.11 268))",
  accentSubtle: "light-dark(oklch(0.962 0.022 268), oklch(0.26 0.06 268))",
  accentLine: "light-dark(oklch(0.85 0.07 268), oklch(0.4 0.1 268))",

  // The mark's crayon navy and the purple at its edges. Dark mode lightens the ink, or the mark
  // would vanish into the page.
  brand: "light-dark(oklch(0.223 0.05 253), oklch(0.93 0.02 253))",
  brandRim: "light-dark(oklch(0.28 0.083 307), oklch(0.62 0.12 307))",

  gold: "light-dark(oklch(0.78 0.15 82), oklch(0.8 0.14 82))",
  goldFg: "light-dark(oklch(0.5 0.11 70), oklch(0.85 0.12 85))",
  goldSubtle: "light-dark(oklch(0.975 0.04 90), oklch(0.25 0.045 80))",

  green: "light-dark(oklch(0.62 0.15 152), oklch(0.7 0.15 152))",
  greenFg: "light-dark(oklch(0.47 0.12 152), oklch(0.8 0.12 152))",
  greenSubtle: "light-dark(oklch(0.965 0.03 152), oklch(0.25 0.045 152))",
  // Dark in both modes: dark mode's green is too light to carry light text.
  fgOnGreen: "light-dark(oklch(0.22 0.01 80), oklch(0.165 0.004 80))",
  amber: "light-dark(oklch(0.74 0.16 68), oklch(0.78 0.15 70))",
  amberFg: "light-dark(oklch(0.5 0.13 60), oklch(0.84 0.12 75))",
  amberSubtle: "light-dark(oklch(0.97 0.035 80), oklch(0.26 0.045 70))",
  red: "light-dark(oklch(0.6 0.2 27), oklch(0.67 0.19 25))",
  redFg: "light-dark(oklch(0.5 0.18 27), oklch(0.78 0.13 25))",
  redSubtle: "light-dark(oklch(0.965 0.02 27), oklch(0.26 0.05 25))",
  violet: "light-dark(oklch(0.58 0.19 300), oklch(0.68 0.16 300))",
  violetFg: "light-dark(oklch(0.5 0.18 300), oklch(0.8 0.11 300))",
  violetSubtle: "light-dark(oklch(0.965 0.025 300), oklch(0.26 0.06 300))",
  blue: "light-dark(oklch(0.6 0.15 245), oklch(0.7 0.13 245))",
  blueFg: "light-dark(oklch(0.5 0.14 245), oklch(0.8 0.1 245))",
  blueSubtle: "light-dark(oklch(0.965 0.02 245), oklch(0.26 0.05 245))",

  focus: "light-dark(oklch(0.6 0.19 268), oklch(0.7 0.16 268))",
  scrim: "light-dark(oklch(0.2 0.01 80 / 0.28), oklch(0 0 0 / 0.55))",

  // Light falls on the ghost from above in either theme; its cloth folds a shade darker beneath,
  // and its shadow darkens the floor even on a dark page, where a light shadow would glow.
  sheen: "light-dark(oklch(1 0 0 / 0.12), oklch(1 0 0 / 0.12))",
  shade: "light-dark(oklch(0 0 0 / 0.1), oklch(0 0 0 / 0.1))",
  fold: "light-dark(oklch(0 0 0 / 0.28), oklch(0 0 0 / 0.14))",
  castShadow: "light-dark(oklch(0.235 0.009 75 / 0.2), oklch(0 0 0 / 0.6))",
});

// Each tool's own colours, from its brand guidelines, so a mark reads as the product at a glance.
// They hold in both themes; only GitHub's ink flips, as GitHub's own mark does.
export const product = stylex.defineVars({
  github: "light-dark(#1f2328, #f0f6fc)",
  gitlabDeep: "#e24329",
  gitlab: "#fc6d26",
  gitlabLight: "#fca326",
  gitea: "#609926",
  slackRed: "#e01e5a",
  slackBlue: "#36c5f0",
  slackGreen: "#2eb67d",
  slackYellow: "#ecb22e",
  discord: "#5865f2",
  claude: "#d97757",
  // These ship as black marks; on a dark page they turn to near-white, as GitHub's does.
  cursor: "light-dark(#141414, #f0f0f0)",
  openai: "light-dark(#0d0d0d, #f0f0f0)",
  copilot: "light-dark(#1f2328, #f0f6fc)",
});

export const font = stylex.defineVars({
  sans: '"Inter Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"Geist Mono Variable", ui-monospace, "SF Mono", Menlo, monospace',
  // Only the landing page's headlines; the app itself stays in one family.
  display: '"Newsreader Variable", ui-serif, Georgia, serif',
});

export const text = stylex.defineVars({
  caption: "11px",
  meta: "12px",
  label: "13px",
  copy: "14px",
  titleSm: "15px",
  title: "18px",
  titleLg: "24px",
});

export const leading = stylex.defineVars({
  caption: "16px",
  meta: "16px",
  label: "20px",
  copy: "22px",
  titleSm: "22px",
  title: "26px",
  titleLg: "32px",
});

export const space = stylex.defineVars({
  px: "1px",
  xxs: "2px",
  xs: "4px",
  sm: "6px",
  md: "8px",
  lg: "12px",
  xl: "16px",
  xxl: "20px",
  x3: "24px",
  x4: "32px",
  x5: "48px",
});

export const radius = stylex.defineVars({
  xs: "4px",
  sm: "6px",
  md: "8px",
  lg: "12px",
  full: "999px",
});

export const shadow = stylex.defineVars({
  // A small white object resting on a landing page tile: a top highlight, a half-pixel edge and a
  // soft fall, so it reads as lifted without a drawn border.
  object:
    "inset 0 1px 0 light-dark(oklch(1 0 0), oklch(1 0 0 / 0.06)), 0 0 0 0.5px light-dark(oklch(0 0 0 / 0.08), oklch(1 0 0 / 0.1)), 0 6px 18px -8px light-dark(oklch(0 0 0 / 0.14), oklch(0 0 0 / 0.6))",
  // Two layers plus a hairline: the hairline carries the edge in dark mode, where shadows vanish.
  // light-dark() takes colours only, so each layer picks its own; wrapped around a whole shadow
  // list it's invalid and the browser draws no shadow at all.
  float:
    "0 0 0 1px light-dark(oklch(0.2 0.01 80 / 0.07), oklch(1 0 0 / 0.08)), 0 2px 4px light-dark(oklch(0.2 0.01 80 / 0.05), oklch(0 0 0 / 0.3)), 0 8px 24px light-dark(oklch(0.2 0.01 80 / 0.1), oklch(0 0 0 / 0.45))",
  card: "0 0 0 1px light-dark(oklch(0.2 0.01 80 / 0.07), oklch(1 0 0 / 0.07)), 0 1px 2px light-dark(oklch(0.2 0.01 80 / 0.05), oklch(0 0 0 / 0.3))",
  lift: "0 0 0 1px light-dark(oklch(0.2 0.01 80 / 0.08), oklch(1 0 0 / 0.1)), 0 4px 8px light-dark(oklch(0.2 0.01 80 / 0.08), oklch(0 0 0 / 0.35)), 0 16px 32px light-dark(oklch(0.2 0.01 80 / 0.12), oklch(0 0 0 / 0.5))",
});

export const motion = stylex.defineVars({
  fast: "120ms",
  base: "180ms",
  slow: "260ms",
  out: "cubic-bezier(0.23, 1, 0.32, 1)",
  inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
});

export const media = stylex.defineConsts({
  // Touch screens fake :hover on a tap and leave it stuck, so hover styles apply only where a
  // pointer really hovers; presses get :active instead.
  hover: "@media (hover: hover) and (pointer: fine)",
  // A fingertip covers about 40px, so small controls grow their hit area here.
  touch: "@media (hover: none) and (pointer: coarse)",
});
