import type { Schemas } from "#api/client";
import { clip } from "#lib/text";
import { agoPhrase, upcoming } from "#lib/time";
import type { Tone } from "#ui/chip";

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

const STATUS: Record<string, { label: string; tone: Tone }> = {
  delivered: { label: "Delivered", tone: "green" },
  quiet: { label: "Nothing to say", tone: "neutral" },
  skipped: { label: "Skipped", tone: "neutral" },
  failed: { label: "Failed", tone: "red" },
};

export function statusOf(status: string) {
  return STATUS[status] ?? { label: status, tone: "neutral" as Tone };
}

/** When a routine next does something: running, off, due, or when it next runs. */
export function routineWhen(a: Automation, running: boolean) {
  const schedule = `${KINDS[a.kind]} · ${describeSchedule(a.schedule)}`;
  if (running) {
    return `${schedule} · running now`;
  }
  if (!a.enabled) {
    return `${schedule} · off`;
  }
  if (a.nextRunAt === null) {
    return schedule;
  }
  // Past due means the scheduler hasn't reached it yet; it runs on its next pass.
  return Date.parse(a.nextRunAt) <= Date.now()
    ? `${schedule} · due now`
    : `${schedule} · next ${upcoming(a.nextRunAt)}`;
}

/** What a routine last came to: failures first, since those need someone; otherwise what it said. */
export function routineLast(
  a: Automation
): { text: string; failing: boolean } | null {
  if (a.failureCount > 0) {
    return {
      text:
        a.failureCount === 1
          ? "Failed last time"
          : `Failed ${a.failureCount} times in a row`,
      failing: true,
    };
  }
  if (!a.lastResult) {
    return null;
  }
  const said =
    a.lastResult.status === "quiet"
      ? "Had nothing worth saying"
      : clip(a.lastResult.summary, 120);
  return { text: `${said} · ${agoPhrase(a.lastResult.at)}`, failing: false };
}
