import { DesktopIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";

import { setTheme, useTheme } from "#lib/theme";
import type { Theme } from "#lib/theme";
import { color, media, motion, radius } from "#ui/tokens.stylex";

const NEXT: Record<Theme, Theme> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const LABEL: Record<Theme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/**
 * One small button in the bar that steps through the themes. It shows the theme in use, and says
 * which comes next, so a press is never a guess.
 */
export function ThemeToggle() {
  const theme = useTheme();
  const next = NEXT[theme];
  const Glyph = { system: DesktopIcon, light: SunIcon, dark: MoonIcon }[theme];
  return (
    <button
      type="button"
      aria-label={`Theme: ${LABEL[theme]}. Switch to ${LABEL[next]}`}
      title={`Theme: ${LABEL[theme]}`}
      onClick={() => setTheme(next)}
      {...stylex.props(styles.toggle)}
    >
      <Glyph size={16} />
    </button>
  );
}

const styles = stylex.create({
  toggle: {
    display: "grid",
    placeItems: "center",
    width: 28,
    height: 28,
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: radius.md,
    backgroundColor: {
      default: "transparent",
      ":hover": {
        default: null,
        [media.hover]:
          "light-dark(oklch(0.2 0.01 80 / 0.06), oklch(1 0 0 / 0.08))",
      },
      ":active": "light-dark(oklch(0.2 0.01 80 / 0.1), oklch(1 0 0 / 0.12))",
    },
    color: {
      default:
        "light-dark(oklch(0.22 0.01 80 / 0.7), oklch(0.94 0.004 80 / 0.7))",
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
});
