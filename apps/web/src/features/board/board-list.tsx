import { ArrowDownIcon, ArrowUpIcon, TicketIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useQueries } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import type { SortingState } from "@tanstack/react-table";
import { createContext, useContext, useMemo, useState } from "react";

import type { Schemas } from "#api/client";
import { q } from "#api/queries";
import {
  DueChip,
  hueOfColor,
  STAGE_TONE,
  stageLabel,
  useMembers,
} from "#features/cards/card-bits";
import type { Card } from "#features/cards/card-bits";
import { ago, exactTime } from "#lib/time";
import { AvatarStack } from "#ui/avatar";
import { Badge } from "#ui/chip";
import { EmptyState, SkeletonBlock } from "#ui/feedback";
import {
  color,
  font,
  leading,
  media,
  radius,
  space,
  text,
} from "#ui/tokens.stylex";

import type { BoardFilter } from "./board-view";

type Board = Schemas["Board"];

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
});
const helper = createColumnHelper<typeof features, Card>();

const STAGE_ORDER: Record<Card["stage"], number> = {
  triage: 0,
  active: 1,
  not_now: 2,
  done: 3,
};

// A phone has room for the number, the title and where it sits; the rest needs a wide screen.
const WIDE_ONLY = new Set(["assignees", "dueOn", "lastActiveAt"]);

const ColumnColors = createContext(new Map<string, string>());

const columns = helper.columns([
  helper.accessor("number", {
    header: "#",
    cell: (info) => (
      <span {...stylex.props(styles.number)}>#{info.getValue()}</span>
    ),
  }),
  helper.accessor("title", {
    header: "Card",
    sortFn: sortFn_text,
    cell: (info) => <TitleCell card={info.row.original} />,
  }),
  helper.accessor(
    (card) => STAGE_ORDER[card.stage] * 100 + (card.columnName ? 1 : 0),
    {
      id: "where",
      header: "Where",
      cell: (info) => <WhereCell card={info.row.original} />,
    }
  ),
  helper.accessor((card) => card.assigneeIds.length, {
    id: "assignees",
    header: "Assignees",
    cell: (info) => <AssigneesCell ids={info.row.original.assigneeIds} />,
  }),
  helper.accessor((card) => card.dueOn ?? "9999-12-31", {
    id: "dueOn",
    header: "Due",
    sortFn: sortFn_basic,
    cell: (info) => <DueCell card={info.row.original} />,
  }),
  helper.accessor("lastActiveAt", {
    header: "Last activity",
    // ISO timestamps order correctly as plain strings.
    sortFn: sortFn_basic,
    cell: (info) => (
      <time title={exactTime(info.getValue())} {...stylex.props(styles.time)}>
        {ago(info.getValue())}
      </time>
    ),
  }),
]);

function TitleCell({ card }: { card: Card }) {
  return (
    <Link
      to="."
      search={(prev: Record<string, unknown>) => ({
        ...prev,
        card: card.number,
      })}
      {...stylex.props(styles.title)}
    >
      {card.title}
      {card.golden && (
        <TicketIcon
          size={13}
          aria-label="Golden ticket"
          {...stylex.props(styles.gold)}
        />
      )}
    </Link>
  );
}

function WhereCell({ card }: { card: Card }) {
  const colors = useContext(ColumnColors);
  const columnColor = card.columnId ? colors.get(card.columnId) : undefined;
  // A column reads as it does on the board, its dot and name, so it keeps its colour in both views.
  if (card.stage === "active" && columnColor !== undefined) {
    return (
      <Badge
        icon={
          <span
            {...stylex.props(styles.dot, styles.hue(hueOfColor(columnColor)))}
          />
        }
      >
        {card.columnName ?? "Active"}
      </Badge>
    );
  }
  return (
    <Badge tone={STAGE_TONE[card.stage]}>
      {card.stage === "active"
        ? (card.columnName ?? "Active")
        : stageLabel(card.stage)}
    </Badge>
  );
}

function AssigneesCell({ ids }: { ids: string[] }) {
  const { byId } = useMembers();
  return (
    <AvatarStack
      people={ids.map((id) => byId.get(id)).filter((m) => m !== undefined)}
    />
  );
}

function DueCell({ card }: { card: Card }) {
  return card.dueOn ? (
    <DueChip
      on={card.dueOn}
      done={card.stage === "done" || card.stage === "not_now"}
    />
  ) : null;
}

function ariaSort(sorted: false | "asc" | "desc") {
  if (sorted === "asc") {
    return "ascending";
  }
  return sorted === "desc" ? "descending" : "none";
}

/**
 * The same cards as the board, as a table: denser, sortable by any column, and better for a
 * board with more cards than fit on screen.
 */
