import type { AppContext } from "#context";
import {
  countActivitiesByActorHour,
  listActivities,
  listAgentStates,
  listRunsInPlay,
  listLatestByActor,
} from "#db/queries/activities";
import { listCurrentCards } from "#db/queries/cards";
import { listMembers } from "#db/queries/members";
import type { Member } from "#db/queries/members";
import { getWorkspaceById } from "#db/queries/workspaces";
import { DAY_MS, isValidTimeZone, localDate, timezoneOf } from "#lib/time";

import { listCards } from "./board";

export const RHYTHM_DAYS = 14;

/** Thirteen weeks: a quarter, which fits a profile's column as a calendar of days. */
export const PROFILE_RHYTHM_DAYS = 91;

export async function workSnapshot(
  ctx: AppContext,
  person: Member,
  opts: { includePrivate: boolean; days?: number }
) {
  const days = opts.days ?? 7;
  const [assigned, recent] = await Promise.all([
    listCards(ctx, person.workspaceId, { assigneeId: person.id, limit: 100 }),
    listActivities(ctx.db, {
      workspaceId: person.workspaceId,
      privateFor: opts.includePrivate ? [person.id] : [],
      actorIds: [person.id],
      since: new Date(ctx.now().getTime() - days * DAY_MS),
      limit: 40,
    }),
  ]);
  return {
    person: {
      id: person.id,
      name: person.name,
      handle: person.handle,
      kind: person.kind,
      title: person.title,
    },
    inProgress: assigned
      .filter((c) => c.stage === "active")
      .map((c) => ({
        number: c.number,
        title: c.title,
        column: c.columnName,
        golden: c.golden,
        lastActiveAt: c.lastActiveAt.toISOString(),
      })),
    upNext: assigned
      .filter((c) => c.stage === "triage")
      .map((c) => ({ number: c.number, title: c.title })),
    recent: recent.map((a) => ({
      at: a.occurredAt.toISOString(),
      kind: a.kind,
      source: a.source,
      title: a.title,
      detail: a.body?.slice(0, 300) ?? null,
      url: a.url,
    })),
    lastActiveAt: recent[0]?.occurredAt.toISOString() ?? null,
  };
}

export type WorkSnapshot = Awaited<ReturnType<typeof workSnapshot>>;

/**
 * One person's page: their snapshot and a quarter of daily activity. The rhythm stays out of
 * `workSnapshot`, which the assistant reads, where 91 numbers would only be noise.
 */
export async function memberNow(
  ctx: AppContext,
  asker: Member,
  person: Member,
  opts: { days?: number }
) {
  const includePrivate = person.id === asker.id;
  const snapshot = await workSnapshot(ctx, person, { ...opts, includePrivate });
  const rhythms = await rhythmsOf(ctx, {
    workspaceId: person.workspaceId,
    privateFor: includePrivate ? [person.id] : [],
    days: PROFILE_RHYTHM_DAYS,
    actorIds: [person.id],
  });
  return {
    ...snapshot,
    rhythm: rhythms.get(person.id) ?? emptyRhythm(PROFILE_RHYTHM_DAYS),
  };
}

/**
 * Everyone at a glance, as Home and People show them: each member's current card, the latest
 * thing they did and how much they did each day lately. Built from a few queries for the whole
 * workspace. The asker's own private entries count for them; everyone else's stay out.
 */
export async function teamNow(
  ctx: AppContext,
  asker: Member,
  opts: { days?: number } = {}
) {
  const days = opts.days ?? 7;
  const current = await listCurrentCards(ctx.db, {
    workspaceId: asker.workspaceId,
  });
  const latest = await listLatestByActor(ctx.db, {
    workspaceId: asker.workspaceId,
    privateFor: [asker.id],
    since: new Date(ctx.now().getTime() - days * DAY_MS),
  });
  const agents = await listAgentStates(ctx.db, {
    workspaceId: asker.workspaceId,
    since: new Date(ctx.now().getTime() - days * DAY_MS),
  });
  const inPlay = await listRunsInPlay(ctx.db, {
    workspaceId: asker.workspaceId,
    since: new Date(ctx.now().getTime() - days * DAY_MS),
  });
  const rhythms = await rhythmsOf(ctx, {
    workspaceId: asker.workspaceId,
    privateFor: [asker.id],
    days: RHYTHM_DAYS,
  });
  const ids = new Set([
    ...current.map((c) => c.memberId),
    ...latest.flatMap((l) => (l.actorId ? [l.actorId] : [])),
    ...rhythms.keys(),
  ]);
  return [...ids].map((memberId) => {
    const card = current.find((c) => c.memberId === memberId);
    const last = latest.find((l) => l.actorId === memberId);
    const latestRun = agents.find((a) => a.actorId === memberId);
    const runs = inPlay
      .filter((r) => r.actorId === memberId)
      .flatMap(asRun)
      .toSorted(waitingFirst);
    return {
      memberId,
      current: card
        ? {
            number: card.number,
            title: card.title,
            column: card.column,
            golden: card.golden,
          }
        : null,
      latest: last
        ? {
            at: last.at.toISOString(),
            kind: last.kind,
            source: last.source,
            title: last.title,
          }
        : null,
      agent:
        runs.find((r) => r.state === "needs_you") ??
        (latestRun ? (asRun(latestRun)[0] ?? null) : null),
      runs,
      lastActiveAt: last?.at.toISOString() ?? null,
      rhythm: rhythms.get(memberId) ?? emptyRhythm(RHYTHM_DAYS),
    };
  });
}

