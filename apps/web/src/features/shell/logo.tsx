import * as stylex from "@stylexjs/stylex";

import { color } from "#ui/tokens.stylex";

/** Three log lines, shortest last and gold: the newest entry, still being written. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an <img> can't take the theme's token colors; role="img" is how an inline SVG gets announced
      role="img"
      aria-label="Worklog"
      {...stylex.props(styles.logo)}
    >
      <rect width="32" height="32" rx="8" {...stylex.props(styles.tile)} />
      <rect x="8" y="9" width="16" height="3" rx="1.5" fill="#fff" />
      <rect
        x="8"
        y="14.5"
        width="11"
        height="3"
        rx="1.5"
        fill="#fff"
        opacity="0.8"
      />
      <rect
        x="8"
        y="20"
        width="6"
        height="3"
        rx="1.5"
        {...stylex.props(styles.gold)}
      />
    </svg>
  );
}

const styles = stylex.create({
  logo: { flexShrink: 0 },
  tile: { fill: color.accent },
  gold: { fill: color.gold },
});
