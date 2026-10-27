import { and, desc, eq, gte, ilike, inArray, lt, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { DbOrTx } from "#db";
import { activities } from "#db/schema";
import { returned } from "#lib/assert";

export type ActivityRow = typeof activities.$inferSelect;

export type ActivityFilters = {
  actorIds?: string[];
  source?: string;
  kinds?: string[];
  cardId?: string;
  since?: Date;
  until?: Date;
  q?: string;
  /** Cursor: only activities with id < before (ids are time-sortable). */
  before?: string;
  limit?: number;
};

// Undefined when the source's `externalId` was already recorded: re-delivered events are no-ops.
export async function insertActivity(db: DbOrTx, row: ActivityRow) {
  const [created] = await db
    .insert(activities)
    .values(row)
    .onConflictDoNothing()
    .returning();
  return created;
}

export async function findActivityById(db: DbOrTx, params: { id: string }) {
  const [row] = await db
    .select()
    .from(activities)
    .where(eq(activities.id, params.id));
  return row;
}

export async function findCoalescingActivity(
  db: DbOrTx,
  params: { workspaceId: string; coalesceKey: string; since: Date }
) {
  const [row] = await db
    .select()
    .from(activities)
    .where(
      and(
        eq(activities.workspaceId, params.workspaceId),
        eq(activities.coalesceKey, params.coalesceKey),
        gte(activities.updatedAt, params.since)
      )
    )
    .orderBy(desc(activities.updatedAt))
    .limit(1);
  return row;
}

export async function updateActivityById(
  db: DbOrTx,
  params: {
    id: string;
    set: Partial<
      Pick<
        ActivityRow,
        | "title"
        | "body"
        | "kind"
        | "cardId"
        | "count"
        | "data"
        | "importance"
        | "updatedAt"
      >
    >;
  }
) {
  const rows = await db
    .update(activities)
    .set(params.set)
    .where(eq(activities.id, params.id))
    .returning();
  return returned(rows, "activity");
}

// Team-visible activity plus private entries authored by anyone in `privateFor` (the viewer and their personal agent in owner mode).
export async function listActivities(
  db: DbOrTx,
  params: { workspaceId: string; privateFor: string[] } & ActivityFilters
): Promise<ActivityRow[]> {
  const { workspaceId, privateFor, ...filters } = params;
  const where: (SQL | undefined)[] = [
    eq(activities.workspaceId, workspaceId),
    privateFor.length > 0
      ? or(
          eq(activities.visibility, "team"),
          inArray(activities.actorId, privateFor)
        )
      : eq(activities.visibility, "team"),
  ];
  if (filters.actorIds && filters.actorIds.length > 0) {
    where.push(inArray(activities.actorId, filters.actorIds));
  }
  if (filters.source) {
    where.push(eq(activities.source, filters.source));
  }
  if (filters.kinds && filters.kinds.length > 0) {
    where.push(inArray(activities.kind, filters.kinds));
  }
  if (filters.cardId) {
    where.push(eq(activities.cardId, filters.cardId));
  }
  if (filters.since) {
    where.push(gte(activities.occurredAt, filters.since));
  }
  if (filters.until) {
    where.push(lt(activities.occurredAt, filters.until));
  }
  if (filters.before) {
    where.push(lt(activities.id, filters.before));
  }
  if (filters.q) {
    where.push(
      or(
        ilike(activities.title, `%${filters.q}%`),
        ilike(activities.body, `%${filters.q}%`)
      )
    );
  }
  return await db
    .select()
    .from(activities)
    .where(and(...where))
    .orderBy(desc(activities.occurredAt), desc(activities.id))
    .limit(Math.min(filters.limit ?? 50, 500));
}

export async function deleteOwnActivity(
  db: DbOrTx,
  params: { id: string; workspaceId: string; actorId: string }
) {
  const deleted = await db
    .delete(activities)
    .where(
      and(
        eq(activities.id, params.id),
        eq(activities.workspaceId, params.workspaceId),
        eq(activities.actorId, params.actorId)
      )
    )
    .returning();
  return deleted.length > 0;
}

export async function deleteActivityByExternalId(
  db: DbOrTx,
  params: { workspaceId: string; source: string; externalId: string }
) {
  const deleted = await db
    .delete(activities)
    .where(
      and(
        eq(activities.workspaceId, params.workspaceId),
        eq(activities.source, params.source),
        eq(activities.externalId, params.externalId)
      )
    )
    .returning({ id: activities.id });
  return deleted.length;
}

// A merged activity (count > 1) stands for several events, so one event's edit doesn't rewrite it.
export async function updateUnmergedActivity(
  db: DbOrTx,
  params: {
    workspaceId: string;
    source: string;
    externalId: string;
    set: Pick<ActivityRow, "title" | "body" | "updatedAt">;
  }
) {
  const updated = await db
    .update(activities)
    .set(params.set)
    .where(
      and(
        eq(activities.workspaceId, params.workspaceId),
        eq(activities.source, params.source),
        eq(activities.externalId, params.externalId),
        eq(activities.count, 1)
      )
    )
    .returning({ id: activities.id });
  return updated.length;
}

// Replay rebuilds these from the connection's stored deliveries.
export async function deleteConnectionActivities(
  db: DbOrTx,
  params: { connectionId: string; since?: Date }
) {
  const deleted = await db
    .delete(activities)
    .where(
      and(
        eq(activities.connectionId, params.connectionId),
        params.since ? gte(activities.occurredAt, params.since) : undefined
      )
    )
    .returning({ id: activities.id });
  return deleted.length;
}

// Linking an identity re-attributes everything it already did.
export async function updateActivitiesActor(
  db: DbOrTx,
  params: { actorIdentityId: string; actorId: string | null }
) {
  const updated = await db
    .update(activities)
    .set({ actorId: params.actorId })
    .where(eq(activities.actorIdentityId, params.actorIdentityId))
    .returning({ id: activities.id });
  return updated.length;
}
