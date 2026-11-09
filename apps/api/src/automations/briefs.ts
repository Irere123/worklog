import { complete } from "#agent/generate";
import { renderMemory } from "#agent/memory";
import { audienceNote, CONSTITUTION, prompt } from "#agent/prompts";
import type { AppContext } from "#context";
import { listActivities } from "#db/queries/activities";
import { listOpenAttention } from "#db/queries/attention";
import { upsertBrief } from "#db/queries/briefs";
import type { BriefRow } from "#db/queries/briefs";
import { countCards } from "#db/queries/cards";
import { listMembers } from "#db/queries/members";
import type { Member } from "#db/queries/members";
import { getWorkspaceById } from "#db/queries/workspaces";
import type { Visibility } from "#db/schema";
import { generateId } from "#lib/ids";
import { plural } from "#lib/text";
import { localParts, startOfLocalDay, timezoneOf } from "#lib/time";
import { teamVisibleAttention } from "#work/attention";
import { listCards } from "#work/board";

export type Period = "daily" | "weekly";

export type BriefData = {
  period: Period;
  timezone: string;
  range: { start: string; end: string };
  you: { name: string; did: Item[] };
  needsAttention: {
    title: string;
    priority: string;
    kind: string;
    count: number;
    url: string | null;
  }[];
  inProgress: {
    number: number;
    title: string;
    column: string | null;
    golden: boolean;
    postponingSoon: boolean;
  }[];
  driftingSoon: { number: number; title: string; autoPostponeAt: string }[];
  team: { name: string; handle: string; kind: string; did: Item[] }[];
  board: { newInMaybe: number; closed: number };
};
type Item = {
  title: string;
  kind: string;
  source: string;
  detail: string | null;
  url: string | null;
  at: string;
};

const TEAM_PER_PERSON = 6;

// Daily briefs cover the previous workday, so a Monday brief includes Friday and the weekend; weekly briefs cover the last 7 days.
export function briefWindow(
  now: Date,
  timeZone: string,
  period: Period,
  workdays: number[] = [1, 2, 3, 4, 5]
) {
  const today = startOfLocalDay(now, timeZone);
  if (period === "weekly") {
    return { start: startOfLocalDay(now, timeZone, -7), end: now, key: today };
  }
  let back = 1;
  const { weekday } = localParts(now, timeZone);
  while (back < 7 && !workdays.includes((weekday - back + 7) % 7)) {
    back += 1;
  }
  return { start: startOfLocalDay(now, timeZone, -back), end: now, key: today };
}

