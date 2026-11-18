import { useEffect, useState } from "react";

import type { Schemas } from "#api/client";

type Member = Schemas["Member"];

export type Clock = {
  time: string;
  /** The city of their time zone: "New York" for America/New_York. */
  place: string;
  zone: string;
  /** Null when they haven't said when they work. */
  inHours: boolean | null;
  /** When an off-hours person is next in, as a reader says it: "08:00", "tomorrow 08:00", "Mon 08:00". */
  back: string | null;
  /** 0 = Sunday, in their calendar. */
  weekday: number;
  /** Their today, as YYYY-MM-DD. */
  date: string;
  hours: { start: string; end: string } | null;
  workdays: number[];
};

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string) {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(zone, f);
  }
  return f;
}

/** Where a person's day stands right now, in their own time zone. Null without a valid zone. */
export function clockOf(member: Member, now: Date): Clock | null {
  const zone = member.timezone;
  if (!zone) {
    return null;
  }
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = formatter(zone).formatToParts(now);
  } catch {
    return null;
  }
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  const hour = part("hour") ?? "00";
  const minute = part("minute") ?? "00";
  const weekday = WEEKDAYS[part("weekday") ?? ""] ?? 0;
  const hours = member.settings.activeHours ?? null;
  const workdays = member.settings.workdays ?? EVERY_DAY;
  const time = `${hour}:${minute}`;
  const clock = {
    time,
    place: (zone.split("/").at(-1) ?? zone).replaceAll("_", " "),
    zone,
    weekday,
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hours,
    workdays,
  };
  if (!hours) {
    return { ...clock, inHours: null, back: null };
  }
  const inWindow =
    hours.start <= hours.end
      ? time >= hours.start && time < hours.end
      : time >= hours.start || time < hours.end;
  if (inWindow && workdays.includes(weekday)) {
    return { ...clock, inHours: true, back: null };
  }
  return {
    ...clock,
    inHours: false,
    back: nextStart(time, weekday, hours.start, workdays),
  };
}

function nextStart(
  time: string,
  weekday: number,
  start: string,
  workdays: number[]
) {
  if (workdays.includes(weekday) && time < start) {
    return start;
  }
  for (let ahead = 1; ahead <= 7; ahead += 1) {
    const day = (weekday + ahead) % 7;
    if (workdays.includes(day)) {
      return ahead === 1 ? `tomorrow ${start}` : `${DAY_NAMES[day]} ${start}`;
    }
  }
  return null;
}

/** The current time, ticking each minute so clocks on screen stay true. */
export function useMinute() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const at = new Date();
      setNow(at);
      timer = setTimeout(tick, 60_000 - (at.getTime() % 60_000) + 50);
    };
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    return () => clearTimeout(timer);
  }, []);
  return now;
}
