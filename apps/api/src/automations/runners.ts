import { generateText, Output } from "ai";
import { z } from "zod";

import { postToInbox } from "#agent/conversations";
import { TIMEOUTS } from "#ai/models";
import type { Models } from "#ai/models";
import { audienceNote, CONSTITUTION, UNTRUSTED_NOTE } from "#ai/prompts";
import {
  markConsidered,
  markDigested,
  mutedKinds,
  pushBudget,
  recordNotification,
  teamVisibleAttention,
} from "#attention/service";
import { composeTeamBrief, generateBrief } from "#briefs/service";
import type { AppContext } from "#context";
import { listActivities } from "#db/queries/activities";
import {
  listDigestableAttention,
  listOpenAttention,
  listUnconsideredAttention,
} from "#db/queries/attention";
import type { AttentionItem } from "#db/queries/attention";
import type { Automation, AutomationRun } from "#db/queries/automations";
import type { Member } from "#db/queries/members";
import type { Visibility } from "#db/schema";
import { sanitizeMarkdown, urlsIn } from "#delivery/sanitize";
import { deliver, splitTargets } from "#delivery/service";
import { DAY_MS, startOfLocalDay } from "#lib/time";
import { renderMemory } from "#memory/service";
import { workSnapshot } from "#work/snapshot";

import { isActiveNow } from "./schedule";

export type RunOutcome = {
  status: AutomationRun["status"];
  summary: string;
};

type Message = {
  subject: string;
  markdown: string;
  sources: unknown;
  kind: string;
  itemIds?: string[];
  reason?: string;
};

/**
 * Private data only reaches private targets. The inbox and private targets get `message`; team
 * targets get `forTeam()`, a version built from team-visible data alone, which is composed only when
 * there are team targets and skipped when it is null because there's nothing the team can see.
 */
async function send(
  ctx: AppContext,
  automation: Automation,
  member: Member,
  message: Message,
  forTeam: () => Promise<Message | null>
) {
  const targets = await splitTargets(ctx, member.id, automation.targetIds);
  const body = sanitized(ctx, message);
  await postToInbox(ctx, member, automation.name, body);
  const own = await deliver(
    ctx,
    member.id,
    targets.private,
    outgoing(ctx, automation, message.subject, body)
  );
  const team = targets.team.length ? await forTeam() : null;
  const teamBody = team ? sanitized(ctx, team) : null;
  const shared = await deliver(
    ctx,
    member.id,
    team ? targets.team : [],
    outgoing(ctx, automation, team?.subject ?? "", teamBody ?? "")
  );
  const delivered = [...own.delivered, ...shared.delivered];
  const failed = [...own.failed, ...shared.failed];
  await recordNotification(ctx, {
    workspaceId: member.workspaceId,
    memberId: member.id,
    automationId: automation.id,
    kind: message.kind,
    itemIds: message.itemIds ?? [],
    subject: message.subject,
    body,
    teamBody,
    reason: message.reason ?? null,
    deliveredTo: delivered,
  });
  if (failed.length && !delivered.length) {
    throw new Error(
      `Delivery failed: ${failed.map((f) => f.error).join("; ")}`
    );
  }
  return { delivered, failed };
}

// Every outbound body is sanitized against the URLs in its source data, so injected content can't smuggle links out.
function sanitized(ctx: AppContext, message: Message) {
  return sanitizeMarkdown(
    message.markdown,
    urlsIn(message.sources),
    ctx.config.PUBLIC_URL
  );
}

function outgoing(
  ctx: AppContext,
  automation: Automation,
  subject: string,
  markdown: string
) {
  return {
    type: automation.kind,
    subject,
    markdown,
    url: ctx.config.PUBLIC_URL,
  };
}

export async function runBrief(
  ctx: AppContext,
  automation: Automation,
  member: Member
): Promise<RunOutcome> {
  const period = automation.kind === "brief.weekly" ? "weekly" : "daily";
  const brief = await generateBrief(
    ctx,
    member,
    period,
    automation.instructions
  );
  const { delivered, failed } = await send(
    ctx,
    automation,
    member,
    {
      subject: brief.title,
      markdown: brief.body,
      sources: brief.data,
      kind: "brief",
    },
    async () => {
      const team = await composeTeamBrief(
        ctx,
        member,
        period,
        automation.instructions
      );
      return {
        subject: team.title,
        markdown: team.body,
        sources: team.data,
        kind: "brief",
      };
    }
  );
  // The brief's "Needs your attention" section counts as having shown these.
  const shown = await listOpenAttention(ctx.db, {
    memberId: member.id,
    now: ctx.now(),
    limit: 30,
  });
  await markDigested(
    ctx,
    shown.map((a) => a.id)
  );
  return {
    status: "delivered",
    summary: `${brief.title} → inbox + ${delivered.length} target(s)${failed.length ? `, ${failed.length} failed` : ""}`,
  };
}

