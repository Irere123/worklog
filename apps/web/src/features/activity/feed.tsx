import { ArrowUpIcon, ClockCountdownIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { ActivityFilter } from "#api/queries";
import { q } from "#api/queries";
import { dayKey, dayLabel } from "#lib/time";
import { EmptyState, ErrorNote, Skeleton } from "#ui/feedback";
import { color, radius, shadow, space, text } from "#ui/tokens.stylex";

import { ActivityLine, sameRun } from "./activity-line";
import type { Activity } from "./activity-line";

type Row =
  | { kind: "day"; key: string; label: string }
  | { kind: "item"; key: string; activity: Activity; earlier: Activity[] };

/**
 * One stream of everything, newest first, grouped by day. Virtualized: a busy team produces
 * thousands of rows a week, and only the visible ones are in the DOM.
 */
export function Feed({
  filter,
  hideActor = false,
  skip,
  header,
  headerPending = false,
  emptyText = "Activity from connected tools, logs and agents appears here.",
}: {
  filter: Omit<ActivityFilter, "before" | "limit">;
  hideActor?: boolean;
  /** Leaves out rows the page already shows elsewhere, such as an agent's sessions. */
  skip?: (activity: Activity) => boolean;
  /** Scrolls with the feed, above the first day. */
  header?: ReactNode;
  /** Holds the skeleton until the header's data lands, so the list doesn't jump when it does. */
  headerPending?: boolean;
  emptyText?: string;
}) {
  const feed = useInfiniteQuery(q.activities(filter));
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useLayoutEffect(() => {
    const el = headerRef.current;
    const watch = new ResizeObserver(() =>
      setHeaderHeight(el?.offsetHeight ?? 0)
    );
    if (el) {
      watch.observe(el);
    }
    return () => watch.disconnect();
  });
  const [atTop, setAtTop] = useState(true);
  const [seenTop, setSeenTop] = useState<string | undefined>();
  const firstId = feed.data?.pages[0]?.[0]?.id;
  const fresh = useMemo(() => {
    if (atTop || seenTop === undefined) {
      return 0;
    }
    const ids = (feed.data?.pages ?? []).flat().map((a) => a.id);
    return Math.max(0, ids.indexOf(seenTop));
  }, [atTop, seenTop, feed.data]);
  const onScroll = () => {
    const top = (scrollRef.current?.scrollTop ?? 0) < 40;
    if (top !== atTop) {
      setAtTop(top);
      if (!top) {
        setSeenTop(firstId);
      }
    }
  };

  const rows = useMemo(() => {
    const out: Row[] = [];
    let current = "";
    for (const page of feed.data?.pages ?? []) {
      for (const activity of page) {
        if (skip?.(activity) === true) {
          continue;
        }
        const day = dayKey(activity.occurredAt);
        if (day !== current) {
          current = day;
          out.push({
            kind: "day",
            key: `day-${day}`,
            label: dayLabel(activity.occurredAt),
          });
        }
        const previous = out.at(-1);
        if (previous?.kind === "item" && sameRun(previous.activity, activity)) {
          previous.earlier.push(activity);
          continue;
        }
        out.push({ kind: "item", key: activity.id, activity, earlier: [] });
      }
    }
    return out;
  }, [feed.data, skip]);

  // oxlint-disable-next-line react/incompatible-library -- the app doesn't run React Compiler, and no memoized child receives the virtualizer
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.kind === "day" ? 40 : 64),
    overscan: 10,
    getItemKey: (i) => rows[i]?.key ?? i,
    scrollMargin: headerHeight,
  });
  const items = virtual.getVirtualItems();
  const last = items.at(-1);
  const pinnedDay = dayAbove(rows, items, virtual.scrollOffset ?? 0);

  useEffect(() => {
    if (
      last &&
      last.index >= rows.length - 8 &&
      feed.hasNextPage &&
      !feed.isFetchingNextPage
    ) {
      void feed.fetchNextPage();
    }
  }, [last, rows.length, feed]);

  if (feed.isPending || headerPending) {
    return (
      <div {...stylex.props(styles.pad)}>
        <Skeleton lines={8} height={36} />
      </div>
    );
  }
  if (feed.isError) {
    return (
      <div {...stylex.props(styles.pad)}>
        <ErrorNote
          error={feed.error}
          retry={() => {
            void feed.refetch();
          }}
        />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div {...stylex.props(styles.scroll)}>
        {header !== undefined && (
          <div {...stylex.props(styles.header)}>{header}</div>
        )}
        <EmptyState icon={<ClockCountdownIcon size={20} />} title="Nothing yet">
          {emptyText}
        </EmptyState>
      </div>
    );
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} {...stylex.props(styles.scroll)}>
      {fresh > 0 && (
        <button
          type="button"
          onClick={() => {
            scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
          }}
          {...stylex.props(styles.fresh)}
        >
          <ArrowUpIcon size={13} /> {fresh} new
        </button>
      )}
      {header !== undefined && (
        <div ref={headerRef} {...stylex.props(styles.header)}>
          {header}
        </div>
      )}
      {pinnedDay && (
        <div aria-hidden {...stylex.props(styles.pinned)}>
          <p {...stylex.props(styles.day, styles.pinnedDay)}>{pinnedDay}</p>
        </div>
      )}
      <div
        {...stylex.props(styles.inner, styles.height(virtual.getTotalSize()))}
      >
        {items.map((item) => {
          const row = rows[item.index];
          if (!row) {
            return null;
          }
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtual.measureElement}
              {...stylex.props(
                styles.row,
                styles.offset(item.start - virtual.options.scrollMargin)
              )}
            >
              {row.kind === "day" ? (
                <h2 {...stylex.props(styles.day)}>{row.label}</h2>
              ) : (
                <ActivityLine
                  activity={row.activity}
                  earlier={row.earlier}
                  hideActor={hideActor}
                />
              )}
            </div>
          );
        })}
      </div>
      {feed.isFetchingNextPage && (
        <p {...stylex.props(styles.more)}>Loading older activity…</p>
      )}
      {!feed.hasNextPage && rows.length > 20 && (
        <p {...stylex.props(styles.more)}>That’s the beginning.</p>
      )}
    </div>
  );
}

