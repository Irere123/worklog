import type { Schemas } from "#api/client";
import { agoPhrase, upcomingShort } from "#lib/time";
import type { Status, Tone } from "#ui/chip";

type Automation = Schemas["Automation"];
type Schedule = Automation["schedule"];
type Kind = Automation["kind"];

// How routines read in a person's words, wherever they're listed: one place to change it.

export const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function describeSchedule(s: Schedule) {
  if (s.type === "daily") {
    return `${daysPhrase(s.weekdays)} at ${s.at}`;
  }
  if (s.type === "weekly") {
    return `${DAYS[s.weekday]}s at ${s.at}`;
  }
  return `Every ${s.minutes >= 60 ? `${s.minutes / 60} h` : `${s.minutes} min`}${s.activeHoursOnly === true ? " during working hours" : ""}`;
}

function daysPhrase(weekdays: number[] | undefined) {
  const days = (weekdays ?? [0, 1, 2, 3, 4, 5, 6])
    .toSorted((a, b) => a - b)
    .join(",");
  const named: Record<string, string> = {
    "0,1,2,3,4,5,6": "Every day",
    "1,2,3,4,5": "Weekdays",
    "0,6": "Weekends",
  };
  return (
    named[days] ?? (weekdays ?? []).map((d) => DAYS[d]?.slice(0, 3)).join(", ")
  );
}

export const KINDS: Record<Kind, string> = {
  "brief.daily": "Daily brief",
  "brief.weekly": "Weekly brief",
  digest: "Digest of held items",
  check: "Check-in",
  consolidate: "Memory tidy-up",
  custom: "Custom routine",
};

type Look = { label: string; tone: Tone; status: Status };

const STATUS: Record<string, Look> = {
  delivered: { label: "Delivered", tone: "green", status: "done" },
  quiet: { label: "Nothing to say", tone: "neutral", status: "skipped" },
  skipped: { label: "Skipped", tone: "neutral", status: "skipped" },
  failed: { label: "Failed", tone: "red", status: "failed" },
};

export function statusOf(status: string): Look {
  return STATUS[status] ?? { label: status, tone: "neutral", status: "idle" };
}

/** Where a routine stands, for the right of its row: what needs someone comes before the clock. */
export type RoutineState =
  | { kind: "running" }
  | { kind: "failing"; label: string }
  | { kind: "paused" }
  | { kind: "next"; label: string }
  | { kind: "unscheduled" };

export function routineState(
  a: Automation,
  running: boolean,
  timeZone?: string
): RoutineState {
  if (running) {
    return { kind: "running" };
  }
  if (a.failureCount > 0) {
    return {
      kind: "failing",
      label: a.failureCount === 1 ? "Failed" : `Failed ${a.failureCount} times`,
    };
  }
  if (!a.enabled) {
    return { kind: "paused" };
  }
  if (a.nextRunAt === null) {
    return { kind: "unscheduled" };
  }
  // Past due means the scheduler hasn't reached it yet; it runs on its next pass.
  return {
    kind: "next",
    label:
      Date.parse(a.nextRunAt) <= Date.now()
        ? "Due now"
        : upcomingShort(a.nextRunAt, new Date(), timeZone),
  };
}

/**
 * How it went last time, in a few words: enough to trust it ran. What it said is in the thread it
 * sent to, so the row doesn't repeat it.
 */
export function routineLast(a: Automation): string | null {
  if (!a.lastResult || a.failureCount > 0) {
    return null;
  }
  const at = agoPhrase(a.lastResult.at);
  const said: Record<string, string> = {
    delivered: `sent ${at}`,
    quiet: `nothing to say ${at}`,
    skipped: `skipped ${at}`,
  };
  return said[a.lastResult.status] ?? null;
}
