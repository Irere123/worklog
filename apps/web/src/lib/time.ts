const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const exact = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});
const dayFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const shortDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});
const clock = new Intl.DateTimeFormat("en-GB", { timeStyle: "short" });

/** "now", "5m", "3h", "2d", then a date: compact enough for a meta line. */
export function ago(iso: string, now = Date.now()) {
  const ms = now - Date.parse(iso);
  if (ms < MINUTE) {
    return "now";
  }
  if (ms < HOUR) {
    return `${Math.floor(ms / MINUTE)}m`;
  }
  if (ms < DAY) {
    return `${Math.floor(ms / HOUR)}h`;
  }
  if (ms < 7 * DAY) {
    return `${Math.floor(ms / DAY)}d`;
  }
  return shortDate.format(new Date(iso));
}

/** "just now" or "5m ago": `ago` inside a sentence. */
export function agoPhrase(iso: string, now = Date.now()) {
  const short = ago(iso, now);
  if (short === "now") {
    return "just now";
  }
  return Date.parse(iso) < now - 7 * DAY ? `on ${short}` : `${short} ago`;
}

/** "in 3 hours", "yesterday": for sentences rather than meta lines. */
export function fromNow(iso: string, now = Date.now()) {
  const ms = Date.parse(iso) - now;
  const abs = Math.abs(ms);
  const count = ms < 0 ? Math.trunc : Math.round;
  if (abs < HOUR) {
    return relative.format(count(ms / MINUTE), "minute");
  }
  if (abs < DAY) {
    return relative.format(count(ms / HOUR), "hour");
  }
  return relative.format(count(ms / DAY), "day");
}

export const exactTime = (iso: string) => exact.format(new Date(iso));
export const clockTime = (iso: string) => clock.format(new Date(iso));
export const shortDay = (iso: string) => shortDate.format(new Date(iso));

/** "Today", "Yesterday", or "Monday 27 October": headings for day-grouped feeds. */
export function dayLabel(iso: string, now = new Date()) {
  const date = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);
  if (days === 0) {
    return "Today";
  }
  if (days === 1) {
    return "Yesterday";
  }
  return dayFormat.format(date);
}

/**
 * When something scheduled within the week happens: "at 08:30", "tomorrow at 08:30", "on Friday
 * at 16:00". A routine is set on its owner's clock, so pass their `timeZone`: the browser's can be
 * another, and "Weekdays at 08:30 · next at 07:30" reads as a bug.
 */
export function upcoming(iso: string, now = new Date(), timeZone?: string) {
  const date = new Date(iso);
  const at = `at ${zoned("clock", timeZone).format(date)}`;
  const days = daysApart(now, date, timeZone);
  if (days <= 0) {
    return at;
  }
  return days === 1
    ? `tomorrow ${at}`
    : `on ${zoned("weekday", timeZone).format(date)} ${at}`;
}

/** "12:30", "Tomorrow 02:00", "Mon 08:30", then a date: `upcoming` for a right-hand column. */
export function upcomingShort(
  iso: string,
  now = new Date(),
  timeZone?: string
) {
  const date = new Date(iso);
  const at = zoned("clock", timeZone).format(date);
  const days = daysApart(now, date, timeZone);
  if (days <= 0) {
    return at;
  }
  if (days === 1) {
    return `Tomorrow ${at}`;
  }
  return days < 7
    ? `${zoned("day", timeZone).format(date)} ${at}`
    : zoned("date", timeZone).format(date);
}

const ZONED = {
  clock: { timeStyle: "short" },
  weekday: { weekday: "long" },
  day: { weekday: "short" },
  date: { day: "numeric", month: "short" },
  key: { year: "numeric", month: "2-digit", day: "2-digit" },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

const zonedCache = new Map<string, Intl.DateTimeFormat>();

function zoned(kind: keyof typeof ZONED, timeZone: string | undefined) {
  const id = `${kind}|${timeZone ?? ""}`;
  let f = zonedCache.get(id);
  if (!f) {
    const locale = kind === "key" ? "en-CA" : "en-GB";
    try {
      f = new Intl.DateTimeFormat(locale, { ...ZONED[kind], timeZone });
    } catch {
      f = new Intl.DateTimeFormat(locale, ZONED[kind]);
    }
    zonedCache.set(id, f);
  }
  return f;
}

function daysApart(from: Date, to: Date, timeZone: string | undefined) {
  const day = (d: Date) => Date.parse(zoned("key", timeZone).format(d));
  return Math.round((day(to) - day(from)) / DAY);
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function greeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 5) {
    return "Working late";
  }
  if (hour < 12) {
    return "Good morning";
  }
  if (hour < 18) {
    return "Good afternoon";
  }
  return "Good evening";
}

/** Midnight at the start of yesterday, as an ISO string: the window the home page sums up. */
export function startOfYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * The start of the activity page's 24-hour ribbon ending at `end`, on a ten-minute boundary so
 * the key stays put between ticks and the route can ask for the same list before the page renders.
 */
export function ribbonSince(end: number) {
  const step = 10 * 60_000;
  return new Date(
    Math.floor((end - 24 * 3_600_000) / step) * step
  ).toISOString();
}

const monthFormat = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
});

/** "Today", "Yesterday", "Previous 7 days", "Previous 30 days", then the month: list groups. */
export function recencyLabel(iso: string, now = new Date()) {
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / DAY);
  if (days <= 0) {
    return "Today";
  }
  if (days === 1) {
    return "Yesterday";
  }
  if (days < 7) {
    return "Previous 7 days";
  }
  if (days < 30) {
    return "Previous 30 days";
  }
  return monthFormat.format(new Date(iso));
}

/** Whether `iso` is more than `ms` in the past. */
export function olderThan(iso: string, ms: number, now = Date.now()) {
  return now - Date.parse(iso) > ms;
}
