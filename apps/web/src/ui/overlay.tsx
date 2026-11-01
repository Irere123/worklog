import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { Popover as BasePopover } from "@base-ui/react/popover";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { CheckIcon, XIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";

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

/* Tooltip ---------------------------------------------------------------- */

export const TooltipProvider = BaseTooltip.Provider;

export function Tooltip({
  label,
  shortcut,
  side = "bottom",
  children,
}: {
  label: ReactNode;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactElement;
}) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={6}>
          <BaseTooltip.Popup {...stylex.props(styles.tooltip)}>
            {label}
            {shortcut && <Kbd sx={styles.tooltipKbd}>{shortcut}</Kbd>}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

/* Menu ------------------------------------------------------------------- */

export function Menu({
  trigger,
  children,
  align = "start",
  side = "bottom",
  width,
}: {
  trigger: ReactElement;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  width?: number;
}) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner
          align={align}
          side={side}
          sideOffset={4}
          {...stylex.props(styles.positioner)}
        >
          <BaseMenu.Popup
            {...stylex.props(
              styles.popup,
              styles.menu,
              width !== undefined && styles.width(width)
            )}
          >
            {children}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

export function MenuItem({
  icon,
  children,
  shortcut,
  onClick,
  danger = false,
  disabled = false,
  checked,
}: {
  icon?: ReactNode;
  children: ReactNode;
  shortcut?: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
}) {
  return (
    <BaseMenu.Item
      onClick={onClick}
      disabled={disabled}
      {...stylex.props(styles.item, danger && styles.danger)}
    >
      <span {...stylex.props(styles.itemIcon)}>
        {checked === undefined ? icon : checked && <CheckIcon size={14} />}
      </span>
      <span {...stylex.props(styles.itemLabel)}>{children}</span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </BaseMenu.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.menuLabel)}>{children}</div>;
}

export function MenuSeparator() {
  return <BaseMenu.Separator {...stylex.props(styles.separator)} />;
}

/* Popover ---------------------------------------------------------------- */

export function Popover({
  trigger,
  children,
  align = "start",
  side = "bottom",
  open,
  onOpenChange,
  sx,
}: {
  trigger: ReactElement;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
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
          {...stylex.props(styles.positioner)}
        >
          <BasePopover.Popup
            {...stylex.props(styles.popup, styles.popover, sx)}
          >
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}

/* Dialog ----------------------------------------------------------------- */

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
  popup: {
    transformOrigin: "var(--transform-origin)",
    backgroundColor: color.raised,
    boxShadow: shadow.float,
    outline: "none",
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
      ":is([data-ending-style])": "scale(0.96)",
    },
  },
  width: (width: number) => ({ width }),
  menu: {
    minWidth: 200,
    padding: space.xs,
    borderRadius: radius.md,
    maxHeight: "var(--available-height)",
    overflowY: "auto",
  },
  popover: {
    borderRadius: radius.md,
    padding: space.lg,
    maxWidth: "min(360px, var(--available-width))",
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    height: 30,
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
