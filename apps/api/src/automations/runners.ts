import { z } from "zod";

import { postToInbox } from "#agent/conversations";
import { structured } from "#agent/generate";
import { renderMemory } from "#agent/memory";
import { prompt, UNTRUSTED_NOTE } from "#agent/prompts";
import { runRoutine } from "#agent/routine";
import type { AppContext } from "#context";
import {
  listDigestableAttention,
  listOpenAttention,
  listUnconsideredAttention,
} from "#db/queries/attention";
import type { AttentionItem } from "#db/queries/attention";
import type { Automation, AutomationRun } from "#db/queries/automations";
import type { Member } from "#db/queries/members";
import { startOfLocalDay } from "#lib/time";
import {
  markConsidered,
  markDigested,
  mutedKinds,
  pushBudget,
  recordNotification,
  teamVisibleAttention,
} from "#work/attention";

import {
  composeTeamBrief,
  gatherBriefData,
  isEmptyWindow,
  saveBrief,
} from "./briefs";
import { deliver, splitTargets } from "./delivery";
import { sanitizeMarkdown, urlsIn } from "./sanitize";
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

// Quiet is allowed: a scheduled brief with nothing in it isn't sent. Run by hand, it always is.
export async function runBrief(
  ctx: AppContext,
  automation: Automation,
  member: Member,
  manual: boolean
): Promise<RunOutcome> {
  const period = automation.kind === "brief.weekly" ? "weekly" : "daily";
  const { _key, ...data } = await gatherBriefData(ctx, member, period);
  if (!manual && isEmptyWindow(data)) {
    return {
      status: "quiet",
      summary: "Nothing moved and nothing is waiting on you, so no brief",
    };
  }
  const brief = await saveBrief(
    ctx,
    member,
    _key,
    data,
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

/** Kinds that only the member themselves raise, for themselves, at a time they chose. */
const ASKED_FOR = new Set(["follow_up"]);

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
  // What they asked to have brought back comes back when they asked: it's their own request, not
  // an interruption, so neither the budget nor the model holds it.
  const decisions: Decision[] = pending
    .filter((item) => ASKED_FOR.has(item.kind))
    .map((item) => ({
      id: item.id,
      disposition: "push",
      reason: defaultReason(item),
    }));
  let candidates: AttentionItem[] = [];
  for (const item of pending.filter((i) => !ASKED_FOR.has(i.kind))) {
    const reason = digestReason(item, muted, limits, now);
    if (reason === null) {
      candidates.push(item);
    } else {
      decisions.push({ id: item.id, disposition: "digest", reason });
    }
  }

  if (candidates.length) {
    const budget = await pingBudget(ctx, member.id, tz, limits, now);
    if (budget === "hold" && !decisions.some((d) => d.disposition === "push")) {
      // Leave them unconsidered so the next check (after the gap) decides.
      await markConsidered(ctx, decisions);
      return {
        status: "quiet",
        summary: `Holding ${candidates.length} urgent item(s) until the ${limits.minGapMinutes}-minute gap passes`,
      };
    }
    if (budget === "hold") {
      // Left unconsidered, as above; what they asked for goes out on its own.
      candidates = [];
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
  muted: Map<string, string>,
  limits: Limits,
  now: number
): string | null {
  const why = muted.get(item.kind);
  if (why !== undefined) {
    return why;
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
  const output = await structured(ctx.models, {
    model: "fast",
    instructions: [
      prompt("check", { name: member.name }),
      automation.instructions
        ? `Their instructions for this check: ${automation.instructions}`
        : "",
      UNTRUSTED_NOTE,
    ],
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
    schema: Classified,
    timeout: "quick",
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
    case "follow_up": {
      return "You asked me to bring this back now";
    }
    default: {
      return "Marked high priority";
    }
  }
}

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
  const own = await runRoutine(ctx, models, automation, member, "private");
  if (!own.message) {
    return { status: "quiet", summary: own.summary };
  }
  await send(
    ctx,
    automation,
    member,
    routineMessage(automation, own.message, own.sources),
    async () => {
      const team = await runRoutine(ctx, models, automation, member, "team");
      return team.message
        ? routineMessage(automation, team.message, team.sources)
        : null;
    }
  );
  return { status: "delivered", summary: own.summary };
}

function routineMessage(
  automation: Automation,
  markdown: string,
  sources: unknown
): Message {
  return { subject: automation.name, markdown, sources, kind: "custom" };
}
