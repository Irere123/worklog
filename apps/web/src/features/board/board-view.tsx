import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
  CheckIcon,
  DotsThreeIcon,
  HourglassMediumIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import type { Schemas } from "#api/client";
import { api, unwrap } from "#api/client";
import { q } from "#api/queries";
import { useCardActions } from "#features/cards/actions";
import type { CardAction } from "#features/cards/actions";
import { CardTile, COLUMN_COLORS, hueOfColor } from "#features/cards/card-bits";
import type { Card } from "#features/cards/card-bits";
import { Button } from "#ui/button";
import { SkeletonBlock } from "#ui/feedback";
import { Input } from "#ui/field";
import {
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuSwatches,
} from "#ui/overlay";
import {
  color,
  leading,
  media,
  motion,
  radius,
  space,
  text,
} from "#ui/tokens.stylex";

import { PromptDialog } from "./prompt-dialog";

type Board = Schemas["Board"];
type Column = Schemas["Column"];

export type BoardFilter = { mine: boolean; text: string; meId?: string };

type Target =
  | { kind: "triage" }
  | { kind: "column"; columnId: string }
  | { kind: "later" }
  | { kind: "done" };

type Edges = { later: boolean; done: boolean };

const FOLDED: Edges = { later: false, done: false };

export function BoardView({
  board,
  filter,
}: {
  board: Board;
  filter: BoardFilter;
}) {
  const [active, triage, later, done] = useQueries({
    queries: [
      q.cards({ board: board.id, stage: "active" }),
      q.cards({ board: board.id, stage: "triage" }),
      q.cards({ board: board.id, stage: "not_now", limit: 100 }),
      q.cards({ board: board.id, stage: "done", limit: 100 }),
    ],
  });
  const columnNames = useMemo(
    () => new Map(board.columns.map((c) => [c.id, c.name])),
    [board.columns]
  );
  const actions = useCardActions(columnNames);
  const [open, setOpen] = useEdgeColumns(board.id);
  // Arrow keys walk the cards like a grid, as in Fizzy; Enter opens the focused one.
  const boardRef = useRef<HTMLDivElement>(null);
  const walk = (dx: number, dy: number) => () => {
    if (boardRef.current) {
      moveFocus(boardRef.current, dx, dy);
    }
  };
  useHotkey("ArrowDown", walk(0, 1), { target: boardRef });
  useHotkey("ArrowUp", walk(0, -1), { target: boardRef });
  useHotkey("ArrowRight", walk(1, 0), { target: boardRef });
  useHotkey("ArrowLeft", walk(-1, 0), { target: boardRef });

  // Optimistic moves change a card's stage inside the list it came from, so regroup across all
  // four lists by what each card says now rather than by which request returned it.
  const cards = useMemo(() => {
    const seen = new Map<number, Card>();
    for (const list of [active.data, triage.data, later.data, done.data]) {
      for (const card of list ?? []) {
        seen.set(card.number, card);
      }
    }
    const query = filter.text.trim().toLowerCase();
    return [...seen.values()].filter(
      (c) =>
        (!filter.mine ||
          (filter.meId !== undefined && c.assigneeIds.includes(filter.meId))) &&
        (!query ||
          c.title.toLowerCase().includes(query) ||
          String(c.number) === query.replace("#", ""))
    );
  }, [active.data, triage.data, later.data, done.data, filter]);

  const grouped = useMemo(() => {
    const by = new Map<string, Card[]>();
    for (const card of cards) {
      const key = groupOf(card);
      by.set(key, [...(by.get(key) ?? []), card]);
    }
    for (const [key, list] of by) {
      by.set(
        key,
        list.toSorted(
          (a, b) =>
            Number(b.golden) - Number(a.golden) ||
            Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt)
        )
      );
    }
    return by;
  }, [cards]);

  useEffect(
    () =>
      monitorForElements({
        onDrop: ({ source, location }) => {
          const target = location.current.dropTargets[0]?.data.target;
          const card = cards.find((c) => c.number === source.data.number);
          if (!isTarget(target) || !card) {
            return;
          }
          const action = actionFor(card, target);
          if (action) {
            actions.mutate({ card, action });
          }
        },
      }),
    [cards, actions]
  );

  // A filtered-out column isn't empty: saying "Drop a card here" would hide that cards exist.
  const narrowed = filter.mine || filter.text.trim() !== "";
  const noMatch = filter.mine ? "None of yours here." : "No cards match here.";

  if (active.isPending || triage.isPending) {
    return (
      <div {...stylex.props(styles.board)}>
        {[0, 1, 2].map((i) => (
          <div key={i} {...stylex.props(styles.column)}>
            <SkeletonBlock height={84} />
            <SkeletonBlock height={84} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div ref={boardRef} {...stylex.props(styles.board)}>
      <EdgeColumn
        title="Not now"
        target={{ kind: "later" }}
        cards={grouped.get("later") ?? []}
        open={open.later}
        onToggle={() => setOpen({ ...open, later: !open.later })}
        icon={<HourglassMediumIcon size={13} />}
      />
      <ColumnShell
        title="Maybe?"
        hint="New cards land here until someone decides where they go."
        target={{ kind: "triage" }}
        hue={295}
        count={grouped.get("triage")?.length ?? 0}
        top={<QuickAdd boardId={board.id} />}
      >
        <CardList
          cards={grouped.get("triage") ?? []}
          empty={narrowed ? noMatch : "Nothing waiting for a decision."}
        />
      </ColumnShell>
      {board.columns.map((column) => (
        <ColumnShell
          key={column.id}
          title={column.name}
          target={{ kind: "column", columnId: column.id }}
          hue={hueOfColor(column.color)}
          count={grouped.get(column.id)?.length ?? 0}
          menu={<ColumnMenu column={column} boardId={board.id} />}
        >
          <CardList
            cards={grouped.get(column.id) ?? []}
            columnColor={column.color}
            empty={narrowed ? noMatch : "Drop a card here."}
          />
        </ColumnShell>
      ))}
      <AddColumn boardId={board.id} />
      <EdgeColumn
        title="Done"
        target={{ kind: "done" }}
        cards={grouped.get("done") ?? []}
        open={open.done}
        onToggle={() => setOpen({ ...open, done: !open.done })}
        icon={<CheckIcon size={13} />}
      />
    </div>
  );
}

function groupOf(card: Card) {
  if (card.stage === "active" && card.columnId) {
    return card.columnId;
  }
  if (card.stage === "not_now") {
    return "later";
  }
  return card.stage === "done" ? "done" : "triage";
}

function isTarget(value: unknown): value is Target {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }
  if (value.kind === "column") {
    return "columnId" in value && typeof value.columnId === "string";
  }
  return (
    value.kind === "triage" || value.kind === "later" || value.kind === "done"
  );
}

function moveFocus(board: HTMLElement, dx: number, dy: number) {
  const columns = [
    ...board.querySelectorAll<HTMLElement>("[data-board-column]"),
  ]
    .map((column) => [
      ...column.querySelectorAll<HTMLElement>("[data-board-card] > a"),
    ])
    .filter((cards) => cards.length > 0);
  const active = document.activeElement;
  const column = columns.findIndex((cards) =>
    cards.some((card) => card === active)
  );
  const cards = columns[column];
  if (!cards) {
    columns[0]?.[0]?.focus();
    return;
  }
  const row = active instanceof HTMLElement ? cards.indexOf(active) : 0;
  const target =
    dy === 0
      ? columns[column + dx]?.[
          Math.min(row, (columns[column + dx]?.length ?? 1) - 1)
        ]
      : cards[Math.max(0, Math.min(cards.length - 1, row + dy))];
  target?.focus();
  target?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function actionFor(card: Card, target: Target): CardAction | null {
  switch (target.kind) {
    case "column": {
      return card.stage === "active" && card.columnId === target.columnId
        ? null
        : { type: "move", columnId: target.columnId };
    }
    case "triage": {
      return card.stage === "triage" ? null : { type: "triage" };
    }
    case "later": {
      return card.stage === "not_now" ? null : { type: "later" };
    }
    case "done": {
      return card.stage === "done" ? null : { type: "close" };
    }
    default: {
      return null;
    }
  }
}

function useEdgeColumns(boardId: string) {
  const key = `worklog.board.${boardId}.edges`;
  const [edges, setEdges] = useState(() => readEdges(key));
  const setOpen = (next: Edges) => {
    localStorage.setItem(key, JSON.stringify(next));
    setEdges(next);
  };
  return [edges, setOpen] as const;
}

function readEdges(key: string): Edges {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (typeof saved !== "object" || saved === null) {
      return FOLDED;
    }
    return {
      later: "later" in saved && saved.later === true,
      done: "done" in saved && saved.done === true,
    };
  } catch {
    return FOLDED;
  }
}

function useDropTarget(target: Target) {
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  // Callers build the target inline on every render, so the effect keys on its parts and
  // rebuilds it rather than re-registering the drop target each time.
  const { kind } = target;
  const columnId = target.kind === "column" ? target.columnId : undefined;
  useEffect(() => {
    const element = ref.current;
    const data = { target: kind === "column" ? { kind, columnId } : { kind } };
    return element
      ? dropTargetForElements({
          element,
          getData: () => data,
          onDragEnter: () => setOver(true),
          onDragLeave: () => setOver(false),
          onDrop: () => setOver(false),
        })
      : undefined;
  }, [kind, columnId]);
  return { ref, over };
}

function ColumnShell({
  title,
  hint,
  target,
  hue,
  count,
  top,
  menu,
  children,
}: {
  title: string;
  hint?: string;
  target: Target;
  hue: number;
  count: number;
  top?: ReactNode;
  menu?: ReactNode;
  children: ReactNode;
}) {
  const { ref, over } = useDropTarget(target);
  return (
    <section
      aria-label={title}
      ref={ref}
      {...stylex.props(styles.column, over && styles.over)}
    >
      <header {...stylex.props(styles.columnHead)} title={hint}>
        <span {...stylex.props(styles.columnDot, styles.hue(hue))} />
        <h2 {...stylex.props(styles.columnTitle)}>{title}</h2>
        <span {...stylex.props(styles.columnCount)}>{count}</span>
        <span {...stylex.props(styles.grow)} />
        {menu}
      </header>
      {top}
      <div {...stylex.props(styles.columnBody)}>{children}</div>
    </section>
  );
}

/** Not now and Done sit folded at the edges as tall pills, so the middle stays about current work. */
function EdgeColumn({
  title,
  target,
  cards,
  open,
  onToggle,
  icon,
}: {
  title: string;
  target: Target;
  cards: Card[];
  open: boolean;
  onToggle: () => void;
  icon: ReactNode;
}) {
  const { ref, over } = useDropTarget(target);
  if (!open) {
    return (
      <div ref={ref} {...stylex.props(styles.pillWrap)}>
        <button
          type="button"
          onClick={onToggle}
          aria-label={`Show ${title} (${cards.length})`}
          {...stylex.props(styles.pill, over && styles.pillOver)}
        >
          <span {...stylex.props(styles.pillCount)}>{cards.length}</span>
          <span {...stylex.props(styles.pillLabel)}>{title}</span>
          <span {...stylex.props(styles.pillIcon)}>{icon}</span>
        </button>
      </div>
    );
  }
  return (
    <section
      aria-label={title}
      ref={ref}
      {...stylex.props(styles.column, styles.edgeOpen, over && styles.over)}
    >
      <header {...stylex.props(styles.columnHead)}>
        <span {...stylex.props(styles.pillIcon)}>{icon}</span>
        <h2 {...stylex.props(styles.columnTitle)}>{title}</h2>
        <span {...stylex.props(styles.columnCount)}>{cards.length}</span>
        <span {...stylex.props(styles.grow)} />
        <Button size="sm" variant="ghost" onClick={onToggle}>
          Fold
        </Button>
      </header>
      <div {...stylex.props(styles.columnBody)}>
        <CardList
          cards={cards}
          empty={title === "Done" ? "Nothing finished yet." : "Nothing parked."}
        />
      </div>
    </section>
  );
}

function CardList({
  cards,
  columnColor,
  empty,
}: {
  cards: Card[];
  columnColor?: string;
  empty: string;
}) {
  if (cards.length === 0) {
    return <p {...stylex.props(styles.empty)}>{empty}</p>;
  }
  return (
    <ul data-board-column {...stylex.props(styles.list)}>
      {cards.map((card) => (
        <DraggableCard
          key={card.number}
          card={card}
          columnColor={columnColor}
        />
      ))}
    </ul>
  );
}

function DraggableCard({
  card,
  columnColor,
}: {
  card: Card;
  columnColor?: string;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const element = ref.current;
    return element
      ? combine(
          draggable({
            element,
            getInitialData: () => ({ number: card.number }),
            onDragStart: () => setDragging(true),
            onDrop: () => setDragging(false),
          })
        )
      : undefined;
  }, [card.number]);
  return (
    <li
      ref={ref}
      data-board-card
      {...stylex.props(styles.item, dragging && styles.dragging)}
    >
      <CardTile card={card} columnColor={columnColor} />
    </li>
  );
}

function QuickAdd({ boardId }: { boardId: string }) {
  const [title, setTitle] = useState("");
  const client = useQueryClient();
  const add = useMutation({
    mutationFn: async (value: string) =>
      await unwrap(api.POST("/v1/cards", { body: { boardId, title: value } })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["cards"] });
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const value = title.trim();
        if (value) {
          add.mutate(value);
          setTitle("");
        }
      }}
      {...stylex.props(styles.quickAdd)}
    >
      <Input
        aria-label="Add a card"
        placeholder="Add a card…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        leading={<PlusIcon size={14} />}
      />
    </form>
  );
}

