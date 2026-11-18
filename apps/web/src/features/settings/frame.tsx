import {
  BellIcon,
  BrainIcon,
  CalendarDotsIcon,
  IdentificationBadgeIcon,
  KeyIcon,
  PaperPlaneRightIcon,
  PlugIcon,
  ScrollIcon,
  ThumbsUpIcon,
  UserIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { Link, useLocation } from "@tanstack/react-router";
import type { LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

import { isShown } from "#lib/node";
import { PageHeader } from "#ui/layout";
import {
  color,
  leading,
  media,
  radius,
  shadow,
  space,
  text,
} from "#ui/tokens.stylex";

const GROUPS: {
  title: string;
  items: { to: LinkProps["to"]; label: string; icon: ReactNode }[];
}[] = [
  {
    title: "You",
    items: [
      { to: "/settings", label: "Profile", icon: <UserIcon size={15} /> },
      {
        to: "/settings/notifications",
        label: "Notifications",
        icon: <BellIcon size={15} />,
      },
      {
        to: "/settings/tokens",
        label: "API keys",
        icon: <KeyIcon size={15} />,
      },
    ],
  },
  {
    title: "Assistant",
    items: [
      {
        to: "/settings/assistant",
        label: "Instructions",
        icon: <ScrollIcon size={15} />,
      },
      {
        to: "/settings/memory",
        label: "Memory",
        icon: <BrainIcon size={15} />,
      },
      {
        to: "/settings/feedback",
        label: "Reply feedback",
        icon: <ThumbsUpIcon size={15} />,
      },
      {
        to: "/settings/automations",
        label: "Automations",
        icon: <CalendarDotsIcon size={15} />,
      },
    ],
  },
  {
    title: "Workspace",
    items: [
      {
        to: "/settings/members",
        label: "Members and agents",
        icon: <UsersIcon size={15} />,
      },
      {
        to: "/settings/identities",
        label: "People in your tools",
        icon: <IdentificationBadgeIcon size={15} />,
      },
      {
        to: "/settings/connections",
        label: "Connections",
        icon: <PlugIcon size={15} />,
      },
      {
        to: "/settings/delivery",
        label: "Delivery",
        icon: <PaperPlaneRightIcon size={15} />,
      },
    ],
  },
];

export function SettingsFrame({ children }: { children: ReactNode }) {
  const nav = useActiveInView();
  return (
    <>
      <PageHeader title="Settings" />
      <div {...stylex.props(styles.layout)}>
        <nav ref={nav} aria-label="Settings" {...stylex.props(styles.nav)}>
          {GROUPS.map((group) => (
            <div key={group.title} {...stylex.props(styles.group)}>
              <p {...stylex.props(styles.groupTitle)}>{group.title}</p>
              {group.items.map((item) => (
                <Link
                  key={item.label}
                  to={item.to}
                  activeOptions={{ exact: item.to === "/settings" }}
                  {...stylex.props(styles.item)}
                >
                  {item.icon}
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div {...stylex.props(styles.content)}>
          <div {...stylex.props(styles.inner)}>{children}</div>
        </div>
      </div>
    </>
  );
}

function useActiveInView() {
  const ref = useRef<HTMLElement>(null);
  const pathname = useLocation({ select: (l) => l.pathname });
  useEffect(() => {
    const row = ref.current;
    const current =
      row?.querySelector<HTMLElement>(`a[href="${CSS.escape(pathname)}"]`) ??
      row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !current || row.scrollWidth <= row.clientWidth) {
      return;
    }
    const box = row.getBoundingClientRect();
    const at = current.getBoundingClientRect();
    row.scrollLeft += at.left - box.left - (box.width - at.width) / 2;
  }, [pathname]);
  return ref;
}

export function SettingsPage({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.pageHead)}>
        <h2 {...stylex.props(styles.pageTitle)}>{title}</h2>
        {isShown(actions) && (
          <div {...stylex.props(styles.pageActions)}>{actions}</div>
        )}
        {isShown(description) && (
          <p {...stylex.props(styles.pageDesc)}>{description}</p>
        )}
      </header>
      {children}
    </div>
  );
}

export function Card({
  title,
  description,
  footer,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section {...stylex.props(styles.card)}>
      {(isShown(title) || isShown(description)) && (
        <header {...stylex.props(styles.cardHead)}>
          {isShown(title) && (
            <h3 {...stylex.props(styles.cardTitle)}>{title}</h3>
          )}
          {isShown(description) && (
            <p {...stylex.props(styles.cardDesc)}>{description}</p>
          )}
        </header>
      )}
      <div {...stylex.props(styles.cardBody)}>{children}</div>
      {isShown(footer) && (
        <footer {...stylex.props(styles.cardFoot)}>{footer}</footer>
      )}
    </section>
  );
}

/** A label and its control on one line; the description says what changes, not what it is. */
export function Row({
  label,
  description,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.row)}>
      <div {...stylex.props(styles.grow)}>
        <p {...stylex.props(styles.rowLabel)}>{label}</p>
        {isShown(description) && (
          <p {...stylex.props(styles.rowDesc)}>{description}</p>
        )}
      </div>
      <div {...stylex.props(styles.rowControl)}>{children}</div>
    </div>
  );
}

const NARROW = "@container (max-width: 460px)";

export const settingsStyles = stylex.create({
  list: {
    display: "flex",
    flexDirection: "column",
    containerType: "inline-size",
  },
  listRow: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    minHeight: 48,
    paddingBlock: space.md,
    paddingInline: space.xl,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: { default: color.line, ":first-child": "transparent" },
  },
  main: { flexGrow: 1, minWidth: 0 },
  rowWraps: { flexWrap: { default: null, [NARROW]: "wrap" } },
  mainWraps: {
    flexBasis: { default: null, [NARROW]: "calc(100% - 40px)" },
    overflowWrap: "anywhere",
  },
  rowEnd: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    flexShrink: 0,
    marginInlineStart: { default: null, [NARROW]: "auto" },
  },
  strong: { fontSize: text.label, fontWeight: 500, color: color.fg },
  sub: { fontSize: text.meta, lineHeight: leading.meta, color: color.fgMuted },
  mono: { fontFamily: "ui-monospace, monospace", fontSize: 12 },
  form: { display: "flex", flexDirection: "column", gap: space.lg },
  inline: {
    display: "flex",
    alignItems: "flex-end",
    gap: space.md,
    flexWrap: "wrap",
  },
  pad: { padding: space.xl },
});

const styles = stylex.create({
  layout: {
    flexGrow: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: {
      default: "220px minmax(0, 1fr)",
      "@media (max-width: 860px)": "minmax(0, 1fr)",
    },
    gridTemplateRows: {
      default: null,
      "@media (max-width: 860px)": "auto minmax(0, 1fr)",
    },
  },
  nav: {
    display: "flex",
    flexDirection: { default: "column", "@media (max-width: 860px)": "row" },
    gap: { default: space.lg, "@media (max-width: 860px)": space.sm },
    padding: space.md,
    overflowY: { default: "auto", "@media (max-width: 860px)": "hidden" },
    overflowX: { default: "hidden", "@media (max-width: 860px)": "auto" },
    borderRightWidth: { default: 1, "@media (max-width: 860px)": 0 },
    borderBottomWidth: { default: 0, "@media (max-width: 860px)": 1 },
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderStyle: "solid",
    borderColor: color.line,
  },
  group: {
    display: "flex",
    flexDirection: { default: "column", "@media (max-width: 860px)": "row" },
    gap: 1,
    flexShrink: 0,
  },
  groupTitle: {
    display: { default: null, "@media (max-width: 860px)": "none" },
    paddingInline: space.md,
    paddingBlock: space.xs,
    fontSize: text.caption,
    fontWeight: 500,
    color: color.fgFaint,
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    height: 30,
    paddingInline: space.md,
    borderRadius: radius.sm,
    fontSize: text.label,
    fontWeight: 500,
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
      ":is([data-status=active])": color.fg,
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.uiHover },
      ":is([data-status=active])": color.uiActive,
    },
  },
  content: { overflowY: "auto", minHeight: 0 },
  inner: {
    maxWidth: 760,
    paddingInline: { default: space.x4, "@media (max-width: 640px)": space.lg },
    paddingTop: space.x3,
    paddingBottom: 96,
  },
  page: { display: "flex", flexDirection: "column", gap: space.xl },
  pageHead: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    columnGap: space.lg,
    alignItems: "start",
  },
  pageActions: { display: "flex", alignItems: "center", gap: space.lg },
  grow: { flexGrow: 1, minWidth: 0 },
  pageTitle: {
    fontSize: text.title,
    lineHeight: leading.title,
    fontWeight: 600,
  },
  pageDesc: {
    gridColumn: "1 / -1",
    maxWidth: "72ch",
    marginTop: space.xs,
    fontSize: text.label,
    lineHeight: leading.label,
    color: color.fgMuted,
  },
  card: {
    borderRadius: radius.md,
    backgroundColor: color.raised,
    boxShadow: shadow.card,
    overflow: "hidden",
  },
  cardHead: {
    paddingInline: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.sm,
  },
  cardTitle: { fontSize: text.label, fontWeight: 600 },
  cardDesc: {
    marginTop: 2,
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgMuted,
  },
  cardBody: {},
  cardFoot: {
    display: "flex",
    justifyContent: "flex-end",
    gap: space.md,
    paddingBlock: space.md,
    paddingInline: space.xl,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: color.line,
    backgroundColor: color.surface,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: space.xl,
    minHeight: 56,
    paddingBlock: space.md,
    paddingInline: space.xl,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: { default: color.line, ":first-child": "transparent" },
  },
  rowLabel: { fontSize: text.label, fontWeight: 500 },
  rowDesc: {
    marginTop: 2,
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgMuted,
  },
  rowControl: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: space.sm,
  },
});
