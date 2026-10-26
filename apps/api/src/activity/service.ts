import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  or,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { AppContext } from "#context";
import { activities, cards } from "#db/schema";
import type { Visibility } from "#db/schema";
import { returned } from "#lib/assert";
import { newId } from "#lib/ids";

export type ActivityRow = typeof activities.$inferSelect;

export type ActivityInput = {
  workspaceId: string;
  actorId: string | null;
  source: string;
  kind: string;
  title: string;
  body?: string | null;
  url?: string | null;
  cardId?: string | null;
  visibility?: Visibility;
  /** Dedupe key from the source system; re-delivered events become no-ops. */
  externalId?: string | null;
  data?: Record<string, unknown>;
  occurredAt?: Date;
  connectionId?: string | null;
  inboundEventId?: string | null;
  actorIdentityId?: string | null;
  onBehalfOfId?: string | null;
  agentState?: ActivityRow["agentState"];
  threadKey?: string | null;
  importance?: number;
  coalesce?: {
    key: string;
    windowMinutes: number;
    units: number;
    template: string;
  } | null;
};

const MAX_BODY = 4000;

function render(template: string, n: number) {
  return template
    .replaceAll("{n}", String(n))
    .replaceAll("{s}", n === 1 ? "" : "s");
}

function clamp(n: number) {
  return Math.max(0, Math.min(1, n));
}

// Null when the event was already recorded; `merged: true` when folded into an existing activity.
export async function recordActivity(
  ctx: AppContext,
  input: ActivityInput
): Promise<(ActivityRow & { merged?: boolean }) | null> {
  const occurredAt = input.occurredAt ?? ctx.now();
  if (input.coalesce) {
    const merged = await mergeInto(ctx, input, input.coalesce, occurredAt);
    if (merged) {
      return merged;
    }
  }
  const [created] = await ctx.db
    .insert(activities)
    .values(newActivity(input, occurredAt, ctx.now()))
    .onConflictDoNothing()
    .returning();
  if (!created) {
    return null;
  }
  if (created.cardId) {
    await ctx.db
      .update(cards)
      .set({ lastActiveAt: created.occurredAt })
      .where(eq(cards.id, created.cardId));
  }
  await announce(ctx, created, "activity.created");
  return created;
}

function newActivity(
  input: ActivityInput,
  occurredAt: Date,
  now: Date
): ActivityRow {
  return {
    id: newId("act"),
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    source: input.source,
    kind: input.kind,
    title: input.coalesce
      ? render(input.coalesce.template, input.coalesce.units)
      : input.title,
    body: input.body?.slice(0, MAX_BODY) ?? null,
    url: input.url ?? null,
    cardId: input.cardId ?? null,
    visibility: input.visibility ?? "team",
    externalId: input.externalId ?? null,
    data: {
      ...input.data,
      ...(input.coalesce ? { units: input.coalesce.units } : {}),
    },
    connectionId: input.connectionId ?? null,
    inboundEventId: input.inboundEventId ?? null,
    actorIdentityId: input.actorIdentityId ?? null,
    onBehalfOfId: input.onBehalfOfId ?? null,
    agentState: input.agentState ?? null,
    threadKey: input.threadKey ?? null,
    importance: clamp(input.importance ?? 0.5),
    coalesceKey: input.coalesce?.key ?? null,
    count: 1,
    occurredAt,
    updatedAt: occurredAt,
    createdAt: now,
  };
}

async function mergeInto(
  ctx: AppContext,
  input: ActivityInput,
  coalesce: NonNullable<ActivityInput["coalesce"]>,
  occurredAt: Date
) {
  const { key, windowMinutes, units, template } = coalesce;
  const [existing] = await ctx.db
    .select()
    .from(activities)
    .where(
      and(
        eq(activities.workspaceId, input.workspaceId),
        eq(activities.coalesceKey, key),
        gte(
          activities.updatedAt,
          new Date(occurredAt.getTime() - windowMinutes * 60_000)
        )
      )
    )
    .orderBy(desc(activities.updatedAt))
    .limit(1);
  if (!existing) {
    return null;
  }
  const total = Number(existing.data.units ?? existing.count) + units;
  const body = [existing.body, input.body].filter(Boolean).join("\n");
  const row = returned(
    await ctx.db
      .update(activities)
      .set({
        title: render(template, total),
        body:
          body.length > MAX_BODY
            ? `${body.slice(0, MAX_BODY - 1)}…`
            : body || null,
        count: existing.count + 1,
        data: { ...existing.data, units: total },
        importance: clamp(
          Math.max(existing.importance, input.importance ?? 0.5) + 0.05
        ),
        updatedAt: occurredAt,
      })
      .where(eq(activities.id, existing.id))
      .returning(),
    "activity"
  );
  if (row.cardId) {
    await ctx.db
      .update(cards)
      .set({ lastActiveAt: occurredAt })
      .where(eq(cards.id, row.cardId));
  }
  await announce(ctx, row, "activity.updated");
  return { ...row, merged: true };
}

async function announce(
  ctx: AppContext,
  row: ActivityRow,
  type: "activity.created" | "activity.updated"
) {
  await ctx.bus.publish({
    workspaceId: row.workspaceId,
    audienceId: row.visibility === "private" ? row.actorId : null,
    type,
    data: {
      id: row.id,
      kind: row.kind,
      source: row.source,
      actorId: row.actorId,
      title: row.title,
      cardId: row.cardId,
      count: row.count,
    },
  });
}

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

// Team-visible activity plus private entries authored by anyone in `privateFor` (the viewer and their personal agent in owner mode).
export async function listActivities(
  ctx: AppContext,
  workspaceId: string,
  privateFor: string[],
  filters: ActivityFilters = {}
): Promise<ActivityRow[]> {
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
  return await ctx.db
    .select()
    .from(activities)
    .where(and(...where))
    .orderBy(desc(activities.occurredAt), desc(activities.id))
    .limit(Math.min(filters.limit ?? 50, 500));
}

export async function deleteOwnActivity(
  ctx: AppContext,
  workspaceId: string,
  actorId: string,
  id: string
) {
  const deleted = await ctx.db
    .delete(activities)
    .where(
      and(
        eq(activities.id, id),
        eq(activities.workspaceId, workspaceId),
        eq(activities.actorId, actorId)
      )
    )
    .returning();
  return deleted.length > 0;
}

export function unattributed() {
  return isNull(activities.actorId);
}