export function BoardList({
  board,
  filter,
}: {
  board: Board;
  filter: BoardFilter;
}) {
  const results = useQueries({
    queries: [
      q.cards({ board: board.id, stage: "active" }),
      q.cards({ board: board.id, stage: "triage" }),
      q.cards({ board: board.id, stage: "not_now", limit: 100 }),
      q.cards({ board: board.id, stage: "done", limit: 100 }),
    ],
  });
  const navigate = useNavigate();
  const [sorting, setSorting] = useState<SortingState>([
    { id: "lastActiveAt", desc: true },
  ]);
  const loading = results.some((r) => r.isPending);
  const [active, triage, later, done] = results.map((r) => r.data);

  const data = useMemo(() => {
    const term = filter.text.trim().toLowerCase();
    return [active, triage, later, done]
      .flatMap((list) => list ?? [])
      .filter(
        (c) =>
          (!filter.mine ||
            (filter.meId !== undefined &&
              c.assigneeIds.includes(filter.meId))) &&
          (!term ||
            c.title.toLowerCase().includes(term) ||
            String(c.number) === term.replace("#", ""))
      );
  }, [active, triage, later, done, filter]);

  const colors = useMemo(
    () => new Map(board.columns.map((c) => [c.id, c.color])),
    [board.columns]
  );
  const table = useTable({
    features,
    columns,
    data,
    state: { sorting },
    onSortingChange: setSorting,
  });

  if (loading) {
    return (
      <div {...stylex.props(styles.wrap)}>
        <SkeletonBlock height={240} />
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <EmptyState title="No cards match">
        Change the filter, or press C to add one.
      </EmptyState>
    );
  }

  return (
    <ColumnColors value={colors}>
      <div {...stylex.props(styles.wrap)}>
        <table {...stylex.props(styles.table)}>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={ariaSort(sorted)}
                      {...stylex.props(
                        styles.th,
                        header.column.id === "title" && styles.thGrow,
                        WIDE_ONLY.has(header.column.id) && styles.wideOnly
                      )}
                    >
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        {...stylex.props(styles.sort)}
                      >
                        <table.FlexRender header={header} />
                        {/* The slot stays when unsorted, so sorting doesn't shift the columns. */}
                        <span {...stylex.props(styles.arrow)}>
                          {sorted === "asc" && <ArrowUpIcon size={12} />}
                          {sorted === "desc" && <ArrowDownIcon size={12} />}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                onClick={(event) => {
                  // The title link already navigated; the row is the larger pointer target.
                  if (
                    event.target instanceof Element &&
                    event.target.closest("a")
                  ) {
                    return;
                  }
                  void navigate({
                    to: ".",
                    search: (prev: Record<string, unknown>) => ({
                      ...prev,
                      card: row.original.number,
                    }),
                  });
                }}
                {...stylex.props(styles.tr)}
              >
                {row.getAllCells().map((cell) => (
                  <td
                    key={cell.id}
                    {...stylex.props(
                      styles.td,
                      WIDE_ONLY.has(cell.column.id) && styles.wideOnly
                    )}
                  >
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ColumnColors>
  );
}

const styles = stylex.create({
  wrap: {
    flexGrow: 1,
    minHeight: 0,
    overflow: "auto",
    paddingInline: { default: space.x3, "@media (max-width: 640px)": space.lg },
    paddingTop: space.lg,
    paddingBottom: space.x4,
  },
  table: {
    width: "100%",
    minWidth: { default: 720, "@media (max-width: 640px)": 0 },
    borderCollapse: "separate",
    borderSpacing: 0,
    fontSize: text.label,
    lineHeight: leading.label,
  },
  th: {
    position: "sticky",
    top: 0,
    zIndex: 1,
    paddingBlock: space.sm,
    paddingInline: space.md,
    textAlign: "left",
    whiteSpace: "nowrap",
    fontSize: text.meta,
    fontWeight: 500,
    color: color.fgMuted,
    backgroundColor: color.bg,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
  },
  thGrow: { width: "100%" },
  wideOnly: { display: { default: null, "@media (max-width: 640px)": "none" } },
  arrow: { display: "inline-grid", width: 12, flexShrink: 0 },
  sort: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    minHeight: { default: null, [media.touch]: 32 },
    borderRadius: radius.xs,
    color: {
      default: "inherit",
      ":hover": { default: null, [media.hover]: color.fg },
    },
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
  },
  tr: {
    cursor: "pointer",
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.surface },
    },
  },
  td: {
    height: 40,
    paddingBlock: space.sm,
    paddingInline: space.md,
    whiteSpace: "nowrap",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
    verticalAlign: "middle",
  },
  number: { fontFamily: font.mono, fontSize: 11.5, color: color.fgFaint },
  dot: { width: 7, height: 7, borderRadius: "50%" },
  hue: (hue: number) => ({
    backgroundColor: hue < 0 ? color.fgFaint : `oklch(0.66 0.15 ${hue})`,
  }),
  title: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    fontWeight: 500,
    color: color.fg,
    whiteSpace: "normal",
    borderRadius: radius.xs,
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
    outlineOffset: 2,
  },
  gold: { color: color.goldFg, flexShrink: 0 },
  time: {
    fontSize: text.meta,
    color: color.fgMuted,
    fontVariantNumeric: "tabular-nums",
  },
});