export async function runDigest(
  ctx: AppContext,
  automation: Automation,
  member: Member
): Promise<RunOutcome> {
  const items = await listDigestableAttention(ctx.db, {
    memberId: member.id,
    now: ctx.now(),
  });
  if (!items.length) {
    return { status: "skipped", summary: "Nothing new since the last batch" };
  }
  await send(ctx, automation, member, digest(items), async () => {
    const shared = await teamVisibleAttention(ctx, items);
    return shared.length ? digest(shared) : null;
  });
  await markDigested(
    ctx,
    items.map((i) => i.id)
  );
  return { status: "delivered", summary: `${items.length} item(s)` };
}

function digest(shown: AttentionItem[]): Message {
  return {
    subject: "Your Worklog digest",
    markdown: [
      `${shown.length} thing(s) since your last update:`,
      ...shown.slice(0, 20).map(digestLine),
      shown.length > 20 ? `…and ${shown.length - 20} more in Worklog.` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    sources: shown,
    kind: "digest",
    itemIds: shown.map((i) => i.id),
  };
}

function digestLine(a: AttentionItem) {
  const bold = a.priority === "high" ? "**" : "";
  return `- ${bold}${a.title}${bold}${a.count > 1 ? ` (×${a.count})` : ""}${a.url ? ` — ${a.url}` : ""}`;
}

// Deterministic gates first (models over-trigger: ~50% false alarms), then the model as a
// classifier inside them.
const DEFAULT_LIMITS = {
  dailyPushCap: 4,
  minGapMinutes: 90,
  threadCooldownHours: 4,
};

const Classified = z.object({
  decisions: z.array(
    z.object({
      id: z.string(),
      push: z
        .boolean()
        .describe("true only if it is blocked on them or time-sensitive today"),
      reason: z
        .string()
        .describe(
          "Why, in under 15 words, addressed to them — e.g. 'Sam is waiting on your review to ship today'"
        ),
    })
  ),
});

type Decision = {
  id: string;
  disposition: "push" | "digest" | "drop";
  reason: string;
};

export async function runCheck(
  ctx: AppContext,
  automation: Automation,
  member: Member,
  tz: string,
  manual: boolean
): Promise<RunOutcome> {
  if (!manual && !isActiveNow(ctx.now(), tz, member.settings)) {
    return { status: "skipped", summary: "Outside active hours" };
  }
  const pending = await listUnconsideredAttention(ctx.db, {
    memberId: member.id,
    now: ctx.now(),
  });
  if (!pending.length) {
    return { status: "skipped", summary: "Nothing new" };
  }

  const limits = { ...DEFAULT_LIMITS, ...member.settings.notify };
  const now = ctx.now().getTime();
  const muted = await mutedKinds(ctx, member.id);
  const decisions: Decision[] = [];
  let candidates: AttentionItem[] = [];
  for (const item of pending) {
    const reason = digestReason(item, muted, limits, now);
    if (reason === null) {
      candidates.push(item);
    } else {
      decisions.push({ id: item.id, disposition: "digest", reason });
    }
  }

  if (candidates.length) {
    const budget = await pingBudget(ctx, member.id, tz, limits, now);
    if (budget === "hold") {
      // Leave them unconsidered so the next check (after the gap) decides.
      await markConsidered(ctx, decisions);
      return {
        status: "quiet",
        summary: `Holding ${candidates.length} urgent item(s) until the ${limits.minGapMinutes}-minute gap passes`,
      };
    }
    if (budget === "spent") {
      for (const c of candidates) {
        decisions.push({
          id: c.id,
          disposition: "digest",
          reason: "Today's ping budget is used up — kept for your digest",
        });
      }
      candidates = [];
    }
  }

  decisions.push(...(await classify(ctx, automation, member, candidates)));
  await markConsidered(ctx, decisions);
  return await pushDecided(ctx, automation, member, pending, decisions);
}

type Limits = typeof DEFAULT_LIMITS;

function digestReason(
  item: AttentionItem,
  muted: Set<string>,
  limits: Limits,
  now: number
): string | null {
  if (muted.has(item.kind)) {
    return "You marked pings like this as not useful — kept for your digest";
  }
  if (item.priority !== "high") {
    return "Not urgent — it'll be in your next digest";
  }
  if (
    item.pushedAt &&
    now - item.pushedAt.getTime() < limits.threadCooldownHours * 3_600_000
  ) {
    return "You were pinged about this thread recently";
  }
  return null;
}

async function pingBudget(
  ctx: AppContext,
  memberId: string,
  tz: string,
  limits: Limits,
  now: number
): Promise<"ok" | "spent" | "hold"> {
  const { pushesToday, lastPushAt } = await pushBudget(
    ctx,
    memberId,
    startOfLocalDay(ctx.now(), tz)
  );
  if (pushesToday >= limits.dailyPushCap) {
    return "spent";
  }
  if (
    lastPushAt &&
    now - lastPushAt.getTime() < limits.minGapMinutes * 60_000
  ) {
    return "hold";
  }
  return "ok";
}

// The model may only demote a push to the digest; without one, everything that got this far is pushed.
async function classify(
  ctx: AppContext,
  automation: Automation,
  member: Member,
  candidates: AttentionItem[]
): Promise<Decision[]> {
  if (!candidates.length || !ctx.models) {
    return candidates.map((c) => ({
      id: c.id,
      disposition: "push",
      reason: defaultReason(c),
    }));
  }
  const memory = await renderMemory(ctx, member.id, true, 0);
  const { output } = await generateText({
    model: ctx.models.fast,
    instructions: `You decide whether ${member.name}'s Worklog assistant should interrupt them now. Every item has already passed the urgency and budget rules, so only drop the push for items that are clearly not blocked on ${member.name} or not time-sensitive given what you know about them. Respect their stated preferences.
${automation.instructions ? `Their instructions for this check: ${automation.instructions}\n` : ""}${UNTRUSTED_NOTE}`,
    prompt: `What you know about ${member.name}:\n${memory}\n\nLast result: ${JSON.stringify(automation.state.lastResult ?? null)}\n\nItems:\n${JSON.stringify(
      candidates.map((p) => ({
        id: p.id,
        kind: p.kind,
        title: p.title,
        detail: p.body,
        count: p.count,
        since: p.createdAt.toISOString(),
      }))
    )}`,
    output: Output.object({ schema: Classified }),
    timeout: TIMEOUTS.quick,
  });
  return candidates.map((c) => {
    const d = output.decisions.find((x) => x.id === c.id);
    return {
      id: c.id,
      disposition: d && !d.push ? "digest" : "push",
      reason: plainReason(d?.reason) ?? defaultReason(c),
    };
  });
}

async function pushDecided(
  ctx: AppContext,
  automation: Automation,
  member: Member,
  pending: AttentionItem[],
  decisions: Decision[]
): Promise<RunOutcome> {
  const rows = decisions
    .filter((d) => d.disposition === "push")
    .flatMap((d) => {
      const item = pending.find((p) => p.id === d.id);
      return item ? [{ item, reason: d.reason }] : [];
    });
  const [first] = rows;
  if (!first) {
    return {
      status: "quiet",
      summary: `Considered ${decisions.length} item(s); nothing worth interrupting for`,
    };
  }
  await send(ctx, automation, member, ping(rows), async () => {
    const visibleItems = await teamVisibleAttention(
      ctx,
      rows.map((r) => r.item)
    );
    const shared = new Set(visibleItems.map((i) => i.id));
    // The model wrote its reasons with private memory in view, so the team gets the plain ones.
    const visible = rows
      .filter((r) => shared.has(r.item.id))
      .map((r) => ({ item: r.item, reason: defaultReason(r.item) }));
    return visible.length ? ping(visible) : null;
  });
  return {
    status: "delivered",
    summary: `Pushed ${rows.length}, held ${decisions.length - rows.length} for the digest`,
  };
}

function ping(rows: { item: AttentionItem; reason: string }[]): Message {
  return {
    subject:
      rows.length === 1 && rows[0]
        ? `Needs you: ${rows[0].item.title}`
        : `${rows.length} things need you`,
    markdown: [
      ...rows.map(
        ({ item, reason }) =>
          `- **${item.title}**${item.url ? ` — ${item.url}` : ""}\n  _Why now: ${reason}_`
      ),
      `\n_Reply here to ask about any of these. Not useful? Tell me, or mark it in Worklog — I'll hold pings like it for your digest._`,
    ].join("\n"),
    sources: rows.map((r) => r.item),
    kind: "push",
    itemIds: rows.map((r) => r.item.id),
    reason: rows.map((r) => r.reason).join(" | "),
  };
}

function plainReason(reason?: string) {
  const clean = reason
    ?.replaceAll(/https?:\/\/\S+/gu, "")
    .replaceAll(/[[\]()!<>*_`#]/gu, "")
    .trim()
    .slice(0, 140);
  return clean === undefined || clean === "" ? null : clean;
}

function defaultReason(item: AttentionItem) {
  switch (item.kind) {
    case "review.requested": {
      return "Someone is waiting on your review";
    }
    case "mention": {
      return "You were mentioned directly";
    }
    case "blocking": {
      return "A teammate says they're blocked on you";
    }
    case "assistant.note": {
      return "A teammate left you a note through your assistant";
    }
    case "pr.review": {
      return "Changes were requested on your PR";
    }
    default: {
      return "Marked high priority";
    }
  }
}

const CustomResult = z.object({
  decision: z.enum(["notify", "quiet"]),
  message: z.string(),
  summary: z.string(),
});

export async function runCustom(
  ctx: AppContext,
  automation: Automation,
  member: Member
): Promise<RunOutcome> {
  const { models } = ctx;
  if (!models) {
    return {
      status: "skipped",
      summary: "Custom automations need AI (OPENROUTER_API_KEY)",
    };
  }
  const own = await composeCustom(ctx, models, automation, member, "private");
  if (!own.message) {
    return { status: "quiet", summary: own.summary };
  }
  await send(ctx, automation, member, own.message, async () => {
    const team = await composeCustom(ctx, models, automation, member, "team");
    return team.message;
  });
  return { status: "delivered", summary: own.summary };
}

// The team version sees team-visible data only, and not the last result either: that summary was
// written from everything.
async function composeCustom(
  ctx: AppContext,
  models: Models,
  automation: Automation,
  member: Member,
  visibility: Visibility
): Promise<{ message: Message | null; summary: string }> {
  const everything = visibility === "private";
  const [snapshot, attention, team, memory] = await Promise.all([
    workSnapshot(ctx, member, { includePrivate: everything, days: 7 }),
    listOpenAttention(ctx.db, {
      memberId: member.id,
      now: ctx.now(),
      limit: 30,
    }).then(async (items) =>
      everything ? items : await teamVisibleAttention(ctx, items)
    ),
    listActivities(ctx.db, {
      workspaceId: member.workspaceId,
      privateFor: [],
      since: new Date(ctx.now().getTime() - 7 * DAY_MS),
      limit: 200,
    }),
    renderMemory(ctx, member.id, everything, 1),
  ]);
  const data = {
    work: snapshot,
    attention: attention.map((a) => ({
      kind: a.kind,
      title: a.title,
      priority: a.priority,
      url: a.url,
    })),
    team: team.map((a) => ({
      at: a.occurredAt.toISOString(),
      actorId: a.actorId,
      kind: a.kind,
      title: a.title,
      url: a.url,
    })),
  };
  const last = everything
    ? `Last result: ${JSON.stringify(automation.state.lastResult ?? null)}\n\n`
    : "";
  const { output } = await generateText({
    model: models.main,
    instructions: `${CONSTITUTION}

# This automation

You are ${member.name}'s assistant, running a scheduled automation they wrote. Follow their instructions using only the data provided. If there is nothing worth telling them, decide "quiet". ${audienceNote(visibility, member.name)}`,
    prompt: `Automation "${automation.name}" instructions:\n${automation.instructions}\n\n${last}What you know about them:\n${memory}\n\nData:\n${JSON.stringify(data)}`,
    output: Output.object({ schema: CustomResult }),
    timeout: TIMEOUTS.background,
  });
  const quiet = output.decision === "quiet" || !output.message.trim();
  return {
    message: quiet
      ? null
      : {
          subject: automation.name,
          markdown: output.message,
          sources: data,
          kind: "custom",
        },
    summary: output.summary,
  };
}
