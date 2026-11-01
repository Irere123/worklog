import { CircleNotchIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

import { color, media, motion, radius, space, text } from "./tokens.stylex";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style" | "type"> & {
  type?: "button" | "submit";
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  trailing?: ReactNode;
  busy?: boolean;
  ref?: Ref<HTMLButtonElement>;
  sx?: StyleXStyles;
};

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  trailing,
  busy = false,
  children,
  disabled,
  type = "button",
  sx,
  ...rest
}: Props) {
  return (
    <button
      type={type === "submit" ? "submit" : "button"}
      disabled={disabled === true || busy}
      aria-busy={busy || undefined}
      {...rest}
      {...stylex.props(
        styles.base,
        styles[size],
        styles[variant],
        children === undefined && styles.iconOnly,
        children === undefined && size === "sm" && styles.iconOnlySm,
        sx
      )}
    >
      {busy ? (
        <CircleNotchIcon size={14} {...stylex.props(styles.spin)} />
      ) : (
        icon
      )}
      {children}
      {trailing}
    </button>
  );
}

const spin = stylex.keyframes({
  to: { transform: "rotate(360deg)" },
});

export const styles = stylex.create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    flexShrink: 0,
    whiteSpace: "nowrap",
    fontSize: text.label,
    fontWeight: 500,
    lineHeight: 1,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "transparent",
    userSelect: "none",
    transitionProperty: "background-color, border-color, color, transform",
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.out,
    transform: { default: null, ":active:not(:disabled)": "scale(0.97)" },
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
    outlineOffset: 2,
    opacity: { default: 1, ":disabled": 0.5 },
    cursor: { default: "pointer", ":disabled": "default" },
  },
  sm: { height: 26, paddingInline: space.md, fontSize: text.meta },
  md: { height: 32, paddingInline: space.lg },
  iconOnly: { width: 32, paddingInline: 0 },
  iconOnlySm: { width: 26 },
  primary: {
    color: color.fgOnSolid,
    backgroundColor: {
      default: color.accent,
      ":hover:not(:disabled)": {
        default: null,
        [media.hover]: color.accentHover,
      },
    },
    boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.14)",
  },
  secondary: {
    color: color.fg,
    backgroundColor: {
      default: color.raised,
      ":hover:not(:disabled)": { default: null, [media.hover]: color.ui },
    },
    borderColor: color.lineUi,
  },
  ghost: {
    color: {
      default: color.fgMuted,
      ":hover:not(:disabled)": { default: null, [media.hover]: color.fg },
    },
    backgroundColor: {
      default: "transparent",
      ":hover:not(:disabled)": { default: null, [media.hover]: color.uiHover },
    },
  },
  danger: {
    color: color.fgOnSolid,
    backgroundColor: {
      default: color.red,
      ":hover:not(:disabled)": { default: null, [media.hover]: color.redFg },
    },
  },
  spin: {
    animationName: spin,
    animationDuration: "800ms",
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
  },
});
