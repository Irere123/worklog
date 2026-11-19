import * as stylex from "@stylexjs/stylex";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  useNavigate,
  useRouter,
  useSearch,
} from "@tanstack/react-router";
import { Suspense, lazy, useEffect, useState } from "react";
import { toast } from "sonner";

import { useLiveEvents } from "#api/live";
import type { SentNews } from "#api/live";
import { CardPreviews } from "#features/cards/card-preview";
import { kindOf } from "#features/inbox/kinds";
import { showDesktopAlert } from "#lib/desktop-alerts";
import {
  setSidebarFolded,
  useNarrow,
  useSidebarFolded,
  useSidebarWidth,
} from "#lib/sidebar";
import { color, motion } from "#ui/tokens.stylex";

import { InShell } from "./fallbacks";
import { MobileBar } from "./mobile-bar";
import { Sidebar } from "./sidebar";
import { SidebarResizer } from "./sidebar-resizer";

const loaders = {
  palette: async () => await import("./command"),
  shortcuts: async () => await import("./shortcuts"),
  log: async () => await import("./quick-log"),
  card: async () => await import("#features/cards/new-card"),
  panel: async () => await import("#features/cards/card-panel"),
};
const CommandPalette = lazy(async () => {
  const { CommandPalette: component } = await loaders.palette();
  return { default: component };
});
const Shortcuts = lazy(async () => {
  const { Shortcuts: component } = await loaders.shortcuts();
  return { default: component };
});
const QuickLog = lazy(async () => {
  const { QuickLog: component } = await loaders.log();
  return { default: component };
});
const NewCardDialog = lazy(async () => {
  const { NewCardDialog: component } = await loaders.card();
  return { default: component };
});
const CardPanel = lazy(async () => {
  const { CardPanel: component } = await loaders.panel();
  return { default: component };
});

export type ShellDialog = "palette" | "shortcuts" | "log" | "card" | null;

const SENT_BODY: Record<string, string> = {
  push: "Blocked on you",
  brief: "Ready to read",
  digest: "What waited for you",
};

function destinationOf(news: SentNews) {
  const [only] = news.itemIds;
  if (news.kind === "push" && only !== undefined && news.itemIds.length === 1) {
    return { to: "/inbox", search: { item: only } } as const;
  }
  if (news.kind === "brief") {
    return { to: "/briefs" } as const;
  }
  return news.kind === "custom"
    ? ({ to: "/assistant" } as const)
    : ({ to: "/inbox" } as const);
}

