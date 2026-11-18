export type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function isValidTimeZone(tz: string) {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

export function localParts(date: Date, timeZone: string) {
  const parts: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(date)) {
    parts[p.type] = p.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: weekdayNumber(parts.weekday),
  };
}

function weekdayNumber(name: string | undefined) {
  const weekday = name === undefined ? undefined : WEEKDAYS[name];
  if (weekday === undefined) {
    throw new Error(`Unexpected weekday "${name}" from Intl`);
  }
  return weekday;
}

export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
) {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let i = 0; i < 2; i += 1) {
    const p = localParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += target - asUtc;
  }
  return new Date(guess);
}

export function parseHHMM(value: string) {
  const m = /^(?<hour>\d{1,2}):(?<minute>\d{2})$/u.exec(value);
  if (!m?.groups) {
    throw new Error(`Invalid time "${value}", expected HH:MM`);
  }
  return { hour: Number(m.groups.hour), minute: Number(m.groups.minute) };
}

export function startOfLocalDay(date: Date, timeZone: string, offsetDays = 0) {
  const p = localParts(date, timeZone);
  const base = new Date(Date.UTC(p.year, p.month - 1, p.day + offsetDays));
  return zonedToUtc(
    base.getUTCFullYear(),
    base.getUTCMonth() + 1,
    base.getUTCDate(),
    0,
    0,
    timeZone
  );
}

export function startOfLocalDate(
  day: string,
  timeZone: string,
  offsetDays = 0
) {
  const m = /^(?<y>\d{4})-(?<m>\d{2})-(?<d>\d{2})$/u.exec(day);
  const base = m?.groups
    ? new Date(
        Date.UTC(
          Number(m.groups.y),
          Number(m.groups.m) - 1,
          Number(m.groups.d) + offsetDays
        )
      )
    : undefined;
  return base === undefined || Number.isNaN(base.getTime())
    ? undefined
    : zonedToUtc(
        base.getUTCFullYear(),
        base.getUTCMonth() + 1,
        base.getUTCDate(),
        0,
        0,
        timeZone
      );
}

export function startOfLocalMinute(value: string, timeZone: string) {
  const m = /^(?<day>\d{4}-\d{2}-\d{2})[T ](?<time>\d{2}:\d{2})$/u.exec(
    value.trim()
  );
  const midnight = m?.groups?.day
    ? startOfLocalDate(m.groups.day, timeZone)
    : undefined;
  const time = m?.groups?.time ? parseHHMM(m.groups.time) : undefined;
  const p = midnight ? localParts(midnight, timeZone) : undefined;
  return p && time && time.hour <= 23 && time.minute <= 59
    ? zonedToUtc(p.year, p.month, p.day, time.hour, time.minute, timeZone)
    : undefined;
}

export function localDate(date: Date, timeZone: string) {
  const p = localParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function lastLocalDate(expiresAt: Date, timeZone: string) {
  return localDate(new Date(expiresAt.getTime() - 1), timeZone);
}

export function isWithinHours(
  date: Date,
  timeZone: string,
  hours: { start: string; end: string }
) {
  const p = localParts(date, timeZone);
  const now = p.hour * 60 + p.minute;
  const s = parseHHMM(hours.start);
  const e = parseHHMM(hours.end);
  const start = s.hour * 60 + s.minute;
  const end = e.hour * 60 + e.minute;
  return start <= end ? now >= start && now < end : now >= start || now < end;
}

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export function timezoneOf(
  member: { timezone: string | null },
  workspace: { timezone: string }
) {
  return member.timezone ?? workspace.timezone;
}
