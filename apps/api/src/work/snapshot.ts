import type { AppContext } from "#context";
import { listActivities } from "#db/queries/activities";
import type { Member } from "#db/queries/members";
import { DAY_MS } from "#lib/time";

import { listCards } from "./board";

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

/** One line per card, as the app shows it: "Added this card · Marked done", not two entries. */
function foldRuns(recent: WorkSnapshot["recent"]) {
  const runs: { title: string; details: string[] }[] = [];
  for (const a of recent) {
    const detail = a.detail?.split("\n")[0]?.trim();
    const run = runs.find((r) => r.title === a.title);
    if (run) {
      // Newest first, so an earlier step goes in front of what followed it.
      if (detail && !run.details.includes(detail)) {
        run.details.unshift(detail);
      }
    } else {
      runs.push({ title: a.title, details: detail ? [detail] : [] });
    }
  }
  return runs;
}
