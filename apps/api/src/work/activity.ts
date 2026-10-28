import type { AppContext } from "#context";
import {
  findCoalescingActivity,
  insertActivity,
  updateActivityById,
} from "#db/queries/activities";
import type { ActivityRow } from "#db/queries/activities";
import { updateCardById } from "#db/queries/cards";
import type { Visibility } from "#db/schema";
import { transact } from "#db/transact";
import { newId } from "#lib/ids";

export type ActivityInput = {
  /** Chosen by the caller when something written before it must point at it. */
  id?: string;
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
// The card's entropy clock resets in the same transaction: a retry after a failed reset would find
// the activity already recorded and never reset it.
export async function recordActivity(
  ctx: AppContext,
  input: ActivityInput
): Promise<(ActivityRow & { merged?: boolean }) | null> {
  return await transact(ctx, async (tx) => {
    const occurredAt = input.occurredAt ?? tx.now();
    if (input.coalesce) {
      const merged = await mergeInto(tx, input, input.coalesce, occurredAt);
      if (merged) {
        return merged;
      }
    }
    const created = await insertActivity(
      tx.db,
      newActivity(input, occurredAt, tx.now())
    );
    if (!created) {
      return null;
    }
    if (created.cardId) {
      await updateCardById(tx.db, {
        id: created.cardId,
        set: { lastActiveAt: created.occurredAt },
      });
    }
    await announce(tx, created, "activity.created");
    return created;
  });
}

function newActivity(
  input: ActivityInput,
  occurredAt: Date,
  now: Date
): ActivityRow {
  return {
    id: input.id ?? newId("act"),
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
  const existing = await findCoalescingActivity(ctx.db, {
    workspaceId: input.workspaceId,
    coalesceKey: key,
    since: new Date(occurredAt.getTime() - windowMinutes * 60_000),
  });
  if (!existing) {
    return null;
  }
  const total = Number(existing.data.units ?? existing.count) + units;
  const body = [existing.body, input.body].filter(Boolean).join("\n");
  const row = await updateActivityById(ctx.db, {
    id: existing.id,
    set: {
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
    },
  });
  if (row.cardId) {
    await updateCardById(ctx.db, {
      id: row.cardId,
      set: { lastActiveAt: occurredAt },
    });
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
