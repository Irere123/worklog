import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lt,
  lte,
  or,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { DbOrTx } from "#db";
import { activities, cards, inboundEvents } from "#db/schema";
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

/**
 * The burst an event at `at` belongs to: one whose span, from its first event to its last, comes
 * within `windowMs` of it on either side. History read newest first arrives before what it
 * preceded, so the window looks both ways.
 */
export async function findCoalescingActivity(
  db: DbOrTx,
  params: {
    workspaceId: string;
    coalesceKey: string;
    at: Date;
    windowMs: number;
  }
) {
  const [row] = await db
    .select()
    .from(activities)
    .where(
      and(
        eq(activities.workspaceId, params.workspaceId),
        eq(activities.coalesceKey, params.coalesceKey),
        gte(
          activities.updatedAt,
          new Date(params.at.getTime() - params.windowMs)
        ),
        lte(
          activities.occurredAt,
          new Date(params.at.getTime() + params.windowMs)
        )
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
        | "occurredAt"
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

// The entries memory cites, visible the same way as in `listActivities`; one deleted since is missing.
export async function listActivitiesByIds(
  db: DbOrTx,
  params: { workspaceId: string; ids: string[]; privateFor: string[] }
) {
  if (!params.ids.length) {
    return [];
  }
  return await db
    .select()
    .from(activities)
    .where(
      and(
        eq(activities.workspaceId, params.workspaceId),
        inArray(activities.id, params.ids),
        params.privateFor.length > 0
          ? or(
              eq(activities.visibility, "team"),
              inArray(activities.actorId, params.privateFor)
            )
          : eq(activities.visibility, "team")
      )
    );
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

/**
 * The latest thing each person or agent did since `since`, in one query. Private entries count
 * only for the members in `privateFor`, as in `listActivities`.
 */
export async function listLatestByActor(
  db: DbOrTx,
  params: { workspaceId: string; privateFor: string[]; since: Date }
) {
  return await db
    .selectDistinctOn([activities.actorId], {
      actorId: activities.actorId,
      at: activities.occurredAt,
      kind: activities.kind,
      source: activities.source,
      title: activities.title,
    })
    .from(activities)
    .where(
      and(
        eq(activities.workspaceId, params.workspaceId),
        isNotNull(activities.actorId),
        gte(activities.occurredAt, params.since),
        params.privateFor.length > 0
          ? or(
              eq(activities.visibility, "team"),
              inArray(activities.actorId, params.privateFor)
            )
          : eq(activities.visibility, "team")
      )
    )
    .orderBy(activities.actorId, desc(activities.occurredAt));
}

/**
 * How many of each kind of activity happened since `since`, counted in the database so a busy
 * team's day isn't cut short by a page size. Private entries count only for `privateFor`.
 */
export async function countActivitiesByKind(
  db: DbOrTx,
  params: { workspaceId: string; privateFor: string[]; since: Date }
) {
  return await db
    .select({ kind: activities.kind, count: count() })
    .from(activities)
    .where(
      and(
        eq(activities.workspaceId, params.workspaceId),
        gte(activities.occurredAt, params.since),
        params.privateFor.length > 0
          ? or(
              eq(activities.visibility, "team"),
              inArray(activities.actorId, params.privateFor)
            )
          : eq(activities.visibility, "team")
      )
    )
    .groupBy(activities.kind);
}

/**
 * Where each agent's run stands: the latest of its updates that carry a state (working, needs
 * you, finished, failed) since `since`. Agent updates are team-visible work.
 */
export async function listAgentStates(
  db: DbOrTx,
  params: { workspaceId: string; since: Date }
) {
  return await db
    .selectDistinctOn([activities.actorId], {
      actorId: activities.actorId,
      state: activities.agentState,
      title: activities.title,
      at: activities.occurredAt,
      cardNumber: cards.number,
    })
    .from(activities)
    .leftJoin(cards, eq(cards.id, activities.cardId))
    .where(
      and(
        eq(activities.workspaceId, params.workspaceId),
        eq(activities.visibility, "team"),
        isNotNull(activities.actorId),
        isNotNull(activities.agentState),
        gte(activities.occurredAt, params.since)
      )
    )
    .orderBy(activities.actorId, desc(activities.occurredAt));
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

// Replay rebuilds these from the stored deliveries of one lane, received in the window. Their
// ingested_events entries go with them.
export async function deleteLaneActivities(
  db: DbOrTx,
  params: { connectionId: string; lane: number; since?: Date; until: Date }
) {
  const deliveries = db
    .select({ id: inboundEvents.id })
    .from(inboundEvents)
    .where(
      and(
        eq(inboundEvents.connectionId, params.connectionId),
        eq(inboundEvents.lane, params.lane),
        params.since ? gte(inboundEvents.receivedAt, params.since) : undefined,
        lte(inboundEvents.receivedAt, params.until)
      )
    );
  const deleted = await db
    .delete(activities)
    .where(
      and(
        eq(activities.connectionId, params.connectionId),
        inArray(activities.inboundEventId, deliveries)
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
