import { and, asc, desc, eq, lte } from "drizzle-orm";
import { raiseAttention } from "../attention/service";
import type { AppContext } from "../context";
import { automationRuns, automations, members, workspaces, type AutomationKind, type Schedule } from "../db/schema";
import { badRequest, notFound } from "../lib/errors";
import { newId } from "../lib/ids";
import { runBrief, runCheck, runConsolidate, runCustom, runDigest, type RunOutcome } from "./runners";
import { jitterFor, nextRun } from "./schedule";

type Member = typeof members.$inferSelect;
export type AutomationRow = typeof automations.$inferSelect;

const FAILURE_ALERT_AT = 3;
const FAILURE_DISABLE_AT = 10;

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createDefaultAutomations(ctx: AppContext, member: Member, emailTargetId: string | null) {
  const briefTargets = emailTargetId ? [emailTargetId] : [];
  const weekdays = [1, 2, 3, 4, 5];
  // Three batches a day (brief + two digests) plus pings only for what's blocked on you:
  // batching ~3x/day is what improved attention and stress in the field studies.
  const defaults: { kind: AutomationKind; name: string; schedule: Schedule; targetIds: string[] }[] = [
    { kind: "brief.daily", name: "Morning brief", schedule: { type: "daily", at: "08:30", weekdays }, targetIds: briefTargets },
    { kind: "digest", name: "Midday digest", schedule: { type: "daily", at: "12:30", weekdays }, targetIds: [] },
    { kind: "digest", name: "Afternoon digest", schedule: { type: "daily", at: "16:30", weekdays }, targetIds: [] },
    { kind: "brief.weekly", name: "Weekly wrap", schedule: { type: "weekly", weekday: 5, at: "16:00" }, targetIds: briefTargets },
    { kind: "check", name: "Attention check", schedule: { type: "interval", minutes: 30, activeHoursOnly: true }, targetIds: [] },
    { kind: "consolidate", name: "Nightly memory", schedule: { type: "daily", at: "02:00" }, targetIds: [] },
  ];
  for (const d of defaults) await createAutomation(ctx, member, d);
}

export async function createAutomation(
  ctx: AppContext,
  member: Member,
  input: { kind: AutomationKind; name: string; schedule: Schedule; targetIds?: string[]; instructions?: string | null; enabled?: boolean },
) {
  if (input.kind === "custom" && !input.instructions) throw badRequest("Custom automations need instructions");
  const tz = await memberTimezone(ctx, member);
  const id = newId("aut");
  const row = {
    id,
    workspaceId: member.workspaceId,
    memberId: member.id,
    kind: input.kind,
    name: input.name,
    schedule: input.schedule,
    targetIds: input.targetIds ?? [],
    instructions: input.instructions ?? null,
    enabled: input.enabled ?? true,
    nextRunAt: nextRun(input.schedule, tz, ctx.now(), member.settings, jitterFor(id)),
    createdAt: ctx.now(),
  };
  await ctx.db.insert(automations).values(row);
  return getAutomation(ctx, member.id, id);
}

export async function listAutomations(ctx: AppContext, memberId: string) {
  return ctx.db.select().from(automations).where(eq(automations.memberId, memberId)).orderBy(asc(automations.createdAt));
}

export async function getAutomation(ctx: AppContext, memberId: string, id: string) {
  const [row] = await ctx.db
    .select()
    .from(automations)
    .where(and(eq(automations.id, id), eq(automations.memberId, memberId)));
  if (!row) throw notFound("Automation");
  return row;
}

export async function updateAutomation(
  ctx: AppContext,
  member: Member,
  id: string,
  patch: Partial<Pick<AutomationRow, "name" | "schedule" | "targetIds" | "instructions" | "enabled">>,
) {
  const current = await getAutomation(ctx, member.id, id);
  const schedule = patch.schedule ?? current.schedule;
  const tz = await memberTimezone(ctx, member);
  await ctx.db
    .update(automations)
    .set({
      ...patch,
      ...(patch.enabled ? { failureCount: 0 } : {}),
      nextRunAt: nextRun(schedule, tz, ctx.now(), member.settings, jitterFor(id)),
    })
    .where(eq(automations.id, id));
  return getAutomation(ctx, member.id, id);
}

export async function deleteAutomation(ctx: AppContext, memberId: string, id: string) {
  await getAutomation(ctx, memberId, id);
  await ctx.db.delete(automations).where(eq(automations.id, id));
}

