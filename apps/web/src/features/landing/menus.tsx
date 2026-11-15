import { Menu } from "@base-ui/react/menu";
import { CaretDownIcon } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import type { MouseEvent, ReactNode } from "react";

import { space } from "#ui/tokens.stylex";

export type NavItem = {
  title: string;
  href: string;
  icon: Icon;
  tint: string;
};

/**
 * A menu of places in the nav, as resurf's Resources is: a dark panel of tiles, three to a row,
 * each a coloured glyph over its name. It opens on hover for a pointer and on a press for
 * everyone else, and moves by arrow keys.
 */
export function NavMenu({
  label,
  items,
  align = "center",
  trigger,
  onPoint,
  onLeave,
  onOpenChange,
}: {
  label: ReactNode;
  items: NavItem[];
  align?: "start" | "center" | "end";
  trigger: StyleXStyles;
  onPoint?: (event: MouseEvent<HTMLElement>) => void;
  onLeave?: () => void;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Menu.Root modal={false} onOpenChange={onOpenChange}>
      <Menu.Trigger
        openOnHover
        delay={80}
        closeDelay={120}
        onMouseEnter={onPoint}
        onMouseLeave={onLeave}
        {...stylex.props(trigger, styles.trigger)}
      >
        {label}
        <CaretDownIcon
          size={11}
          weight="bold"
          {...stylex.props(styles.caret)}
        />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          align={align}
          sideOffset={10}
          collisionPadding={16}
          {...stylex.props(styles.positioner)}
        >
          <Menu.Popup {...stylex.props(styles.popup)}>
            {items.map(({ title, href, icon: Glyph, tint }) => (
              <Menu.LinkItem
                key={title}
                href={href}
                label={title}
                closeOnClick
                {...stylex.props(styles.item)}
              >
                <Glyph
                  size={22}
                  weight="fill"
                  {...stylex.props(styles.icon(tint))}
                />
                <span {...stylex.props(styles.title)}>{title}</span>
              </Menu.LinkItem>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

// The panel is dark on the light page, as resurf's is: it reads as something laid over it.
const PANEL = "oklch(0.25 0.004 80)";
const ROW_HOVER = "oklch(0.3 0.004 80)";

const styles = stylex.create({
  trigger: {
    gap: space.xs,
    borderWidth: 0,
    borderStyle: "none",
    fontFamily: "inherit",
    cursor: "pointer",
  },
  caret: {
    opacity: 0.6,
    transitionProperty: "transform",
    transitionDuration: "200ms",
    transform: {
      default: "none",
      ":is([data-popup-open] > *)": "rotate(180deg)",
    },
  },
  positioner: {
    zIndex: 40,
  },
  popup: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 1,
    width: 600,
    maxWidth: "calc(100vw - 32px)",
    overflow: "hidden",
    borderRadius: 16,
    // Seen through the 1px gaps between tiles, it rules them apart without a border on each.
    backgroundColor: "oklch(0.33 0.004 80)",
    boxShadow:
      "0 0 0 1px oklch(1 0 0 / 0.1), 0 1px 2px oklch(0 0 0 / 0.05), 0 4px 8px -2px oklch(0 0 0 / 0.05), 0 12px 24px -4px oklch(0 0 0 / 0.06), 0 24px 48px -8px oklch(0 0 0 / 0.07)",
    transformOrigin: "var(--transform-origin)",
    outline: "none",
    transitionProperty: "opacity, transform",
    transitionDuration: "150ms",
    transitionTimingFunction: "ease-out",
    opacity: {
      default: 1,
      ":is([data-starting-style], [data-ending-style])": 0,
    },
    transform: {
      default: "none",
      ":is([data-starting-style], [data-ending-style])": "translateY(-4px)",
    },
  },
  item: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    minHeight: 104,
    padding: space.xl,
    backgroundColor: {
      default: PANEL,
      ":is([data-highlighted])": ROW_HOVER,
    },
    color: "oklch(1 0 0)",
    textDecoration: "none",
    outline: "none",
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: "120ms",
  },
  icon: (tint: string) => ({
    color: tint,
  }),
  title: {
    fontSize: 15,
    lineHeight: "20px",
    fontWeight: 500,
    letterSpacing: "-0.005em",
  },
});
