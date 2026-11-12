import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { ComponentProps } from "react";

import { VisuallyHidden } from "#ui/feedback";
import { Tooltip } from "#ui/overlay";
import { color, space, text } from "#ui/tokens.stylex";

const DAY_MS = 86_400_000;

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const monthFormat = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  timeZone: "UTC",
});

type Day = { count: number; at: Date; weekday: number };

type Props = {
  /** Oldest first, today last. */
  counts: number[];
  /** Their today, as YYYY-MM-DD. */
  today: string;
  workdays: number[];
  name: string;
};

/** Two weeks as a row of squares, today on the right: the list's glance at someone's rhythm. */
export function RhythmStrip({
  counts,
  today,
  workdays,
  scale,
  name,
}: Props & {
  /** The count that fills a square; shared across a list so rows compare. */
  scale: number;
}) {
  const days = daysOf(counts, today);
  const summary = summarize(days, name, "the last two weeks");
  return (
    <>
      <Tooltip label={summary}>
        <span aria-hidden {...stylex.props(styles.strip)}>
          {days.map((d) => (
            <Square
              key={d.at.getTime()}
              day={d}
              scale={scale}
              off={!workdays.includes(d.weekday)}
            />
          ))}
        </span>
      </Tooltip>
      <VisuallyHidden>{summary}</VisuallyHidden>
    </>
  );
}

/**
 * A quarter as a calendar: a column per week, a row per weekday, a square per day, darker the more
 * that happened. Days they don't work are hollow when empty, so a quiet weekend reads as one.
 */
export function RhythmCalendar({ counts, today, workdays, name }: Props) {
  const [picked, setPicked] = useState<number | null>(null);
  const days = daysOf(counts, today);
  const pickedDay = days.find((d) => d.at.getTime() === picked);
  const weeks = weeksOf(days);
  const scale = Math.max(1, ...counts);
  const summary = summarize(
    days,
    name,
    `the last ${Math.round(days.length / 7)} weeks`
  );
  return (
    <figure {...stylex.props(styles.figure)}>
      {/* Touch has no hover, so a tap names the day in the caption, where the tooltip can't reach.
          The calendar is hidden from assistive tech; the caption's summary speaks for it. */}
      <div
        aria-hidden
        onClick={(event) => {
          const at =
            event.target instanceof HTMLElement
              ? Number(event.target.dataset.at ?? Number.NaN)
              : Number.NaN;
          setPicked(Number.isNaN(at) || at === picked ? null : at);
        }}
        {...stylex.props(styles.calendar)}
      >
        <div {...stylex.props(styles.column)}>
          <span {...stylex.props(styles.month)} />
          {WEEKDAY_LABELS.map((label) => (
            <span key={label.key} {...stylex.props(styles.weekday)}>
              {label.text}
            </span>
          ))}
        </div>
        {weeks.map((week, w) => (
          <div key={week.key} {...stylex.props(styles.column)}>
            <span {...stylex.props(styles.month)}>{monthLabel(weeks, w)}</span>
            {week.days.map((d, row) =>
              d ? (
                <Tooltip key={d.at.getTime()} label={dayLabel(d)}>
                  <Square
                    day={d}
                    scale={scale}
                    off={!workdays.includes(d.weekday)}
                    large
                    picked={d.at.getTime() === picked}
                    data-at={d.at.getTime()}
                  />
                </Tooltip>
              ) : (
                <span
                  key={`${week.key}-${row}`}
                  {...stylex.props(styles.blank)}
                />
              )
            )}
          </div>
        ))}
      </div>
      <figcaption {...stylex.props(styles.caption)}>
        <span>{pickedDay ? dayLabel(pickedDay) : summary}</span>
        <span aria-hidden {...stylex.props(styles.legend)}>
          Less
          {LEVELS.map((level) => (
            <span
              key={level}
              {...stylex.props(styles.square, styles.squareLg, levels[level])}
            />
          ))}
          More
        </span>
      </figcaption>
    </figure>
  );
}

const LEVELS = ["l0", "l1", "l2", "l3", "l4"] as const;

// Monday first; GitHub labels every other row so the column stays narrow.
const WEEKDAY_LABELS = [
  { key: "mon", text: "Mon" },
  { key: "tue", text: "" },
  { key: "wed", text: "Wed" },
  { key: "thu", text: "" },
  { key: "fri", text: "Fri" },
  { key: "sat", text: "" },
  { key: "sun", text: "" },
];

// The rest are a tooltip trigger's handlers and ref; without them the tooltip never opens.
function Square({
  day,
  scale,
  off,
  large = false,
  picked = false,
  ...rest
}: {
  day: Day;
  scale: number;
  off: boolean;
  large?: boolean;
  picked?: boolean;
} & Omit<ComponentProps<"span">, "className" | "style">) {
  const level = levelOf(day.count, scale);
  return (
    <span
      {...rest}
      {...stylex.props(
        styles.square,
        large && styles.squareLg,
        levels[LEVELS[level] ?? "l0"],
        level === 0 && off && styles.off,
        picked && styles.picked
      )}
    />
  );
}

