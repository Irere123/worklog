import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { NumberField } from "@base-ui/react/number-field";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Select as BaseSelect } from "@base-ui/react/select";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import {
  CaretUpDownIcon,
  CheckIcon,
  MinusIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  TextareaHTMLAttributes,
} from "react";
import { useId } from "react";

import { isShown } from "#lib/node";

import { surface, Tooltip } from "./overlay";
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

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
};

/**
 * Base UI's select rather than the browser's: the native popup ignores the theme, can't show a
 * face or an icon beside an option, and looks different on every OS.
 */
export function Select<T extends string>({
  value,
  onValueChange,
  options,
  id,
  label,
  disabled,
  autoFocus,
  sx,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: SelectOption<T>[];
  id?: string;
  label?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  sx?: StyleXStyles;
}) {
  const chosen = options.find((o) => o.value === value);
  return (
    <BaseSelect.Root
      items={options}
      value={value}
      onValueChange={(next) => {
        const option = options.find((o) => o.value === next);
        if (option) {
          onValueChange(option.value);
        }
      }}
      disabled={disabled}
    >
      <BaseSelect.Trigger
        id={id}
        aria-label={label}
        autoFocus={autoFocus}
        {...stylex.props(styles.control, styles.input, styles.trigger, sx)}
      >
        {chosen?.icon !== undefined && (
          <span {...stylex.props(styles.optionIcon)}>{chosen.icon}</span>
        )}
        <BaseSelect.Value {...stylex.props(styles.value)} />
        <BaseSelect.Icon {...stylex.props(styles.chevron)}>
          <CaretUpDownIcon size={14} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          sideOffset={4}
          collisionPadding={8}
          {...stylex.props(styles.selectPositioner)}
        >
          <BaseSelect.Popup {...stylex.props(surface.popup, styles.listbox)}>
            <BaseSelect.List {...stylex.props(styles.options)}>
              {options.map((o) => (
                <BaseSelect.Item
                  key={o.value}
                  value={o.value}
                  {...stylex.props(surface.item)}
                >
                  {o.icon !== undefined && (
                    <span {...stylex.props(surface.itemIcon)}>{o.icon}</span>
                  )}
                  <BaseSelect.ItemText {...stylex.props(surface.itemLabel)}>
                    {o.label}
                  </BaseSelect.ItemText>
                  <span {...stylex.props(styles.tick)}>
                    <BaseSelect.ItemIndicator>
                      <CheckIcon size={14} />
                    </BaseSelect.ItemIndicator>
                  </span>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

/**
 * A time of day as half-hour slots. The browser's time field shows AM/PM or a 24-hour clock
 * depending on the OS, with a clock icon that opens nothing on most desktops.
 */
export function TimeSelect({
  value,
  onValueChange,
  id,
  label,
  sx,
}: {
  value: string;
  onValueChange: (value: string) => void;
  id?: string;
  label?: string;
  sx?: StyleXStyles;
}) {
  const slots = HALF_HOURS.includes(value)
    ? HALF_HOURS
    : [...HALF_HOURS, value].toSorted();
  return (
    <Select
      id={id}
      label={label}
      value={value}
      onValueChange={onValueChange}
      options={slots.map((t) => ({ value: t, label: t }))}
      sx={[styles.time, sx]}
    />
  );
}

const HALF_HOURS = Array.from({ length: 48 }, (_, i) => {
  const hour = String(Math.floor(i / 2)).padStart(2, "0");
  return `${hour}:${i % 2 === 0 ? "00" : "30"}`;
});

export function Checkbox({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <BaseCheckbox.Root
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next)}
      aria-label={label}
      {...stylex.props(styles.checkbox)}
    >
      <BaseCheckbox.Indicator {...stylex.props(styles.checkmark)}>
        <CheckIcon size={11} weight="bold" />
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}

/** A whole number with − and + either side, in place of the browser's hairline spinner arrows. */
export function Stepper({
  value,
  onValueChange,
  onValueCommit,
  min,
  max,
  step = 1,
  id,
  label,
}: {
  value: number;
  onValueChange?: (value: number) => void;
  onValueCommit?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  id?: string;
  label?: string;
}) {
  return (
    <NumberField.Root
      id={id}
      value={value}
      min={min}
      max={max}
      step={step}
      onValueChange={(next) => {
        if (next !== null) {
          onValueChange?.(next);
        }
      }}
      onValueCommitted={(next) => {
        if (next !== null) {
          onValueCommit?.(next);
        }
      }}
    >
      <NumberField.Group {...stylex.props(styles.control, styles.stepper)}>
        <NumberField.Decrement aria-label="Less" {...stylex.props(styles.step)}>
          <MinusIcon size={12} />
        </NumberField.Decrement>
        <NumberField.Input
          aria-label={label}
          {...stylex.props(styles.stepInput)}
        />
        <NumberField.Increment aria-label="More" {...stylex.props(styles.step)}>
          <PlusIcon size={12} />
        </NumberField.Increment>
      </NumberField.Group>
    </NumberField.Root>
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
  /** `name` labels an icon-only option, for screen readers and as a tooltip. */
  options: { value: T; label: ReactNode; count?: number; name?: string }[];
  label: string;
}) {
  return (
    <RadioGroup<T>
      value={value}
      onValueChange={onChange}
      aria-label={label}
      {...stylex.props(styles.segmented)}
    >
      {options.map((o) => {
        const segment = (
          <Radio.Root
            key={o.value}
            value={o.value}
            aria-label={o.name}
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
        );
        return o.name === undefined ? (
          segment
        ) : (
          <Tooltip key={o.value} label={o.name}>
            {segment}
          </Tooltip>
        );
      })}
    </RadioGroup>
  );
}

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
    resize: "none",
    fieldSizing: "content",
  },
  trigger: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    paddingInlineEnd: space.sm,
    textAlign: "start",
    cursor: "default",
    userSelect: "none",
    backgroundColor: {
      default: color.raised,
      ":is([data-popup-open])": color.surface,
    },
  },
  value: {
    flexGrow: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  checkbox: {
    display: "inline-grid",
    placeItems: "center",
    flexShrink: 0,
    width: 16,
    height: 16,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: color.lineStrong,
      ":is([data-checked])": color.accent,
    },
    backgroundColor: {
      default: color.raised,
      ":is([data-checked])": color.accent,
    },
    color: color.fgOnSolid,
    transitionProperty: "background-color, border-color",
    transitionDuration: motion.fast,
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
    outlineOffset: 2,
    cursor: "pointer",
  },
  checkmark: { display: "grid", placeItems: "center" },
  stepper: {
    display: "inline-flex",
    alignItems: "stretch",
    width: 112,
    height: 32,
    overflow: "hidden",
    ":focus-within": {
      borderColor: color.accent,
      boxShadow: `0 0 0 3px ${color.accentSubtle}`,
    },
  },
  step: {
    display: "grid",
    placeItems: "center",
    width: 30,
    flexShrink: 0,
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.uiHover },
      ":active": color.uiActive,
    },
    ":disabled": { opacity: 0.4 },
  },
  stepInput: {
    flexGrow: 1,
    minWidth: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    outline: "none",
    textAlign: "center",
    color: color.fg,
    fontSize: "inherit",
    fontVariantNumeric: "tabular-nums",
  },
  time: { width: 104, fontVariantNumeric: "tabular-nums" },
  optionIcon: { display: "inline-grid", placeItems: "center", flexShrink: 0 },
  chevron: { display: "inline-grid", flexShrink: 0, color: color.fgFaint },
  selectPositioner: { zIndex: 60, outline: "none" },
  listbox: {
    minWidth: "var(--anchor-width)",
    maxHeight: "min(360px, var(--available-height))",
    borderRadius: radius.md,
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
  options: { padding: space.xs, outline: "none" },
  tick: {
    display: "inline-grid",
    placeItems: "center",
    width: 16,
    flexShrink: 0,
    color: color.fg,
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
