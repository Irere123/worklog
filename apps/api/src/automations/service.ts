import { and, asc, desc, eq } from "drizzle-orm";

import type { AppContext } from "../context";
import { automationRuns, automations, workspaces } from "../db/schema";
import type { AutomationKind, members, Schedule } from "../db/schema";
import { badRequest, notFound } from "../lib/errors";
import { newId } from "../lib/ids";
import { jitterFor, nextRun } from "./schedule";

type Member = typeof members.$inferSelect;
export type AutomationRow = typeof automations.$inferSelect;

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createDefaultAutomations(
  ctx: AppContext,
  member: Member,
  emailTargetId: string | null
) {
  const briefTargets = emailTargetId ? [emailTargetId] : [];
  const weekdays = [1, 2, 3, 4, 5];
  // Three batches a day (brief + two digests) plus pings only for what's blocked on you:
  // batching ~3x/day is what improved attention and stress in the field studies.
  const defaults: {
    kind: AutomationKind;
    name: string;
    schedule: Schedule;
    targetIds: string[];
  }[] = [
    {
      kind: "brief.daily",
      name: "Morning brief",
      schedule: { type: "daily", at: "08:30", weekdays },
      targetIds: briefTargets,
    },
    {
      kind: "digest",
      name: "Midday digest",
      schedule: { type: "daily", at: "12:30", weekdays },
      targetIds: [],
    },
    {
      kind: "digest",
      name: "Afternoon digest",
      schedule: { type: "daily", at: "16:30", weekdays },
      targetIds: [],
    },
    {
      kind: "brief.weekly",
      name: "Weekly wrap",
      schedule: { type: "weekly", weekday: 5, at: "16:00" },
      targetIds: briefTargets,
    },
    {
      kind: "check",
      name: "Attention check",
      schedule: { type: "interval", minutes: 30, activeHoursOnly: true },
      targetIds: [],
    },
    {
      kind: "consolidate",
      name: "Nightly memory",
      schedule: { type: "daily", at: "02:00" },
      targetIds: [],
    },
  ];
  for (const d of defaults) {
    await createAutomation(ctx, member, d);
  }
}

export async function createAutomation(
  ctx: AppContext,
  member: Member,
  input: {
    kind: AutomationKind;
    name: string;
    schedule: Schedule;
    targetIds?: string[];
    instructions?: string | null;
    enabled?: boolean;
  }
) {
  if (input.kind === "custom" && !input.instructions) {
    throw badRequest("Custom automations need instructions");
  }
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
    nextRunAt: nextRun(
      input.schedule,
      tz,
      ctx.now(),
      member.settings,
      jitterFor(id)
    ),
    createdAt: ctx.now(),
  };
  await ctx.db.insert(automations).values(row);
  return await getAutomation(ctx, member.id, id);
}

export async function listAutomations(ctx: AppContext, memberId: string) {
  return await ctx.db
    .select()
    .from(automations)
    .where(eq(automations.memberId, memberId))
    .orderBy(asc(automations.createdAt));
}

export async function getAutomation(
  ctx: AppContext,
  memberId: string,
  id: string
) {
  const [row] = await ctx.db
    .select()
    .from(automations)
    .where(and(eq(automations.id, id), eq(automations.memberId, memberId)));
  if (!row) {
    throw notFound("Automation");
  }
  return row;
}

export async function updateAutomation(
  ctx: AppContext,
  member: Member,
  id: string,
  patch: Partial<
    Pick<
      AutomationRow,
      "name" | "schedule" | "targetIds" | "instructions" | "enabled"
    >
  >
) {
  const current = await getAutomation(ctx, member.id, id);
  const schedule = patch.schedule ?? current.schedule;
  const tz = await memberTimezone(ctx, member);
  await ctx.db
    .update(automations)
    .set({
      ...patch,
      ...(patch.enabled === true ? { failureCount: 0 } : {}),
      nextRunAt: nextRun(
        schedule,
        tz,
        ctx.now(),
        member.settings,
        jitterFor(id)
      ),
    })
    .where(eq(automations.id, id));
  return await getAutomation(ctx, member.id, id);
}

export async function deleteAutomation(
  ctx: AppContext,
  memberId: string,
  id: string
) {
  await getAutomation(ctx, memberId, id);
  await ctx.db.delete(automations).where(eq(automations.id, id));
}

export async function listRuns(ctx: AppContext, memberId: string, id: string) {
  await getAutomation(ctx, memberId, id);
  return await ctx.db
    .select()
    .from(automationRuns)
    .where(eq(automationRuns.automationId, id))
    .orderBy(desc(automationRuns.startedAt))
    .limit(50);
}

export async function memberTimezone(ctx: AppContext, member: Member) {
  if (member.timezone) {
    return member.timezone;
  }
  const [ws] = await ctx.db
    .select({ tz: workspaces.timezone })
    .from(workspaces)
    .where(eq(workspaces.id, member.workspaceId));
  return ws?.tz ?? "UTC";
}