// A team version leaves out private activity and the attention items private activity raised.
export async function gatherBriefData(
  ctx: AppContext,
  member: Member,
  period: Period,
  visibility: Visibility = "private"
): Promise<BriefData & { _key: Date }> {
  const ws = await getWorkspaceById(ctx.db, { id: member.workspaceId });
  const tz = timezoneOf(member, ws);
  const { start, end, key } = briefWindow(
    ctx.now(),
    tz,
    period,
    member.settings.workdays
  );

  const everything = visibility === "private";
  const [mine, everyone, open, myCards, people, triageCount, closedCount] =
    await Promise.all([
      listActivities(ctx.db, {
        workspaceId: member.workspaceId,
        privateFor: everything ? [member.id] : [],
        actorIds: [member.id],
        since: start,
        until: end,
        limit: 100,
      }),
      listActivities(ctx.db, {
        workspaceId: member.workspaceId,
        privateFor: [],
        since: start,
        until: end,
        limit: 400,
      }),
      listOpenAttention(ctx.db, {
        memberId: member.id,
        now: ctx.now(),
        limit: 30,
      }),
      listCards(ctx, member.workspaceId, { assigneeId: member.id, limit: 100 }),
      listMembers(ctx.db, {
        workspaceId: member.workspaceId,
        includeDeactivated: true,
      }).then((all) => all.filter((m) => m.id !== member.id)),
      countCards(ctx.db, {
        workspaceId: member.workspaceId,
        stage: "triage",
        createdSince: start,
      }),
      countCards(ctx.db, {
        workspaceId: member.workspaceId,
        stage: "done",
        closedSince: start,
      }),
    ]);
  const attention = everything ? open : await teamVisibleAttention(ctx, open);

  const item = (a: (typeof mine)[number]): Item => ({
    title: a.title,
    kind: a.kind,
    source: a.source,
    detail: a.body?.slice(0, 240) ?? null,
    url: a.url,
    at: a.occurredAt.toISOString(),
  });

  // Skip the personal assistants' own bookkeeping; keep humans and working agents.
  const team = people
    .filter((p) => p.agentProvider !== "worklog")
    .map((p) => ({
      name: p.name,
      handle: p.handle,
      kind: p.kind,
      // What mattered most first (merges, releases, decisions), not just what happened last.
      did: everyone
        .filter((a) => a.actorId === p.id)
        .toSorted(
          (a, b) =>
            b.importance - a.importance ||
            b.occurredAt.getTime() - a.occurredAt.getTime()
        )
        .slice(0, TEAM_PER_PERSON)
        .map(item),
    }))
    .filter((p) => p.did.length > 0);

  const active = myCards.filter(
    (c) => c.stage === "active" || c.stage === "triage"
  );
  return {
    _key: key,
    period,
    timezone: tz,
    range: { start: start.toISOString(), end: end.toISOString() },
    you: { name: member.name, did: mine.map(item) },
    needsAttention: attention.map((a) => ({
      title: a.title,
      priority: a.priority,
      kind: a.kind,
      count: a.count,
      url: a.url,
    })),
    inProgress: active.map((c) => ({
      number: c.number,
      title: c.title,
      column: c.stage === "triage" ? "Maybe?" : c.columnName,
      golden: c.golden,
      postponingSoon: c.entropy?.postponingSoon ?? false,
    })),
    driftingSoon: active.flatMap((c) =>
      c.entropy?.postponingSoon === true
        ? [
            {
              number: c.number,
              title: c.title,
              autoPostponeAt: c.entropy.autoPostponeAt.toISOString(),
            },
          ]
        : []
    ),
    team,
    board: { newInMaybe: triageCount, closed: closedCount },
  };
}

export async function composeBrief(
  ctx: AppContext,
  member: Member,
  data: BriefData,
  extraInstructions?: string | null,
  visibility: Visibility = "private"
) {
  const title = `${data.period === "daily" ? "Morning brief" : "Weekly wrap"} for ${member.name}`;
  if (!ctx.models) {
    return { title, body: templateBrief(data), composedBy: "template" };
  }
  const memory = await renderMemory(ctx, member.id, {
    includePrivate: visibility === "private",
    journalDays: 1,
  });
  const { text, modelId } = await complete(ctx.models, {
    model: "main",
    instructions: [
      CONSTITUTION,
      prompt("brief", {
        name: member.name,
        period: data.period,
        audience: audienceNote(visibility, member.name),
      }),
      extraInstructions
        ? `The reader's own preferences for this brief: ${extraInstructions}`
        : "",
    ],
    prompt: `What you know about ${member.name}:\n${memory}\n\nBrief data (JSON):\n${JSON.stringify(data)}`,
    timeout: "background",
  });
  return { title, body: text, composedBy: modelId };
}

// What goes to team-visible targets. Not saved: the member's brief is the private one.
export async function composeTeamBrief(
  ctx: AppContext,
  member: Member,
  period: Period,
  extraInstructions?: string | null
) {
  const { _key, ...data } = await gatherBriefData(ctx, member, period, "team");
  const { title, body } = await composeBrief(
    ctx,
    member,
    data,
    extraInstructions,
    "team"
  );
  return { title, body, data };
}

