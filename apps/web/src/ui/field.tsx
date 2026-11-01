import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { CaretDownIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useId } from "react";

import { isShown } from "#lib/node";

import {
  color,
  leading,
  media,
  motion,
  radius,
  space,
  text,
} from "./tokens.stylex";

export function Field({
  label,
  hint,
  error,
  children,
  sx,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: (id: string) => ReactNode;
  sx?: StyleXStyles;
}) {
  const id = useId();
  return (
    <div {...stylex.props(styles.field, sx)}>
      <label htmlFor={id} {...stylex.props(styles.label)}>
        {label}
      </label>
      {children(id)}
      {isShown(error) ? (
        <p role="alert" {...stylex.props(styles.hint, styles.error)}>
          {error}
        </p>
      ) : (
        isShown(hint) && <p {...stylex.props(styles.hint)}>{hint}</p>
      )}
    </div>
  );
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "style"> & {
  sx?: StyleXStyles;
  ref?: Ref<HTMLInputElement>;
  leading?: ReactNode;
};

export function Input({ sx, leading: icon, ...rest }: InputProps) {
  if (isShown(icon)) {
    return (
      <span {...stylex.props(styles.withIcon, sx)}>
        <span {...stylex.props(styles.icon)}>{icon}</span>
        <input
          {...rest}
          {...stylex.props(styles.control, styles.input, styles.padded)}
        />
      </span>
    );
  }
  return (
    <input {...rest} {...stylex.props(styles.control, styles.input, sx)} />
  );
}

type TextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "style"
> & {
  sx?: StyleXStyles;
  ref?: Ref<HTMLTextAreaElement>;
};

export function Textarea({ sx, ...rest }: TextareaProps) {
  return (
    <textarea
      {...rest}
      {...stylex.props(styles.control, styles.textarea, sx)}
    />
  );
}

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "style"> & {
  sx?: StyleXStyles;
};

export function Select({ sx, children, ...rest }: SelectProps) {
  return (
    <span {...stylex.props(styles.selectWrap, sx)}>
      <select
        {...rest}
        {...stylex.props(styles.control, styles.input, styles.select)}
      >
        {children}
      </select>
      <CaretDownIcon size={14} {...stylex.props(styles.chevron)} />
    </span>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <BaseSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      disabled={disabled}
      {...stylex.props(styles.switch)}
    >
      <BaseSwitch.Thumb {...stylex.props(styles.thumb)} />
    </BaseSwitch.Root>
  );
}

/** A row of mutually exclusive options: filters and small view toggles. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; count?: number }[];
  label: string;
}) {
  return (
    <RadioGroup<T>
      value={value}
      onValueChange={onChange}
      aria-label={label}
      {...stylex.props(styles.segmented)}
    >
      {options.map((o) => (
        <Radio.Root
          key={o.value}
          value={o.value}
          {...stylex.props(
            styles.segment,
            o.value === value && styles.segmentOn
          )}
        >
          {o.label}
          {o.count !== undefined && o.count > 0 && (
            <span {...stylex.props(styles.segmentCount)}>{o.count}</span>
          )}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}

export const fieldStyles = stylex.create({
  bare: {
    borderWidth: 0,
    backgroundColor: "transparent",
    boxShadow: "none",
    paddingInline: 0,
    outline: { default: "none", ":focus-visible": "none" },
  },
});

const styles = stylex.create({
  field: { display: "flex", flexDirection: "column", gap: space.sm },
  label: { fontSize: text.label, fontWeight: 500, color: color.fg },
  hint: { fontSize: text.meta, lineHeight: leading.meta, color: color.fgMuted },
  error: { color: color.redFg },
  control: {
    width: "100%",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: color.lineUi,
      ":hover": { default: null, [media.hover]: color.lineStrong },
    },
    backgroundColor: color.raised,
    color: color.fg,
    // iOS zooms into any field under 16px, so phones get a larger size.
    fontSize: { default: text.label, "@media (max-width: 640px)": 16 },
    outline: "none",
    transitionProperty: "border-color, box-shadow",
    transitionDuration: motion.fast,
    boxShadow: {
      default: null,
      ":focus-visible": `0 0 0 3px ${color.accentSubtle}`,
    },
    "::placeholder": { color: color.fgFaint },
    ":focus-visible": { borderColor: color.accent },
    ":disabled": { opacity: 0.6 },
  },
  input: { height: 32, paddingInline: space.md },
  padded: { paddingInlineStart: 30 },
  withIcon: { position: "relative", display: "block", width: "100%" },
  icon: {
    position: "absolute",
    insetBlock: 0,
    left: 9,
    display: "grid",
    placeItems: "center",
    color: color.fgFaint,
    pointerEvents: "none",
  },
  textarea: {
    minHeight: 80,
    paddingBlock: space.md,
    paddingInline: space.md,
    lineHeight: leading.label,
    resize: "vertical",
    fieldSizing: "content",
  },
  selectWrap: { position: "relative", display: "block" },
  select: { appearance: "none", paddingInlineEnd: 28, cursor: "pointer" },
  chevron: {
    position: "absolute",
    right: 9,
    top: "50%",
    translate: "0 -50%",
    color: color.fgMuted,
    pointerEvents: "none",
  },
  switch: {
    position: "relative",
    display: "inline-flex",
    flexShrink: 0,
    width: 30,
    height: 18,
    padding: 2,
    borderRadius: radius.full,
    backgroundColor: {
      default: color.uiActive,
      ":is([data-checked])": color.accent,
    },
    transitionProperty: "background-color",
    transitionDuration: motion.fast,
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
    outlineOffset: 2,
    cursor: "pointer",
  },
  thumb: {
    width: 14,
    height: 14,
    borderRadius: "50%",
    backgroundColor: "oklch(1 0 0)",
    boxShadow: "0 1px 2px oklch(0 0 0 / 0.25)",
    transitionProperty: "translate",
    transitionDuration: motion.base,
    transitionTimingFunction: motion.out,
    translate: { default: "0 0", ":is([data-checked])": "12px 0" },
  },
  segmented: {
    display: "inline-flex",
    padding: 2,
    gap: 2,
    borderRadius: radius.sm,
    backgroundColor: color.ui,
  },
  segment: {
    display: "inline-flex",
    alignItems: "center",
    cursor: "pointer",
    userSelect: "none",
    gap: space.sm,
    height: 24,
    paddingInline: space.md,
    borderRadius: radius.xs,
    fontSize: text.meta,
    fontWeight: 500,
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
  },
  segmentOn: {
    color: color.fg,
    backgroundColor: color.raised,
    boxShadow: `0 0 0 1px ${color.line}, 0 1px 2px oklch(0 0 0 / 0.06)`,
  },
  segmentCount: {
    fontVariantNumeric: "tabular-nums",
    color: color.fgFaint,
  },
});