function dayAbove(
  rows: Row[],
  items: { index: number; start: number; end: number }[],
  offset: number
) {
  const first = items.find((item) => item.end > offset + 1);
  if (
    !first ||
    first.start >= offset - 1 ||
    rows[first.index]?.kind === "day"
  ) {
    return null;
  }
  for (let i = first.index; i >= 0; i -= 1) {
    const row = rows[i];
    if (row?.kind === "day") {
      return row.label;
    }
  }
  return null;
}

const styles = stylex.create({
  pad: {
    padding: space.x3,
    maxWidth: 820,
    marginInline: "auto",
    width: "100%",
  },
  scroll: {
    position: "relative",
    flexGrow: 1,
    minHeight: 0,
    overflowY: "auto",
  },
  fresh: {
    position: "sticky",
    top: space.md,
    zIndex: 3,
    display: "flex",
    alignItems: "center",
    gap: space.xs,
    marginInline: "auto",
    marginBottom: -32,
    height: 30,
    paddingInline: space.lg,
    borderRadius: radius.full,
    fontSize: text.meta,
    fontWeight: 600,
    color: color.fgOnSolid,
    backgroundColor: color.accent,
    boxShadow: shadow.float,
  },
  pinned: {
    position: "sticky",
    top: 0,
    zIndex: 2,
    height: 0,
    maxWidth: 820,
    marginInline: "auto",
    width: "100%",
    paddingInline: space.x3,
  },
  pinnedDay: {
    paddingTop: space.md,
    backgroundColor: color.bg,
  },
  header: {
    maxWidth: 820,
    marginInline: "auto",
    width: "100%",
    paddingInline: space.x3,
  },
  inner: {
    position: "relative",
    maxWidth: 820,
    marginInline: "auto",
    width: "100%",
  },
  height: (height: number) => ({ height }),
  offset: (y: number) => ({ transform: `translateY(${y}px)` }),
  row: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    paddingInline: space.x3,
  },
  day: {
    paddingTop: space.xl,
    paddingBottom: space.sm,
    fontSize: text.meta,
    fontWeight: 600,
    color: color.fgMuted,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
  },
  more: {
    paddingBlock: space.xl,
    textAlign: "center",
    fontSize: text.meta,
    color: color.fgFaint,
  },
});