export async function listRuns(ctx: AppContext, memberId: string, id: string) {
  await getAutomation(ctx, memberId, id);
  return ctx.db
    .select()
    .from(automationRuns)
    .where(eq(automationRuns.automationId, id))
    .orderBy(desc(automationRuns.startedAt))
    .limit(50);
}

async function memberTimezone(ctx: AppContext, member: Member) {
  if (member.timezone) return member.timezone;
  const [ws] = await ctx.db.select({ tz: workspaces.timezone }).from(workspaces).where(eq(workspaces.id, member.workspaceId));
  return ws?.tz ?? "UTC";
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

/** Called by the scheduler every minute: drains everything due, in batches, within a time budget. */
export async function runDueAutomations(ctx: AppContext, opts: { batch?: number; budgetMs?: number } = {}) {
  const batch = opts.batch ?? 25;
  const deadline = Date.now() + (opts.budgetMs ?? 45_000);
  const results = [];
  while (Date.now() < deadline) {
    const due = await ctx.db
      .select()
      .from(automations)
      .where(and(eq(automations.enabled, true), lte(automations.nextRunAt, ctx.now())))
      .orderBy(asc(automations.nextRunAt))
      .limit(batch);
    for (const automation of due) results.push(await runAutomation(ctx, automation));
    if (due.length < batch) break;
  }
  return results;
}

export async function runAutomation(ctx: AppContext, automation: AutomationRow, opts: { manual?: boolean } = {}) {
  const startedAt = ctx.now();
  const [member] = await ctx.db.select().from(members).where(eq(members.id, automation.memberId));
  if (!member) throw notFound("Member");
  const tz = await memberTimezone(ctx, member);

  let outcome: RunOutcome;
  let error: string | null = null;
  try {
    outcome = await execute(ctx, automation, member, tz, opts.manual ?? false);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    outcome = { status: "failed", summary: error };
  }

  const failureCount = outcome.status === "failed" ? automation.failureCount + 1 : 0;
  const state =
    outcome.status === "delivered" || outcome.status === "quiet"
      ? { ...automation.state, lastResult: { status: outcome.status, summary: outcome.summary, at: startedAt.toISOString() } }
      : automation.state;
  await ctx.db
    .update(automations)
    .set({
      lastRunAt: startedAt,
      lastStatus: outcome.status,
      failureCount,
      state,
      enabled: failureCount >= FAILURE_DISABLE_AT ? false : automation.enabled,
      nextRunAt: opts.manual ? automation.nextRunAt : nextRun(automation.schedule, tz, ctx.now(), member.settings, jitterFor(automation.id)),
    })
    .where(eq(automations.id, automation.id));
  await ctx.db.insert(automationRuns).values({
    id: newId("run"),
    automationId: automation.id,
    status: outcome.status,
    summary: outcome.summary.slice(0, 2000),
    error,
    startedAt,
  });
  if (failureCount === FAILURE_ALERT_AT || failureCount === FAILURE_DISABLE_AT) {
    await raiseAttention(ctx, {
      workspaceId: member.workspaceId,
      memberId: member.id,
      kind: "automation.failing",
      title:
        failureCount >= FAILURE_DISABLE_AT
          ? `"${automation.name}" was turned off after ${failureCount} failures`
          : `"${automation.name}" has failed ${failureCount} times in a row`,
      body: error,
      priority: "normal",
      dedupeKey: `automation:${automation.id}`,
    });
  }
  await ctx.bus.publish({
    workspaceId: member.workspaceId,
    audienceId: member.id,
    type: "automation.ran",
    data: { id: automation.id, kind: automation.kind, status: outcome.status, summary: outcome.summary.slice(0, 280) },
  });
  return { automationId: automation.id, ...outcome };
}

async function execute(ctx: AppContext, automation: AutomationRow, member: Member, tz: string, manual: boolean): Promise<RunOutcome> {
  switch (automation.kind) {
    case "brief.daily":
    case "brief.weekly":
      return runBrief(ctx, automation, member);
    case "digest":
      return runDigest(ctx, automation, member);
    case "check":
      return runCheck(ctx, automation, member, tz, manual);
    case "consolidate":
      return runConsolidate(ctx, member, tz);
    case "custom":
      return runCustom(ctx, automation, member);
  }
}