function ColumnMenu({ column, boardId }: { column: Column; boardId: string }) {
  const client = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["boards", boardId] });
  };
  const update = useMutation({
    mutationFn: async (body: { name?: string; color?: string }) =>
      await unwrap(
        api.PATCH("/v1/columns/{id}", {
          params: { path: { id: column.id } },
          body,
        })
      ),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: async () =>
      await unwrap(
        api.DELETE("/v1/columns/{id}", { params: { path: { id: column.id } } })
      ),
    onSuccess: () => {
      refresh();
      void client.invalidateQueries({ queryKey: ["cards"] });
      toast(`Removed ${column.name}. Its cards went back to Maybe?`);
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <>
      <PromptDialog
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename column"
        label="Column name"
        initial={column.name}
        onSubmit={(value) => {
          const name = value.trim();
          if (name && name !== column.name) {
            update.mutate({ name });
          }
        }}
      />
      <Menu
        align="end"
        trigger={
          <Button
            size="sm"
            variant="ghost"
            aria-label={`${column.name} options`}
            icon={<DotsThreeIcon size={14} />}
          />
        }
      >
        <MenuItem
          icon={<PencilSimpleIcon size={14} />}
          onClick={() => setRenaming(true)}
        >
          Rename…
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Colour</MenuLabel>
        <MenuSwatches
          label="Colour"
          value={column.color}
          onValueChange={(next) => update.mutate({ color: next })}
          options={COLUMN_COLORS.map((name) => ({
            value: name,
            label: name.charAt(0).toUpperCase() + name.slice(1),
            color: swatchColor(hueOfColor(name)),
          }))}
        />
        <MenuSeparator />
        <MenuItem
          icon={<TrashIcon size={14} />}
          danger
          onClick={() => remove.mutate()}
        >
          Delete column
        </MenuItem>
      </Menu>
    </>
  );
}

function AddColumn({ boardId }: { boardId: string }) {
  const [name, setName] = useState<string | null>(null);
  const client = useQueryClient();
  const add = useMutation({
    mutationFn: async (value: string) =>
      await unwrap(
        api.POST("/v1/boards/{id}/columns", {
          params: { path: { id: boardId } },
          body: { name: value },
        })
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["boards", boardId] });
    },
    onError: (error) => toast.error(error.message),
  });
  if (name === null) {
    return (
      <button
        type="button"
        onClick={() => setName("")}
        aria-label="Add column"
        {...stylex.props(styles.addColumn)}
      >
        <PlusIcon size={16} />
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) {
          add.mutate(name.trim());
        }
        setName(null);
      }}
      {...stylex.props(styles.addColumnForm)}
    >
      <Input
        autoFocus
        aria-label="Column name"
        placeholder="Column name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (!name.trim()) {
            setName(null);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setName(null);
          }
        }}
      />
    </form>
  );
}

