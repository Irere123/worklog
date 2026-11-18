import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { Popover as BasePopover } from "@base-ui/react/popover";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { CheckIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import type { ReactElement, ReactNode, RefObject } from "react";

import { isShown } from "#lib/node";

import { Kbd } from "./chip";
import {
  color,
  leading,
  media,
  motion,
  radius,
  shadow,
  space,
  text,
} from "./tokens.stylex";

const EDGE = 8;

export const TooltipProvider = BaseTooltip.Provider;

export function Tooltip({
  label,
  shortcut,
  side = "bottom",
  disabled = false,
  children,
}: {
  label: ReactNode;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  /** Off without unmounting, so a trigger that only sometimes needs a tooltip keeps its state. */
  disabled?: boolean;
  children: ReactElement;
}) {
  return (
    <BaseTooltip.Root disabled={disabled}>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner
          side={side}
          sideOffset={6}
          collisionPadding={EDGE}
        >
          <BaseTooltip.Popup {...stylex.props(styles.tooltip)}>
            {label}
            {shortcut && <Kbd sx={styles.tooltipKbd}>{shortcut}</Kbd>}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

/**
 * A menu of actions. With `search`, it opens with a filter field on top, for lists that grow
 * with the team (people, boards) where scanning stops working.
 */
export function Menu({
  trigger,
  children,
  align = "start",
  side = "bottom",
  width,
  search,
  empty = "Nothing matches that.",
  anchor,
  onSearchChange,
}: {
  trigger: ReactElement;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  width?: number;
  search?: string;
  empty?: ReactNode;
  anchor?: RefObject<Element | null>;
  onSearchChange?: (query: string) => void;
}) {
  const menu = (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner
          align={align}
          side={side}
          sideOffset={4}
          collisionPadding={EDGE}
          anchor={anchor}
          {...stylex.props(styles.positioner)}
        >
          <BaseMenu.Popup
            {...stylex.props(
              surface.popup,
              styles.menu,
              search === undefined ? styles.menuScroll : styles.searchable,
              width !== undefined && styles.width(width)
            )}
          >
            {search === undefined ? (
              children
            ) : (
              <>
                <div {...stylex.props(styles.search)}>
                  <MagnifyingGlassIcon size={14} />
                  <BaseMenu.Input
                    aria-label={search}
                    placeholder={search}
                    {...stylex.props(styles.searchInput)}
                  />
                </div>
                <BaseMenu.Empty {...stylex.props(styles.empty)}>
                  {empty}
                </BaseMenu.Empty>
                <BaseMenu.List {...stylex.props(styles.list)}>
                  {children}
                </BaseMenu.List>
              </>
            )}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
  return search === undefined ? (
    menu
  ) : (
    <BaseMenu.FilterProvider autoHighlight onValueChange={onSearchChange}>
      {menu}
    </BaseMenu.FilterProvider>
  );
}

export function MenuItem({
  icon,
  children,
  label,
  shortcut,
  detail,
  onClick,
  danger = false,
  disabled = false,
  checked,
}: {
  icon?: ReactNode;
  children: ReactNode;
  label?: string;
  shortcut?: string;
  detail?: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
}) {
  return (
    <BaseMenu.Item
      onClick={onClick}
      disabled={disabled}
      label={label ?? textOf(children)}
      {...stylex.props(surface.item, danger && surface.danger)}
    >
      {(icon !== undefined || checked !== undefined) && (
        <span {...stylex.props(surface.itemIcon)}>
          {checked === undefined ? icon : checked && <CheckIcon size={14} />}
        </span>
      )}
      <span {...stylex.props(surface.itemLabel)}>{children}</span>
      {detail !== undefined && (
        <span {...stylex.props(styles.detail)}>{detail}</span>
      )}
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </BaseMenu.Item>
  );
}

/**
 * A toggle that keeps the menu open, so several can be flipped in one visit: assigning three
 * people shouldn't take three trips.
 */
export function MenuCheckboxItem({
  icon,
  children,
  label,
  shortcut,
  checked,
  onCheckedChange,
}: {
  icon?: ReactNode;
  children: ReactNode;
  label?: string;
  shortcut?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <BaseMenu.CheckboxItem
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next)}
      label={label ?? textOf(children)}
      {...stylex.props(surface.item)}
    >
      <span {...stylex.props(surface.itemIcon)}>{icon}</span>
      <span {...stylex.props(surface.itemLabel)}>{children}</span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
      <BaseMenu.CheckboxItemIndicator
        keepMounted
        {...stylex.props(surface.indicator)}
      >
        <CheckIcon size={14} />
      </BaseMenu.CheckboxItemIndicator>
    </BaseMenu.CheckboxItem>
  );
}

/** Colours as a grid of swatches: fourteen named rows would outgrow the menu they sit in. */
export function MenuSwatches({
  label,
  options,
  value,
  onValueChange,
}: {
  label: string;
  options: { value: string; label: string; color: string }[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <BaseMenu.RadioGroup
      aria-label={label}
      value={value}
      onValueChange={(next: string) => onValueChange(next)}
      {...stylex.props(styles.swatches)}
    >
      {options.map((o) => (
        <BaseMenu.RadioItem
          key={o.value}
          value={o.value}
          label={o.label}
          aria-label={o.label}
          title={o.label}
          closeOnClick
          {...stylex.props(styles.swatch)}
        >
          <span {...stylex.props(styles.swatchFill(o.color))}>
            <BaseMenu.RadioItemIndicator {...stylex.props(styles.swatchTick)}>
              <CheckIcon size={11} weight="bold" />
            </BaseMenu.RadioItemIndicator>
          </span>
        </BaseMenu.RadioItem>
      ))}
    </BaseMenu.RadioGroup>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.menuLabel)}>{children}</div>;
}

export function MenuSeparator() {
  return <BaseMenu.Separator {...stylex.props(styles.separator)} />;
}

export function Popover({
  trigger,
  children,
  title,
  description,
  align = "start",
  side = "bottom",
  width,
  open,
  onOpenChange,
  sx,
}: {
  trigger: ReactElement;
  children: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  width?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  sx?: StyleXStyles;
}) {
  return (
    <BasePopover.Root open={open} onOpenChange={onOpenChange}>
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={EDGE}
          {...stylex.props(styles.positioner)}
        >
          <BasePopover.Popup
            {...stylex.props(
              surface.popup,
              styles.popover,
              width !== undefined && styles.width(width),
              sx
            )}
          >
            {isShown(title) && (
              <BasePopover.Title {...stylex.props(styles.popoverTitle)}>
                {title}
              </BasePopover.Title>
            )}
            {isShown(description) && (
              <BasePopover.Description
                {...stylex.props(styles.popoverDescription)}
              >
                {description}
              </BasePopover.Description>
            )}
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}

function textOf(children: ReactNode) {
  return typeof children === "string" ? children : undefined;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  hideTitle = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  hideTitle?: boolean;
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop {...stylex.props(styles.backdrop)} />
        <BaseDialog.Popup {...stylex.props(styles.dialog, dialogSizes[size])}>
          <header
            {...stylex.props(styles.dialogHeader, hideTitle && styles.srOnly)}
          >
            <div {...stylex.props(styles.dialogHeading)}>
              <BaseDialog.Title {...stylex.props(styles.dialogTitle)}>
                {title}
              </BaseDialog.Title>
              {isShown(description) && (
                <BaseDialog.Description
                  {...stylex.props(styles.dialogDescription)}
                >
                  {description}
                </BaseDialog.Description>
              )}
            </div>
            <BaseDialog.Close
              aria-label="Close"
              {...stylex.props(styles.close)}
            >
              <XIcon size={16} />
            </BaseDialog.Close>
          </header>
          {children}
          {isShown(footer) && (
            <footer {...stylex.props(styles.dialogFooter)}>{footer}</footer>
          )}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

const styles = stylex.create({
  positioner: { zIndex: 50, outline: "none" },
  width: (width: number) => ({ width }),
  menu: {
    display: "flex",
    flexDirection: "column",
    minWidth: 200,
    maxWidth: "var(--available-width)",
    maxHeight: "min(420px, var(--available-height))",
    borderRadius: radius.md,
  },
  menuScroll: { padding: space.xs, overflowY: "auto" },
  searchable: { minWidth: 240, overflow: "hidden" },
  search: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    flexShrink: 0,
    height: 38,
    paddingInline: space.md,
    color: color.fgFaint,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
  },
  searchInput: {
    flexGrow: 1,
    minWidth: 0,
    height: "100%",
    borderWidth: 0,
    backgroundColor: "transparent",
    outline: "none",
    color: color.fg,
    fontSize: { default: text.label, [media.touch]: 16 },
    "::placeholder": { color: color.fgFaint },
  },
  list: {
    flexGrow: 1,
    minHeight: 0,
    padding: space.xs,
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
  empty: {
    paddingInline: space.md,
    paddingBlock: space.lg,
    fontSize: text.label,
    color: color.fgMuted,
  },
  popover: {
    borderRadius: radius.md,
    padding: space.lg,
    maxWidth: "min(360px, var(--available-width))",
    maxHeight: "var(--available-height)",
    overflowY: "auto",
  },
  popoverTitle: {
    fontSize: text.label,
    lineHeight: leading.label,
    fontWeight: 600,
    color: color.fg,
  },
  popoverDescription: {
    marginTop: space.xxs,
    marginBottom: space.md,
    fontSize: text.label,
    lineHeight: leading.label,
    color: color.fgMuted,
  },
  detail: {
    flexShrink: 0,
    marginInlineStart: space.lg,
    fontSize: text.meta,
    color: color.fgFaint,
    fontVariantNumeric: "tabular-nums",
  },
  swatches: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 28px)",
    gap: space.xxs,
    paddingInline: space.sm,
    paddingBottom: space.sm,
  },
  swatch: {
    display: "grid",
    placeItems: "center",
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    outline: "none",
    cursor: "default",
    backgroundColor: {
      default: "transparent",
      ":is([data-highlighted])": color.uiHover,
    },
  },
  swatchFill: (fill: string) => ({
    display: "grid",
    placeItems: "center",
    width: 18,
    height: 18,
    borderRadius: "50%",
    backgroundColor: fill,
  }),
  swatchTick: { display: "grid", color: "oklch(1 0 0)" },
  menuLabel: {
    paddingInline: space.md,
    paddingBlock: space.sm,
    fontSize: text.caption,
    fontWeight: 500,
    color: color.fgFaint,
  },
  separator: {
    height: 1,
    marginBlock: space.xs,
    marginInline: -4,
    backgroundColor: color.line,
  },
  tooltip: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    paddingBlock: space.xs,
    paddingInline: space.md,
    borderRadius: radius.sm,
    fontSize: text.meta,
    fontWeight: 500,
    lineHeight: leading.meta,
    color: color.bg,
    backgroundColor: color.fg,
    transformOrigin: "var(--transform-origin)",
    transitionProperty: "opacity, transform",
    transitionDuration: "125ms",
    transitionTimingFunction: motion.out,
    opacity: {
      default: 1,
      ":is([data-starting-style])": 0,
      ":is([data-ending-style])": 0,
      ":is([data-instant])": 1,
    },
    transform: {
      default: "scale(1)",
      ":is([data-starting-style])": "scale(0.97)",
    },
  },
  tooltipKbd: { opacity: 0.85 },
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 40,
    backgroundColor: color.scrim,
    transitionProperty: "opacity",
    transitionDuration: motion.base,
    opacity: {
      default: 1,
      ":is([data-starting-style])": 0,
      ":is([data-ending-style])": 0,
    },
  },
  dialog: {
    position: "fixed",
    zIndex: 50,
    top: "12vh",
    left: "50%",
    translate: "-50% 0",
    maxWidth: "calc(100vw - 32px)",
    maxHeight: "76vh",
    display: "flex",
    flexDirection: "column",
    borderRadius: radius.lg,
    backgroundColor: color.raised,
    boxShadow: shadow.lift,
    outline: "none",
    overflow: "hidden",
    transitionProperty: "opacity, transform",
    transitionDuration: motion.base,
    transitionTimingFunction: motion.out,
    opacity: {
      default: 1,
      ":is([data-starting-style])": 0,
      ":is([data-ending-style])": 0,
    },
    transform: {
      default: "scale(1)",
      ":is([data-starting-style])": "scale(0.96)",
      ":is([data-ending-style])": "scale(0.98)",
    },
  },
  dialogHeader: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.lg,
    paddingTop: space.xl,
    paddingInline: space.xl,
    paddingBottom: space.md,
  },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clipPath: "inset(50%)",
  },
  dialogHeading: { flexGrow: 1, minWidth: 0 },
  dialogTitle: {
    fontSize: text.titleSm,
    lineHeight: leading.titleSm,
    fontWeight: 600,
    color: color.fg,
  },
  dialogDescription: {
    marginTop: space.xxs,
    fontSize: text.label,
    lineHeight: leading.label,
    color: color.fgMuted,
  },
  close: {
    display: "grid",
    placeItems: "center",
    width: 28,
    height: 28,
    marginTop: -4,
    marginRight: -6,
    borderRadius: radius.sm,
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.uiHover },
    },
  },
  dialogFooter: {
    display: "flex",
    justifyContent: "flex-end",
    gap: space.md,
    paddingBlock: space.lg,
    paddingInline: space.xl,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: color.line,
    backgroundColor: color.surface,
  },
});