type RunRow = Awaited<ReturnType<typeof listRunsInPlay>>[number];

function asRun(row: RunRow) {
  if (row.state === null) {
    return [];
  }
  const answered =
    row.state === "needs_you" &&
    row.asked !== null &&
    row.asked !== "open" &&
    row.asked !== "snoozed";
  return [
    {
      state: answered ? ("working" as const) : row.state,
      title: row.title,
      at: row.at.toISOString(),
      cardNumber: row.cardNumber,
    },
  ];
}

function waitingFirst(
  a: { state: string; at: string },
  b: { state: string; at: string }
) {
  return (
    Number(b.state === "needs_you") - Number(a.state === "needs_you") ||
    b.at.localeCompare(a.at)
  );
}

async function rhythmsOf(
  ctx: AppContext,
  params: {
    workspaceId: string;
    privateFor: string[];
    days: number;
    actorIds?: string[];
  }
) {
  const { workspaceId, days } = params;
  const now = ctx.now();
  const hours = await countActivitiesByActorHour(ctx.db, {
    workspaceId,
    privateFor: params.privateFor,
    actorIds: params.actorIds,
    since: new Date(now.getTime() - (days + 1) * DAY_MS),
  });
  if (hours.length === 0) {
    return new Map<string, number[]>();
  }
  const workspace = await getWorkspaceById(ctx.db, { id: workspaceId });
  const people = await listMembers(ctx.db, {
    workspaceId,
    includeDeactivated: true,
  });
  const zones = new Map(
    people.map((m) => {
      const zone = timezoneOf(m, workspace);
      return [m.id, isValidTimeZone(zone) ? zone : workspace.timezone];
    })
  );
  const rhythms = new Map<string, number[]>();
  for (const row of hours) {
    if (!row.actorId) {
      continue;
    }
    const zone = zones.get(row.actorId) ?? workspace.timezone;
    const back = daysBetween(
      localDate(new Date(row.hour), zone),
      localDate(now, zone)
    );
    if (back < 0 || back >= days) {
      continue;
    }
    const counts = rhythms.get(row.actorId) ?? emptyRhythm(days);
    const at = days - 1 - back;
    counts[at] = (counts[at] ?? 0) + row.count;
    rhythms.set(row.actorId, counts);
  }
  return rhythms;
}

function emptyRhythm(days: number) {
  return Array.from({ length: days }, () => 0);
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

export function renderSnapshot(s: WorkSnapshot): string {
  const lines = [
    `*${s.person.name}* (@${s.person.handle}${s.person.kind === "agent" ? ", agent" : ""})`,
  ];
  if (s.inProgress.length) {
    lines.push("In progress:");
    for (const c of s.inProgress) {
      lines.push(
        `• #${c.number} ${c.title}${c.golden ? " ★" : ""}${c.column ? ` — ${c.column}` : ""}`
      );
    }
  } else {
    lines.push("No cards in progress.");
  }
  if (s.recent.length) {
    lines.push("Recently:");
    for (const run of foldRuns(s.recent).slice(0, 6)) {
      lines.push(
        `• ${run.title}${run.details.length ? ` — ${run.details.join(" · ")}` : ""}`
      );
    }
  }
  return lines.join("\n");
}

function foldRuns(recent: WorkSnapshot["recent"]) {
  const runs: { title: string; details: string[] }[] = [];
  for (const a of recent) {
    const detail = a.detail?.split("\n")[0]?.trim();
    const run = runs.find((r) => r.title === a.title);
    if (run) {
      if (detail && !run.details.includes(detail)) {
        run.details.unshift(detail);
      }
    } else {
      runs.push({ title: a.title, details: detail ? [detail] : [] });
    }
  }
  return runs;
}