export function Shell() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const live = useLiveEvents(client, true, {
    attention: (news) => {
      if (news.priority === "low") {
        return;
      }
      toast(news.title, {
        description: kindOf(news.kind).label,
        action: {
          label: "Open",
          onClick: () => {
            void navigate({ to: "/inbox", search: { item: news.id } });
          },
        },
      });
    },
    sent: (news) => {
      showDesktopAlert({
        title: news.subject,
        body: SENT_BODY[news.kind],
        tag: news.id,
        onOpen: () => {
          void navigate(destinationOf(news));
        },
      });
    },
  });
  const [dialog, setDialog] = useState<ShellDialog>(null);
  const [used, setUsed] = useState<ReadonlySet<ShellDialog>>(new Set());
  const show = (next: ShellDialog) => {
    setDialog(next);
    if (next) {
      setUsed((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
    }
  };
  const [drawer, setDrawer] = useState(false);
  const router = useRouter();
  useEffect(
    () => router.subscribe("onBeforeNavigate", () => setDrawer(false)),
    [router]
  );
  const narrow = useNarrow();
  const folded = useSidebarFolded();
  const rail = folded && !narrow;
  const width = useSidebarWidth();
  const [resizing, setResizing] = useState(false);
  const toggleSidebar = () => {
    if (narrow) {
      setDrawer(false);
    } else {
      setSidebarFolded(!folded);
    }
  };
  const card = useSearch({ from: "/_app", select: (s) => s.card });
  useEffect(() => {
    const warm = () => {
      for (const load of Object.values(loaders)) {
        void load();
      }
    };
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(warm, { timeout: 4000 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(warm, 2000);
    return () => clearTimeout(id);
  }, []);
  const mounted = (d: ShellDialog) => dialog === d || used.has(d);
  const open = (d: ShellDialog) => () => show(d);

  useHotkey("Mod+K", open("palette"), {
    meta: { name: "Command menu", group: "General" },
  });
  useHotkey("Shift+?", open("shortcuts"), {
    meta: { name: "Keyboard shortcuts", group: "General" },
  });
  useHotkey("Mod+\\", toggleSidebar, {
    meta: { name: "Fold the sidebar", group: "General" },
  });
  useHotkey("L", open("log"), { meta: { name: "Log work", group: "Create" } });
  useHotkey("C", open("card"), { meta: { name: "New card", group: "Create" } });
  const go = (to: string) => () => {
    void navigate({ to });
  };
  useHotkey(["G", "H"], go("/home"), {
    meta: { name: "Go to Home", group: "Navigate" },
  });
  useHotkey(["G", "I"], go("/inbox"), {
    meta: { name: "Go to Inbox", group: "Navigate" },
  });
  useHotkey(["G", "A"], go("/activity"), {
    meta: { name: "Go to Activity", group: "Navigate" },
  });
  useHotkey(["G", "B"], go("/boards"), {
    meta: { name: "Go to Boards", group: "Navigate" },
  });
  useHotkey(["G", "C"], go("/assistant"), {
    meta: { name: "Go to Assistant", group: "Navigate" },
  });
  useHotkey(["G", "P"], go("/people"), {
    meta: { name: "Go to People", group: "Navigate" },
  });
  useHotkey(["G", "R"], go("/briefs"), {
    meta: { name: "Go to Briefs", group: "Navigate" },
  });
  useHotkey(["G", "S"], go("/settings"), {
    meta: { name: "Go to Settings", group: "Navigate" },
  });
  const cardOpen = card !== undefined;
  useHotkey("1", go("/home"), {
    enabled: !cardOpen,
    meta: { name: "Home", group: "Navigate" },
  });
  useHotkey("B", go("/boards/new"), {
    enabled: !cardOpen,
    meta: { name: "New board", group: "Create" },
  });

  return (
    <div
      {...stylex.props(
        styles.shell,
        !narrow && !rail && styles.width(width),
        rail && styles.shellRail,
        resizing && styles.resizing
      )}
    >
      <a href="#main" {...stylex.props(styles.skip)}>
        Skip to content
      </a>
      <Sidebar
        live={live}
        drawer={drawer}
        rail={rail}
        onToggle={toggleSidebar}
        onOpen={(d) => {
          setDrawer(false);
          show(d);
        }}
      />
      {drawer && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setDrawer(false)}
          {...stylex.props(styles.scrim)}
        />
      )}
      <div {...stylex.props(styles.column)}>
        {!narrow && !rail && <SidebarResizer onResizing={setResizing} />}
        <MobileBar
          onMenu={() => setDrawer(true)}
          onSearch={() => show("palette")}
        />
        <main id="main" tabIndex={-1} {...stylex.props(styles.main)}>
          <InShell value>
            <Outlet />
          </InShell>
        </main>
      </div>
      <CardPreviews />
      <Suspense fallback={null}>
        {mounted("palette") && (
          <CommandPalette
            open={dialog === "palette"}
            onClose={() => show(null)}
            onOpen={show}
          />
        )}
        {mounted("shortcuts") && (
          <Shortcuts open={dialog === "shortcuts"} onClose={() => show(null)} />
        )}
        {mounted("log") && (
          <QuickLog open={dialog === "log"} onClose={() => show(null)} />
        )}
        {mounted("card") && (
          <NewCardDialog open={dialog === "card"} onClose={() => show(null)} />
        )}
        {card !== undefined && <CardPanel number={card} />}
      </Suspense>
    </div>
  );
}

const styles = stylex.create({
  shell: {
    display: "grid",
    gridTemplateColumns: {
      default: "232px minmax(0, 1fr)",
      "@media (max-width: 860px)": "minmax(0, 1fr)",
    },
    transitionProperty: "grid-template-columns",
    transitionDuration: {
      default: motion.slow,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.out,
    height: "100dvh",
    overflow: "hidden",
    backgroundColor: color.sidebar,
  },
  width: (width: number) => ({
    gridTemplateColumns: `${width}px minmax(0, 1fr)`,
  }),
  resizing: {
    transitionDuration: "0s",
    cursor: "col-resize",
    userSelect: "none",
  },
  shellRail: {
    gridTemplateColumns: {
      default: "56px minmax(0, 1fr)",
      "@media (max-width: 860px)": "minmax(0, 1fr)",
    },
  },
  skip: {
    position: "fixed",
    top: 8,
    left: 8,
    zIndex: 100,
    paddingBlock: 8,
    paddingInline: 12,
    borderRadius: 6,
    fontWeight: 600,
    color: color.fgOnSolid,
    backgroundColor: color.accent,
    transform: {
      default: "translateY(-200%)",
      ":focus-visible": "translateY(0)",
    },
    outline: "none",
  },
  column: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
  },
  main: {
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    margin: { default: 6, "@media (max-width: 860px)": 0 },
    marginLeft: 0,
    borderRadius: { default: 10, "@media (max-width: 860px)": 0 },
    backgroundColor: color.bg,
    boxShadow: {
      default: `0 0 0 1px ${color.line}`,
      "@media (max-width: 860px)": "none",
    },
    overflow: "hidden",
    position: "relative",
    outline: "none",
  },
  scrim: {
    display: { default: "none", "@media (max-width: 860px)": "block" },
    position: "fixed",
    inset: 0,
    zIndex: 44,
    backgroundColor: color.scrim,
    cursor: "default",
  },
});
