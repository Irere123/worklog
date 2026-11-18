import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { useState } from "react";

import { Popover } from "./overlay";
import { color, font, media, radius, space, text } from "./tokens.stylex";

/**
 * A day picker in a popover. The browser's date input opens a different calendar on every OS,
 * can't offer "Tomorrow", and shows "mm/dd/yyyy" in an empty field.
 */
export function DatePicker({
  value,
  onChange,
  trigger,
}: {
  value: string | null;
  onChange: (day: string) => void;
  trigger: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const pick = (day: string) => {
    onChange(day);
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      sx={styles.popover}
    >
      <div {...stylex.props(styles.quick)}>
        {quickPicks().map(([label, day]) => (
          <button
            key={label}
            type="button"
            onClick={() => pick(day)}
            {...stylex.props(styles.quickPick)}
          >
            {label}
            <span {...stylex.props(styles.quickDay)}>{short(day)}</span>
          </button>
        ))}
      </div>
      <Month key={open ? "open" : "closed"} value={value} onPick={pick} />
    </Popover>
  );
}

/** Today in the viewer's own time zone; toISOString() would give UTC's, a day off near midnight. */
export function localDay(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(day: string, n: number) {
  const date = parse(day);
  date.setDate(date.getDate() + n);
  return localDay(date);
}

function Month({
  value,
  onPick,
}: {
  value: string | null;
  onPick: (day: string) => void;
}) {
  const today = localDay();
  const [shown, setShown] = useState(() => (value ?? today).slice(0, 7));
  const first = parse(`${shown}-01`);
  const lead = (first.getDay() + 6) % 7;
  const start = addDays(`${shown}-01`, -lead);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const weeks = days.at(35)?.startsWith(shown) === true ? 6 : 5;
  const move = (n: number) => {
    const next = parse(`${shown}-01`);
    next.setMonth(next.getMonth() + n);
    setShown(localDay(next).slice(0, 7));
  };
  return (
    <div {...stylex.props(styles.month)}>
      <div {...stylex.props(styles.head)}>
        <span {...stylex.props(styles.title)}>{monthName.format(first)}</span>
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => move(-1)}
          {...stylex.props(styles.nav)}
        >
          <CaretLeftIcon size={13} />
        </button>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => move(1)}
          {...stylex.props(styles.nav)}
        >
          <CaretRightIcon size={13} />
        </button>
      </div>
      <table {...stylex.props(styles.grid)}>
        <thead>
          <tr>
            {WEEKDAYS.map((d) => (
              <th
                key={d}
                scope="col"
                abbr={d}
                {...stylex.props(styles.weekday)}
              >
                {d.slice(0, 2)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: weeks }, (_, w) => (
            <tr key={w}>
              {days.slice(w * 7, w * 7 + 7).map((day) => (
                <td key={day} {...stylex.props(styles.cell)}>
                  <button
                    type="button"
                    aria-pressed={day === value}
                    aria-label={full.format(parse(day))}
                    onClick={() => onPick(day)}
                    {...stylex.props(
                      styles.day,
                      !day.startsWith(shown) && styles.outside,
                      day < today && styles.past,
                      day === today && styles.today,
                      day === value && styles.on
                    )}
                  >
                    {Number(day.slice(8))}
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function quickPicks(): [string, string][] {
  const today = localDay();
  const weekday = parse(today).getDay();
  const monday = addDays(today, (8 - weekday) % 7 || 7);
  const tomorrow = addDays(today, 1);
  return [
    ["Today", today],
    ["Tomorrow", tomorrow],
    monday === tomorrow
      ? ["Next week", addDays(today, 8)]
      : ["Next Monday", monday],
    ["In two weeks", addDays(today, 14)],
  ];
}

function parse(day: string) {
  return new Date(`${day}T00:00:00`);
}

function short(day: string) {
  const date = parse(day);
  return `${weekdayName.format(date)} ${date.getDate()}`;
}

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const monthName = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});
const weekdayName = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const full = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });

const styles = stylex.create({
  popover: { padding: 0, width: 260 },
  quick: {
    display: "flex",
    flexDirection: "column",
    padding: space.xs,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
  },
  quickPick: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: 30,
    paddingInline: space.md,
    borderRadius: radius.xs,
    fontSize: text.label,
    color: color.fg,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.uiHover },
      ":focus-visible": color.uiHover,
    },
    outline: "none",
  },
  quickDay: { fontSize: text.meta, color: color.fgFaint },
  month: { padding: space.md },
  head: {
    display: "flex",
    alignItems: "center",
    gap: space.xxs,
    marginBottom: space.sm,
    paddingInlineStart: space.xs,
  },
  title: {
    flexGrow: 1,
    fontSize: text.label,
    fontWeight: 600,
    color: color.fg,
  },
  nav: {
    display: "grid",
    placeItems: "center",
    width: 26,
    height: 26,
    borderRadius: radius.xs,
    color: color.fgMuted,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.uiHover },
    },
  },
  grid: { width: "100%", borderCollapse: "collapse" },
  cell: { padding: 0, textAlign: "center" },
  weekday: {
    height: 24,
    lineHeight: "24px",
    fontSize: text.caption,
    fontWeight: 500,
    color: color.fgFaint,
  },
  day: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    fontFamily: font.sans,
    fontSize: text.label,
    fontVariantNumeric: "tabular-nums",
    color: color.fg,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.uiHover },
    },
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
    outlineOffset: -2,
  },
  outside: { color: color.fgFaint },
  past: { color: color.fgFaint },
  today: {
    fontWeight: 600,
    color: color.accentFg,
    boxShadow: `inset 0 0 0 1px ${color.accent}`,
  },
  on: {
    fontWeight: 600,
    color: color.fgOnSolid,
    backgroundColor: {
      default: color.accent,
      ":hover": { default: null, [media.hover]: color.accent },
    },
  },
});