const dialogSizes = stylex.create({
  sm: { width: 400 },
  md: { width: 520 },
  lg: { width: 720 },
});

/** The floating surface and rows every menu, popover and select share. */
export const surface = stylex.create({
  popup: {
    transformOrigin: "var(--transform-origin)",
    backgroundColor: color.raised,
    boxShadow: shadow.float,
    outline: "none",
    transitionProperty: "opacity, transform",
    transitionDuration: {
      default: motion.base,
      ":is([data-ending-style])": motion.fast,
      ":is([data-instant])": "0ms",
    },
    transitionTimingFunction: motion.out,
    opacity: {
      default: 1,
      ":is([data-starting-style])": 0,
      ":is([data-ending-style])": 0,
    },
    transform: {
      default: "scale(1)",
      ":is([data-starting-style])": "scale(0.96)",
      ":is([data-ending-style])": "scale(0.98)",
    },
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    height: { default: 30, [media.touch]: 40 },
    paddingInline: space.md,
    borderRadius: radius.xs,
    fontSize: text.label,
    color: color.fg,
    cursor: "default",
    userSelect: "none",
    outline: "none",
    backgroundColor: {
      default: "transparent",
      ":is([data-highlighted])": color.uiHover,
    },
    opacity: { default: 1, ":is([data-disabled])": 0.45 },
  },
  danger: { color: color.redFg },
  itemIcon: {
    display: "inline-grid",
    placeItems: "center",
    width: 16,
    color: color.fgMuted,
    flexShrink: 0,
  },
  itemLabel: {
    flexGrow: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  indicator: {
    display: "inline-grid",
    placeItems: "center",
    width: 16,
    flexShrink: 0,
    color: color.fg,
    visibility: { default: "hidden", ":is([data-checked])": "visible" },
  },
});