function swatchColor(hue: number) {
  return hue < 0 ? color.fgFaint : `oklch(0.66 0.15 ${hue})`;
}

const styles = stylex.create({
  board: {
    flexGrow: 1,
    minHeight: 0,
    display: "flex",
    alignItems: "stretch",
    gap: space.lg,
    paddingInline: { default: space.x3, "@media (max-width: 640px)": space.lg },
    paddingTop: space.xl,
    paddingBottom: space.md,
    overflowX: "auto",
    overflowY: "hidden",
    scrollSnapType: {
      default: null,
      "@media (max-width: 640px)": "x mandatory",
    },
    scrollPaddingInline: space.lg,
  },
  column: {
    width: { default: 296, "@media (max-width: 640px)": "calc(100vw - 56px)" },
    scrollSnapAlign: "start",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    minHeight: 0,
    paddingInline: space.sm,
    paddingBottom: space.sm,
    borderRadius: radius.lg,
    backgroundColor: "transparent",
    transitionProperty: "background-color, box-shadow",
    transitionDuration: "350ms",
    transitionTimingFunction: "cubic-bezier(0.15, 1, 0.3, 1)",
  },
  edgeOpen: { backgroundColor: color.surface },
  over: {
    backgroundColor: color.accentSubtle,
    boxShadow: `inset 0 0 0 1.5px ${color.accentLine}`,
  },
  columnHead: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    height: 32,
    flexShrink: 0,
    paddingInline: space.xs,
  },
  columnDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  // Inline, not swatchColor(): StyleX compiles dynamic styles apart from this module's functions.
  hue: (hue: number) => ({
    backgroundColor: hue < 0 ? color.fgFaint : `oklch(0.66 0.15 ${hue})`,
  }),
  columnTitle: {
    fontSize: text.label,
    fontWeight: 600,
    color: color.fg,
    whiteSpace: "nowrap",
  },
  columnCount: {
    fontSize: text.meta,
    color: color.fgFaint,
    fontVariantNumeric: "tabular-nums",
  },
  grow: { flexGrow: 1 },
  columnBody: {
    flexGrow: 1,
    minHeight: 60,
    overflowY: "auto",
    marginInline: -6,
    paddingInline: 6,
    paddingTop: 12,
    marginTop: -12,
    paddingBottom: space.lg,
  },
  list: { display: "flex", flexDirection: "column", gap: space.md },
  item: { transitionProperty: "opacity", transitionDuration: motion.fast },
  dragging: { opacity: 0.35 },
  empty: {
    paddingBlock: space.x3,
    paddingInline: space.lg,
    textAlign: "center",
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgFaint,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: color.line,
  },
  quickAdd: { flexShrink: 0 },
  pillWrap: { flexShrink: 0, display: "flex", paddingTop: 0 },
  pill: {
    width: 40,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.md,
    paddingBlock: space.md,
    borderRadius: radius.full,
    backgroundColor: {
      default: color.ui,
      ":hover": { default: null, [media.hover]: color.uiHover },
    },
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    maxHeight: 280,
    transitionProperty: "background-color, box-shadow",
    transitionDuration: motion.fast,
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
  },
  pillOver: {
    backgroundColor: color.accentSubtle,
    boxShadow: `inset 0 0 0 1.5px ${color.accentLine}`,
  },
  pillCount: {
    minWidth: 24,
    height: 24,
    display: "grid",
    placeItems: "center",
    borderRadius: "50%",
    backgroundColor: color.raised,
    fontSize: text.meta,
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
    color: color.fg,
    boxShadow: `0 0 0 1px ${color.line}`,
  },
  pillLabel: {
    writingMode: "vertical-rl",
    fontSize: text.caption,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  pillIcon: { display: "grid", placeItems: "center", color: color.fgFaint },
  addColumn: {
    flexShrink: 0,
    width: 40,
    height: 40,
    display: "grid",
    placeItems: "center",
    borderRadius: radius.md,
    color: {
      default: color.fgFaint,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.uiHover },
    },
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: color.lineUi,
  },
  addColumnForm: { width: 220, flexShrink: 0 },
});