// Square roots keep one busy day from washing every other day out to the palest green.
function levelOf(count: number, scale: number) {
  if (count <= 0) {
    return 0;
  }
  return Math.min(4, Math.max(1, Math.ceil(Math.sqrt(count / scale) * 4)));
}

function daysOf(counts: number[], today: string): Day[] {
  const end = Date.parse(today);
  return counts.map((count, i) => {
    const at = new Date(end - (counts.length - 1 - i) * DAY_MS);
    return { count, at, weekday: at.getUTCDay() };
  });
}

/** Columns of Monday-first weeks; slots before the first day and after today stay empty. */
function weeksOf(days: Day[]) {
  const weeks: { key: number; days: (Day | null)[] }[] = [];
  for (const d of days) {
    const row = (d.weekday + 6) % 7;
    const monday = d.at.getTime() - row * DAY_MS;
    let week = weeks.at(-1);
    if (week?.key !== monday) {
      week = { key: monday, days: Array.from({ length: 7 }, () => null) };
      weeks.push(week);
    }
    week.days[row] = d;
  }
  return weeks;
}

/** A month's name over the first week that starts in it, as GitHub labels its calendar. */
function monthLabel(weeks: { key: number }[], index: number) {
  const week = weeks[index];
  if (!week) {
    return "";
  }
  const month = new Date(week.key).getUTCMonth();
  const previous = weeks[index - 1];
  if (previous && new Date(previous.key).getUTCMonth() === month) {
    return "";
  }
  // A month that ends within two columns of the start has no room for its name.
  const after = weeks[index + 2];
  if (index === 0 && after && new Date(after.key).getUTCMonth() !== month) {
    return "";
  }
  return monthFormat.format(new Date(week.key));
}

function dayLabel(d: Day) {
  const what =
    d.count === 0
      ? "Nothing"
      : `${d.count} ${d.count === 1 ? "thing" : "things"}`;
  return `${what} on ${dayFormat.format(d.at)}`;
}

function summarize(days: Day[], name: string, span: string) {
  let total = 0;
  let busiest: Day | undefined;
  for (const d of days) {
    total += d.count;
    if (d.count > (busiest?.count ?? 0)) {
      busiest = d;
    }
  }
  if (total === 0) {
    return `Nothing from ${name} in ${span}`;
  }
  const most =
    busiest && busiest.count < total
      ? `, most on ${dayFormat.format(busiest.at).replaceAll(" ", " ")}`
      : "";
  return `${total} ${total === 1 ? "thing" : "things"} in ${span}${most}`;
}

const styles = stylex.create({
  strip: { display: "inline-flex", gap: 2 },
  square: {
    display: "block",
    flexShrink: 0,
    width: 8,
    height: 8,
    borderRadius: 2,
  },
  squareLg: { width: 12, height: 12, borderRadius: 3 },
  off: {
    backgroundColor: "transparent",
    boxShadow: `inset 0 0 0 1px ${color.line}`,
  },
  picked: { outline: `2px solid ${color.focus}`, outlineOffset: 1 },
  blank: { display: "block", width: 12, height: 12 },
  figure: { display: "flex", flexDirection: "column", gap: space.md },
  calendar: { display: "flex", gap: 3 },
  column: { display: "flex", flexDirection: "column", gap: 3 },
  weekday: {
    height: 12,
    paddingRight: space.xxs,
    fontSize: 9,
    lineHeight: "12px",
    color: color.fgFaint,
  },
  month: {
    height: 12,
    width: 12,
    overflow: "visible",
    whiteSpace: "nowrap",
    fontSize: 9,
    lineHeight: "12px",
    color: color.fgMuted,
  },
  caption: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    fontSize: text.meta,
    color: color.fgMuted,
  },
  legend: {
    display: "flex",
    alignItems: "center",
    gap: 3,
    fontSize: 10,
    color: color.fgFaint,
  },
});

// OKLab, not OKLCH: mixing toward the warm neutral in polar space swings the pale greens to olive.
const levels = stylex.create({
  l0: { backgroundColor: color.ui, boxShadow: `inset 0 0 0 1px ${color.line}` },
  l1: {
    backgroundColor: `color-mix(in oklab, ${color.green} 30%, ${color.ui})`,
  },
  l2: {
    backgroundColor: `color-mix(in oklab, ${color.green} 55%, ${color.ui})`,
  },
  l3: {
    backgroundColor: `color-mix(in oklab, ${color.green} 78%, ${color.ui})`,
  },
  l4: { backgroundColor: color.green },
});
