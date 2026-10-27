import { and, asc, desc, eq, lte, sql } from "drizzle-orm";

import type { DbOrTx } from "#db";
import { automationRuns, automations } from "#db/schema";
import { returned } from "#lib/assert";
import { notFound } from "#lib/errors";

export type Automation = typeof automations.$inferSelect;
export type AutomationRun = typeof automationRuns.$inferSelect;

export async function insertAutomation(
  db: DbOrTx,
  row: typeof automations.$inferInsert
) {
  const rows = await db.insert(automations).values(row).returning();
  return returned(rows, "automation");
}

export async function listAutomations(
  db: DbOrTx,
  params: { memberId: string }
) {
  return await db
    .select()
    .from(automations)
    .where(eq(automations.memberId, params.memberId))
    .orderBy(asc(automations.createdAt));
}

export async function getAutomationById(
  db: DbOrTx,
  params: { id: string; memberId: string }
) {
  const [row] = await db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.id, params.id),
        eq(automations.memberId, params.memberId)
      )
    );
  if (!row) {
    throw notFound("Automation");
  }
  return row;
}

export async function updateAutomationById(
  db: DbOrTx,
  params: {
    id: string;
    set: Partial<
      Omit<Automation, "id" | "workspaceId" | "memberId" | "kind" | "createdAt">
    >;
  }
) {
  const [row] = await db
    .update(automations)
    .set(params.set)
    .where(eq(automations.id, params.id))
    .returning();
  return row;
}

export async function deleteAutomationById(
  db: DbOrTx,
  params: { id: string; memberId: string }
) {
  const rows = await db
    .delete(automations)
    .where(
      and(
        eq(automations.id, params.id),
        eq(automations.memberId, params.memberId)
      )
    )
    .returning({ id: automations.id });
  return rows.length > 0;
}

export async function listDueAutomations(
  db: DbOrTx,
  params: { now: Date; limit: number }
) {
  return await db
    .select()
    .from(automations)
    .where(
      and(eq(automations.enabled, true), lte(automations.nextRunAt, params.now))
    )
    .orderBy(asc(automations.nextRunAt))
    .limit(params.limit);
}

// Never pushes the check later than it already was.
export async function setCheckDueBy(
  db: DbOrTx,
  params: { memberId: string; at: Date }
) {
  await db
    .update(automations)
    .set({
      nextRunAt: sql`least(${automations.nextRunAt}, ${params.at.toISOString()}::timestamptz)`,
    })
    .where(
      and(
        eq(automations.memberId, params.memberId),
        eq(automations.kind, "check"),
        eq(automations.enabled, true)
      )
    );
}

export async function insertAutomationRun(
  db: DbOrTx,
  row: typeof automationRuns.$inferInsert
) {
  await db.insert(automationRuns).values(row);
}

export async function listAutomationRuns(
  db: DbOrTx,
  params: { automationId: string }
) {
  return await db
    .select()
    .from(automationRuns)
    .where(eq(automationRuns.automationId, params.automationId))
    .orderBy(desc(automationRuns.startedAt))
    .limit(50);
}
