import { generateText } from "ai";
import { and, desc, eq, gte, ne } from "drizzle-orm";

import { listActivities } from "../activity/service";
import { TIMEOUTS } from "../agent/models";
import { UNTRUSTED_NOTE } from "../agent/prompts";
import { listOpenAttention } from "../attention/service";
import { listCards } from "../board/service";
import type { AppContext } from "../context";
import { briefs, cards, members } from "../db/schema";
import { returned } from "../lib/assert";
import { newId } from "../lib/ids";
import { localParts, startOfLocalDay } from "../lib/time";
import { getWorkspace, timezoneOf } from "../members/service";
import type { Member } from "../members/service";
import { renderMemory } from "../memory/service";

export type Period = "daily" | "weekly";
export type BriefRow = typeof briefs.$inferSelect;

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

export async function gatherBriefData(
  ctx: AppContext,
  member: Member,
  period: Period
): Promise<BriefData & { _key: Date }> {
  const ws = await getWorkspace(ctx, member.workspaceId);
  const tz = timezoneOf(member, ws);
  const { start, end, key } = briefWindow(
    ctx.now(),
    tz,
    period,
    member.settings.workdays
  );

  const [mine, everyone, attention, myCards, people, triageCount, closedCount] =
    await Promise.all([
      listActivities(ctx, member.workspaceId, [member.id], {
        actorIds: [member.id],
        since: start,
        until: end,
        limit: 100,
      }),
      listActivities(ctx, member.workspaceId, [], {
        since: start,
        until: end,
        limit: 400,
      }),
      listOpenAttention(ctx, member.id, 30),
      listCards(ctx, member.workspaceId, { assigneeId: member.id, limit: 100 }),
      ctx.db
        .select()
        .from(members)
        .where(
          and(
            eq(members.workspaceId, member.workspaceId),
            ne(members.id, member.id)
          )
        ),
      ctx.db
        .select({ id: cards.id })
        .from(cards)
        .where(
          and(
            eq(cards.workspaceId, member.workspaceId),
            eq(cards.stage, "triage"),
            gte(cards.createdAt, start)
          )
        ),
      ctx.db
        .select({ id: cards.id })
        .from(cards)
        .where(
          and(
            eq(cards.workspaceId, member.workspaceId),
            eq(cards.stage, "done"),
            gte(cards.closedAt, start)
          )
        ),
    ]);

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
    board: { newInMaybe: triageCount.length, closed: closedCount.length },
  };
}

const BRIEF_INSTRUCTIONS = `You write Worklog briefs: short, skimmable updates a person reads before stand-up (daily) or at the end of the week (weekly).

Write GitHub-flavoured markdown with these sections, omitting any that would be empty:
## Needs your attention — the few things that are blocked on this person, highest priority first, each with who/what and a link if there is one.
## You — what they did in the window, grouped into a few meaningful bullets (not a log dump). For daily briefs, end with a one-line "Suggested for today" based on their in-progress cards.
## Team — one bullet per person (humans and agents) with the gist of what they moved forward. Name people.
## Heads-up — cards about to drift to "Not now" from inactivity, and anything else worth a glance.

Rules: be concrete (card numbers like #12, PR titles), never invent facts that are not in the data, no filler or greetings, at most ~250 words for daily and ~450 for weekly. If almost nothing happened, say so in one line.
${UNTRUSTED_NOTE}`;

export async function composeBrief(
  ctx: AppContext,
  member: Member,
  data: BriefData,
  extraInstructions?: string | null
) {
  const title = `${data.period === "daily" ? "Morning brief" : "Weekly wrap"} for ${member.name}`;
  if (!ctx.models) {
    return { title, body: templateBrief(data), composedBy: "template" };
  }
  const memory = await renderMemory(ctx, member.id, true, 1);
  const result = await generateText({
    model: ctx.models.main,
    instructions:
      BRIEF_INSTRUCTIONS +
      (extraInstructions
        ? `\n\nThe reader's own preferences for this brief: ${extraInstructions}`
        : ""),
    prompt: `What you know about ${member.name}:\n${memory}\n\nBrief data (JSON):\n${JSON.stringify(data)}`,
    timeout: TIMEOUTS.background,
  });
  return {
    title,
    body: result.text.trim(),
    composedBy: result.finalStep.response.modelId,
  };
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
    for (const d of data.you.did.slice(0, 12)) {
      out.push(
        `- ${d.title}${d.detail && d.detail !== d.title ? ` — ${d.detail}` : ""}`
      );
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
        `- **${p.name}**${p.kind === "agent" ? " (agent)" : ""}: ${p.did.map((d) => d.title).join("; ")}`
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
      out.push(`- ${data.board.newInMaybe} new card(s) waiting in Maybe?`);
    }
  }
  return out.join("\n");
}

export async function generateBrief(
  ctx: AppContext,
  member: Member,
  period: Period,
  extraInstructions?: string | null
) {
  const { _key, ...data } = await gatherBriefData(ctx, member, period);
  const { title, body, composedBy } = await composeBrief(
    ctx,
    member,
    data,
    extraInstructions
  );
  const row: BriefRow = {
    id: newId("brf"),
    workspaceId: member.workspaceId,
    memberId: member.id,
    period,
    periodStart: _key,
    periodEnd: new Date(data.range.end),
    title,
    body,
    data,
    composedBy,
    createdAt: ctx.now(),
  };
  const saved = returned(
    await ctx.db
      .insert(briefs)
      .values(row)
      .onConflictDoUpdate({
        target: [briefs.memberId, briefs.period, briefs.periodStart],
        set: {
          title,
          body,
          data: row.data,
          composedBy,
          periodEnd: row.periodEnd,
          createdAt: row.createdAt,
        },
      })
      .returning(),
    "brief"
  );
  await ctx.bus.publish({
    workspaceId: member.workspaceId,
    audienceId: member.id,
    type: "brief.created",
    data: { id: saved.id, period, title },
  });
  return saved;
}

export async function listBriefs(
  ctx: AppContext,
  memberId: string,
  period?: Period,
  limit = 20
) {
  return await ctx.db
    .select()
    .from(briefs)
    .where(
      and(
        eq(briefs.memberId, memberId),
        period ? eq(briefs.period, period) : undefined
      )
    )
    .orderBy(desc(briefs.periodStart))
    .limit(limit);
}

export async function getBrief(ctx: AppContext, memberId: string, id: string) {
  const [row] = await ctx.db
    .select()
    .from(briefs)
    .where(and(eq(briefs.id, id), eq(briefs.memberId, memberId)));
  return row ?? null;
}
