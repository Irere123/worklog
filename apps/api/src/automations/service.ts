import { presenceChanged } from "#agent/presence";
import type { AppContext } from "#context";
import {
  deleteAutomationById,
  getAutomationById,
  insertAutomation,
  listAutomationRuns,
  updateAutomationById,
} from "#db/queries/automations";
import type { Automation } from "#db/queries/automations";
import type { Member } from "#db/queries/members";
import { getWorkspaceById } from "#db/queries/workspaces";
import type { AutomationKind, Schedule } from "#db/schema";
import { transact } from "#db/transact";
import { badRequest, notFound } from "#lib/errors";
import { generateId } from "#lib/ids";
import { timezoneOf } from "#lib/time";

import { jitterFor, nextRun } from "./schedule";

type NewAutomation = {
  kind: AutomationKind;
  name: string;
  schedule: Schedule;
  targetIds?: string[];
  instructions?: string | null;
  enabled?: boolean;
};

export async function createDefaultAutomations(
  ctx: AppContext,
  member: Member,
  emailTargetId: string | null
) {
  const briefTargets = emailTargetId ? [emailTargetId] : [];
  const weekdays = [1, 2, 3, 4, 5];
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
  await transact(ctx, async (tx) => {
    for (const d of defaults) {
      await addAutomation(tx, member, d);
    }
  });
}

export async function createAutomation(
  ctx: AppContext,
  member: Member,
  input: NewAutomation
) {
  const created = await addAutomation(ctx, member, input);
  await presenceChanged(ctx, {
    workspaceId: member.workspaceId,
    ownerId: member.id,
  });
  return created;
}

export async function updateAutomation(
  ctx: AppContext,
  member: Member,
  id: string,
  patch: Partial<
    Pick<
      Automation,
      "name" | "schedule" | "targetIds" | "instructions" | "enabled"
    >
  >
) {
  const current = await getAutomationById(ctx.db, { id, memberId: member.id });
  const schedule = patch.schedule ?? current.schedule;
  const tz = timezoneOf(
    member,
    await getWorkspaceById(ctx.db, { id: member.workspaceId })
  );
  const row = await updateAutomationById(ctx.db, {
    id,
    set: {
      ...patch,
      ...(patch.enabled === true ? { failureCount: 0 } : {}),
      nextRunAt: nextRun(
        schedule,
        tz,
        ctx.now(),
        member.settings,
        jitterFor(id)
      ),
    },
  });
  if (!row) {
    throw notFound("Automation");
  }
  await presenceChanged(ctx, {
    workspaceId: member.workspaceId,
    ownerId: member.id,
  });
  return row;
}

export async function deleteAutomation(
  ctx: AppContext,
  member: Member,
  id: string
) {
  if (!(await deleteAutomationById(ctx.db, { id, memberId: member.id }))) {
    throw notFound("Automation");
  }
  await presenceChanged(ctx, {
    workspaceId: member.workspaceId,
    ownerId: member.id,
  });
}

export async function listRuns(ctx: AppContext, memberId: string, id: string) {
  await getAutomationById(ctx.db, { id, memberId });
  return await listAutomationRuns(ctx.db, { automationId: id });
}

async function addAutomation(
  ctx: AppContext,
  member: Member,
  input: NewAutomation
) {
  if (input.kind === "custom" && !input.instructions) {
    throw badRequest("Custom automations need instructions");
  }
  const tz = timezoneOf(
    member,
    await getWorkspaceById(ctx.db, { id: member.workspaceId })
  );
  const id = generateId();
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
  return await insertAutomation(ctx.db, row);
}
