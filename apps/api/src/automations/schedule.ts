import type { MemberSettings, Schedule } from "../db/schema";
import { isWithinHours, localParts, parseHHMM, zonedToUtc } from "../lib/time";

// Strictly after `after`, on the member's local clock.
export function nextRun(
  schedule: Schedule,
  timeZone: string,
  after: Date,
  settings: MemberSettings = {},
  jitterMs = 0
): Date {
  if (schedule.type === "interval") {
    let next = new Date(after.getTime() + schedule.minutes * 60_000);
    if (schedule.activeHoursOnly === true && settings.activeHours) {
      next = nextActive(next, timeZone, settings);
    }
    return next;
  }
  const { hour, minute } = parseHHMM(schedule.at);
  const allowed =
    schedule.type === "weekly"
      ? [schedule.weekday]
      : (schedule.weekdays ?? [0, 1, 2, 3, 4, 5, 6]);
  const start = localParts(after, timeZone);
  for (let d = 0; d <= 8; d += 1) {
    const day = new Date(Date.UTC(start.year, start.month - 1, start.day + d));
    if (!allowed.includes(day.getUTCDay())) {
      continue;
    }
    const candidate = new Date(
      zonedToUtc(
        day.getUTCFullYear(),
        day.getUTCMonth() + 1,
        day.getUTCDate(),
        hour,
        minute,
        timeZone
      ).getTime() + jitterMs
    );
    if (candidate > after) {
      return candidate;
    }
  }
  throw new Error("Schedule never fires");
}

export function nextActive(
  date: Date,
  timeZone: string,
  settings: MemberSettings
): Date {
  const hours = settings.activeHours;
  if (!hours) {
    return date;
  }
  const workdays = settings.workdays ?? [0, 1, 2, 3, 4, 5, 6];
  if (
    isWithinHours(date, timeZone, hours) &&
    workdays.includes(localParts(date, timeZone).weekday)
  ) {
    return date;
  }
  const { hour, minute } = parseHHMM(hours.start);
  const p = localParts(date, timeZone);
  for (let d = 0; d <= 8; d += 1) {
    const day = new Date(Date.UTC(p.year, p.month - 1, p.day + d));
    if (!workdays.includes(day.getUTCDay())) {
      continue;
    }
    const candidate = zonedToUtc(
      day.getUTCFullYear(),
      day.getUTCMonth() + 1,
      day.getUTCDate(),
      hour,
      minute,
      timeZone
    );
    if (candidate > date) {
      return candidate;
    }
  }
  return date;
}

export function isActiveNow(
  now: Date,
  timeZone: string,
  settings: MemberSettings
): boolean {
  return nextActive(now, timeZone, settings).getTime() === now.getTime();
}

const UINT32 = 2 ** 32;

export function jitterFor(id: string, maxMs = 120_000): number {
  let h = 0;
  for (const ch of id) {
    h = (h * 31 + (ch.codePointAt(0) ?? 0)) % UINT32;
  }
  return h % maxMs;
}