export function templateBrief(data: BriefData): string {
  const out: string[] = [];
  if (data.needsAttention.length) {
    out.push("## Needs your attention");
    for (const a of data.needsAttention.slice(0, 10)) {
      out.push(
        `- ${a.priority === "high" ? "**" : ""}${a.title}${a.priority === "high" ? "**" : ""}${a.count > 1 ? ` (×${a.count})` : ""}${a.url ? ` — ${a.url}` : ""}`
      );
    }
  }
  out.push("## You");
  if (data.you.did.length) {
    for (const line of collapse(data.you.did).slice(0, 12)) {
      out.push(`- ${line}`);
    }
  } else {
    out.push(
      "- Nothing recorded in this window. Log anything that happened off the radar with `POST /v1/logs`."
    );
  }
  if (data.inProgress.length) {
    out.push(
      "",
      `**In progress:** ${data.inProgress
        .map(
          (c) =>
            `#${c.number} ${c.title}${c.golden ? " ★" : ""} (${c.column ?? "?"})`
        )
        .join(", ")}`
    );
  }
  if (data.team.length) {
    out.push("## Team");
    for (const p of data.team) {
      out.push(
        `- **${p.name}**${p.kind === "agent" ? " (agent)" : ""}: ${[...new Set(p.did.map((d) => d.title))].join("; ")}`
      );
    }
  }
  if (data.driftingSoon.length || data.board.newInMaybe) {
    out.push("## Heads-up");
    for (const c of data.driftingSoon) {
      out.push(
        `- #${c.number} ${c.title} drifts to Not now on ${c.autoPostponeAt.slice(0, 10)} unless someone touches it`
      );
    }
    if (data.board.newInMaybe) {
      out.push(
        `- ${plural(data.board.newInMaybe, "new card")} waiting in Maybe?`
      );
    }
  }
  return out.join("\n");
}

// A card touched three times is one line with three changes, not three lines with one title.
function collapse(did: { title: string; detail: string | null }[]) {
  const byTitle = new Map<string, string[]>();
  for (const d of did) {
    const details = byTitle.get(d.title) ?? [];
    if (d.detail && d.detail !== d.title && !details.includes(d.detail)) {
      details.push(d.detail);
    }
    byTitle.set(d.title, details);
  }
  return [...byTitle].map(([title, details]) =>
    details.length ? `${title} — ${details.join(" · ")}` : title
  );
}

/** Nothing anyone did and nothing waiting: a brief would only say so, so a scheduled one stays quiet. */
export function isEmptyWindow(data: BriefData) {
  return (
    data.you.did.length === 0 &&
    data.needsAttention.length === 0 &&
    data.team.length === 0 &&
    data.driftingSoon.length === 0 &&
    data.board.newInMaybe === 0 &&
    data.board.closed === 0
  );
}

export async function generateBrief(
  ctx: AppContext,
  member: Member,
  period: Period,
  extraInstructions?: string | null
) {
  const { _key, ...data } = await gatherBriefData(ctx, member, period);
  return await saveBrief(ctx, member, _key, data, extraInstructions);
}

export async function saveBrief(
  ctx: AppContext,
  member: Member,
  key: Date,
  data: BriefData,
  extraInstructions?: string | null
) {
  const { period } = data;
  const { title, body, composedBy } = await composeBrief(
    ctx,
    member,
    data,
    extraInstructions
  );
  const row: BriefRow = {
    id: generateId(),
    workspaceId: member.workspaceId,
    memberId: member.id,
    period,
    periodStart: key,
    periodEnd: new Date(data.range.end),
    title,
    body,
    data,
    composedBy,
    createdAt: ctx.now(),
  };
  const saved = await upsertBrief(ctx.db, row);
  await ctx.bus.publish({
    workspaceId: member.workspaceId,
    audienceId: member.id,
    type: "brief.created",
    data: { id: saved.id, period, title },
  });
  return saved;
}
