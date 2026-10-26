import { and, asc, count, desc, eq, gte, isNull, sql } from "drizzle-orm";

import { recordActivity } from "../activity/service";
import { getConnector } from "../connectors/registry";
import type { AppContext } from "../context";
import {
  activities,
  connections,
  identities,
  inboundEvents,
  members,
} from "../db/schema";
import { enqueue, registerJob } from "../jobs/queue";
import { newId } from "../lib/ids";
import {
  applyAgentState,
  applyBoardEffects,
  applySignals,
  findCardIds,
} from "./effects";
import { resolveActor } from "./identity";
import { gate } from "./quality";
import type { ConnectionView, InboundRequest, WorklogEvent } from "./types";

type ConnectionRow = typeof connections.$inferSelect;
type Member = typeof members.$inferSelect;
type Outcome = {
  kept: number;
  merged: number;
  dropped: { id: string; reason: string }[];
  duplicates: number;
  ignored?: string;
};

export function viewOf(ctx: AppContext, conn: ConnectionRow): ConnectionView {
  return {
    id: conn.id,
    workspaceId: conn.workspaceId,
    provider: conn.provider,
    settings: conn.settings,
    secrets: ctx.secrets.open(conn.secrets),
  };
}

export async function receive(
  ctx: AppContext,
  connectionId: string,
  req: InboundRequest
): Promise<{ status: number; body: unknown }> {
  const [conn] = await ctx.db
    .select()
    .from(connections)
    .where(eq(connections.id, connectionId));
  const connector = conn ? getConnector(conn.provider) : undefined;
  if (!conn || !connector || conn.status !== "active") {
    return { status: 404, body: { error: "unknown connection" } };
  }
  const view = viewOf(ctx, conn);
  const received = await connector.receive(req, view);

  if (received.type === "reject") {
    return { status: received.status, body: { error: received.error } };
  }
  if (received.type === "respond") {
    return { status: received.status ?? 200, body: received.body };
  }
  if (received.type === "interaction") {
    if (!connector.interact) {
      throw new Error(
        `The ${connector.id} connector received an interaction but can't answer it`
      );
    }
    return {
      status: 200,
      body: await connector.interact(ctx, view, received.payload, req.channel),
    };
  }
  const [stored] = await ctx.db
    .insert(inboundEvents)
    .values({
      id: newId("inb"),
      workspaceId: conn.workspaceId,
      connectionId: conn.id,
      deliveryId: received.deliveryId,
      eventType: received.eventType,
      payload: received.payload,
      receivedAt: req.receivedAt,
    })
    .onConflictDoNothing()
    .returning({ id: inboundEvents.id });
  if (!stored) {
    return { status: 200, body: { ok: true, duplicate: true } };
  }
  await ctx.db
    .update(connections)
    .set({ lastEventAt: req.receivedAt })
    .where(eq(connections.id, conn.id));
  // One connection's deliveries are processed in order (merging and thread state depend on it).
  await enqueue(
    ctx,
    "ingest.process",
    { inboundEventId: stored.id },
    { orderingKey: `ingest:${conn.id}` }
  );
  ctx.kickQueue?.();
  return { status: 200, body: { ok: true } };
}

export async function receivePushed(
  ctx: AppContext,
  conn: ConnectionRow,
  deliveryId: string,
  events: unknown[]
) {
  const [stored] = await ctx.db
    .insert(inboundEvents)
    .values({
      id: newId("inb"),
      workspaceId: conn.workspaceId,
      connectionId: conn.id,
      deliveryId,
      eventType: "worklog.events",
      payload: { events },
      receivedAt: ctx.now(),
    })
    .onConflictDoNothing()
    .returning({ id: inboundEvents.id });
  if (!stored) {
    return { duplicate: true };
  }
  await enqueue(
    ctx,
    "ingest.process",
    { inboundEventId: stored.id },
    { orderingKey: `ingest:${conn.id}` }
  );
  ctx.kickQueue?.();
  return { duplicate: false, inboundEventId: stored.id };
}

export async function processInbound(
  ctx: AppContext,
  inboundEventId: string,
  { replay = false }: { replay?: boolean } = {}
) {
  const [inbound] = await ctx.db
    .select()
    .from(inboundEvents)
    .where(eq(inboundEvents.id, inboundEventId));
  if (!inbound) {
    return;
  }
  const [conn] = await ctx.db
    .select()
    .from(connections)
    .where(eq(connections.id, inbound.connectionId));
  const connector = conn ? getConnector(conn.provider) : undefined;
  if (!conn || !connector) {
    return;
  }
  const view = viewOf(ctx, conn);

  try {
    const normalized = connector.normalize(
      {
        eventType: inbound.eventType,
        payload: inbound.payload,
        receivedAt: inbound.receivedAt,
      },
      view
    );
    const outcome: Outcome = {
      kept: 0,
      merged: 0,
      dropped: [],
      duplicates: 0,
      ignored: normalized.ignored,
    };
    const source = {
      conn: view,
      namespace: connector.identityNamespace(view),
      inboundId: inbound.id,
      replay,
    };
    for (const event of normalized.events) {
      await ingestEvent(ctx, source, event, outcome);
    }
    const status =
      outcome.kept + outcome.merged > 0 || normalized.events.some(actsOnPeople)
        ? "processed"
        : "ignored";
    await ctx.db
      .update(inboundEvents)
      .set({
        status,
        outcome,
        error: null,
        attempts: sql`${inboundEvents.attempts} + 1`,
        processedAt: ctx.now(),
      })
      .where(eq(inboundEvents.id, inbound.id));
  } catch (error) {
    await ctx.db
      .update(inboundEvents)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        attempts: sql`${inboundEvents.attempts} + 1`,
      })
      .where(eq(inboundEvents.id, inbound.id));
    // The queue retries with backoff.
    throw error;
  }
}

/** Hidden events and signals still did something (a nudge, a board change), even with no activity. */
function actsOnPeople(event: WorklogEvent) {
  return event.hidden === true || (event.signals ?? []).length > 0;
}

type Source = {
  conn: ConnectionView;
  namespace: string;
  inboundId: string;
  /** Rebuilding activity: board effects and signals already happened and aren't re-run. */
  replay: boolean;
};

/** `member` is null unless the identity is linked. */
type Who = {
  resolved: Awaited<ReturnType<typeof resolveActor>> | null;
  member: Member | null;
  /** Bots are quiet by default; an account linked to a Worklog agent is a teammate, not bot noise. */
  isBot: boolean;
};

async function ingestEvent(
  ctx: AppContext,
  source: Source,
  event: WorklogEvent,
  outcome: Outcome
) {
  if (event.op === "delete" || event.op === "update") {
    await applyRevision(ctx, source.conn, event, outcome);
    return;
  }
  const who = await identify(ctx, source, event.actor, event.occurredAt);
  const verdict = gate(event, who.isBot, source.conn.settings);
  if (!verdict.keep) {
    outcome.dropped.push({ id: event.id, reason: verdict.reason });
    return;
  }
  const scope = scopeOf(source);
  const cardId = await linkCard(ctx, scope, source, event, who.member);
  const onBehalfOf = event.agent?.onBehalfOf
    ? await resolveActor(
        ctx,
        scope.workspaceId,
        scope.namespace,
        event.agent.onBehalfOf,
        event.occurredAt
      )
    : null;
  const onBehalfOfId = onBehalfOf?.memberId ?? null;

  const activityId =
    event.hidden === true
      ? null
      : await persist(ctx, source, event, outcome, {
          who,
          cardId,
          onBehalfOfId,
          importance: verdict.importance,
        });
  if (source.replay) {
    return;
  }
  await notify(ctx, scope, event, { who, cardId, onBehalfOfId, activityId });
}

async function identify(
  ctx: AppContext,
  source: Source,
  actor: WorklogEvent["actor"],
  at: Date
): Promise<Who> {
  if (!actor) {
    return { resolved: null, member: null, isBot: false };
  }
  const resolved = await resolveActor(
    ctx,
    source.conn.workspaceId,
    source.namespace,
    actor,
    at
  );
  const [member] = resolved.memberId
    ? await ctx.db
        .select()
        .from(members)
        .where(eq(members.id, resolved.memberId))
    : [];
  return {
    resolved,
    member: member ?? null,
    isBot: resolved.isBot && member?.kind !== "agent",
  };
}

function scopeOf(source: Source) {
  const { boardId } = source.conn.settings;
  return {
    workspaceId: source.conn.workspaceId,
    namespace: source.namespace,
    boardId: typeof boardId === "string" ? boardId : undefined,
    source: source.conn.provider,
  };
}

/** Effects run before card refs so the activity can link to the card they create. */
async function linkCard(
  ctx: AppContext,
  scope: ReturnType<typeof scopeOf>,
  source: Source,
  event: WorklogEvent,
  actor: Member | null
) {
  const touched =
    !source.replay && event.board && event.board.length > 0
      ? await applyBoardEffects(
          ctx,
          scope,
          event.board,
          actor,
          event.occurredAt
        )
      : [];
  const [referenced] = await findCardIds(
    ctx,
    scope.workspaceId,
    event.cardRefs
  );
  return referenced ?? touched[0] ?? null;
}

async function persist(
  ctx: AppContext,
  source: Source,
  event: WorklogEvent,
  outcome: Outcome,
  links: {
    who: Who;
    cardId: string | null;
    onBehalfOfId: string | null;
    importance: number;
  }
) {
  const row = await recordActivity(ctx, {
    workspaceId: source.conn.workspaceId,
    actorId: links.who.resolved?.memberId ?? null,
    actorIdentityId: links.who.resolved?.identityId ?? null,
    source: source.conn.provider,
    kind: event.kind,
    title: event.title,
    body: event.body,
    url: event.url ?? event.object?.url ?? null,
    cardId: links.cardId,
    visibility: event.visibility,
    externalId: event.id,
    occurredAt: event.occurredAt,
    connectionId: source.conn.id,
    inboundEventId: source.inboundId,
    onBehalfOfId: links.onBehalfOfId,
    agentState: event.agent?.state ?? null,
    threadKey: event.thread ?? null,
    importance: links.importance,
    coalesce: event.coalesce,
    data: activityData(event, links.who),
  });
  if (!row) {
    outcome.duplicates += 1;
    return null;
  }
  if (row.merged === true) {
    outcome.merged += 1;
  } else {
    outcome.kept += 1;
  }
  return row.id;
}

function activityData(event: WorklogEvent, who: Who) {
  return {
    ...event.data,
    schema: 1,
    object: event.object ?? undefined,
    container: event.container ?? undefined,
    externalActor:
      event.actor && !who.resolved?.memberId
        ? { handle: event.actor.handle, name: event.actor.name }
        : undefined,
  };
}

async function notify(
  ctx: AppContext,
  scope: ReturnType<typeof scopeOf>,
  event: WorklogEvent,
  links: {
    who: Who;
    cardId: string | null;
    onBehalfOfId: string | null;
    activityId: string | null;
  }
) {
  const { member } = links.who;
  await applySignals(ctx, scope, event, {
    actor: member,
    actorIsBot: links.who.isBot,
    activityId: links.activityId,
    cardId: links.cardId,
  });
  if (event.agent?.state) {
    await applyAgentState(ctx, {
      workspaceId: scope.workspaceId,
      agentName: member?.name ?? event.actor?.name ?? "An agent",
      onBehalfOfId: links.onBehalfOfId,
      state: event.agent.state,
      title: event.title,
      url: event.url ?? null,
      activityId: links.activityId,
      thread: event.thread ?? event.id,
      agentId: member?.id ?? null,
    });
  }
}

async function applyRevision(
  ctx: AppContext,
  conn: ConnectionView,
  event: WorklogEvent,
  outcome: Outcome
) {
  const where = and(
    eq(activities.workspaceId, conn.workspaceId),
    eq(activities.source, conn.provider),
    eq(activities.externalId, event.id)
  );
  if (event.op === "delete") {
    const removed = await ctx.db
      .delete(activities)
      .where(where)
      .returning({ id: activities.id });
    outcome.dropped.push({
      id: event.id,
      reason:
        removed.length > 0
          ? "deleted at the source"
          : "deleted at the source (nothing recorded)",
    });
    return;
  }
  const updated = await ctx.db
    .update(activities)
    .set({
      title: event.title,
      body: event.body?.slice(0, 4000) ?? null,
      updatedAt: event.occurredAt,
    })
    .where(and(where, eq(activities.count, 1)))
    .returning({ id: activities.id });
  if (updated.length > 0) {
    outcome.merged += 1;
  } else {
    outcome.dropped.push({
      id: event.id,
      reason: "edit of something not recorded",
    });
  }
}

registerJob("ingest.process", async (ctx, payload) => {
  await processInbound(ctx, String(payload.inboundEventId));
});

export async function replayConnection(
  ctx: AppContext,
  workspaceId: string,
  connectionId: string,
  since?: Date
) {
  const where = and(
    eq(inboundEvents.connectionId, connectionId),
    eq(inboundEvents.workspaceId, workspaceId),
    since ? gte(inboundEvents.receivedAt, since) : undefined
  );
  const raw = await ctx.db
    .select({ id: inboundEvents.id })
    .from(inboundEvents)
    .where(where)
    .orderBy(asc(inboundEvents.receivedAt));
  const removed = await ctx.db
    .delete(activities)
    .where(
      and(
        eq(activities.connectionId, connectionId),
        since ? gte(activities.occurredAt, since) : undefined
      )
    )
    .returning({ id: activities.id });
  for (const r of raw) {
    await processInbound(ctx, r.id, { replay: true });
  }
  return { reprocessed: raw.length, rebuiltFrom: removed.length };
}

registerJob("ingest.replay", async (ctx, payload) => {
  await replayConnection(
    ctx,
    String(payload.workspaceId),
    String(payload.connectionId),
    typeof payload.since === "string" ? new Date(payload.since) : undefined
  );
});

export async function connectionHealth(
  ctx: AppContext,
  conn: ConnectionRow,
  days = 7
) {
  const since = new Date(ctx.now().getTime() - days * 86_400_000);
  const connector = getConnector(conn.provider);
  const [byStatus, recent, unlinked, failures] = await Promise.all([
    ctx.db
      .select({ status: inboundEvents.status, n: count() })
      .from(inboundEvents)
      .where(
        and(
          eq(inboundEvents.connectionId, conn.id),
          gte(inboundEvents.receivedAt, since)
        )
      )
      .groupBy(inboundEvents.status),
    ctx.db
      .select({ outcome: inboundEvents.outcome })
      .from(inboundEvents)
      .where(
        and(
          eq(inboundEvents.connectionId, conn.id),
          gte(inboundEvents.receivedAt, since)
        )
      )
      .limit(2000),
    connector
      ? ctx.db
          .select({ n: count() })
          .from(identities)
          .where(
            and(
              eq(identities.workspaceId, conn.workspaceId),
              eq(
                identities.provider,
                connector.identityNamespace(viewOf(ctx, conn))
              ),
              isNull(identities.memberId)
            )
          )
      : Promise.resolve([{ n: 0 }]),
    ctx.db
      .select({
        at: inboundEvents.receivedAt,
        error: inboundEvents.error,
        eventType: inboundEvents.eventType,
      })
      .from(inboundEvents)
      .where(
        and(
          eq(inboundEvents.connectionId, conn.id),
          eq(inboundEvents.status, "failed")
        )
      )
      .orderBy(desc(inboundEvents.receivedAt))
      .limit(5),
  ]);
  const reasons = new Map<string, number>();
  let kept = 0;
  let merged = 0;
  for (const { outcome } of recent) {
    const o = (outcome ?? {}) as Partial<Outcome>;
    kept += o.kept ?? 0;
    merged += o.merged ?? 0;
    if (o.ignored) {
      reasons.set(o.ignored, (reasons.get(o.ignored) ?? 0) + 1);
    }
    for (const d of o.dropped ?? []) {
      reasons.set(d.reason, (reasons.get(d.reason) ?? 0) + 1);
    }
  }
  const statuses: Record<string, number> = Object.fromEntries(
    byStatus.map((s) => [s.status, s.n])
  );
  return {
    days,
    lastEventAt: conn.lastEventAt?.toISOString() ?? null,
    deliveries: statuses,
    activities: { kept, merged },
    /** Low isn't bad: it means noise was filtered. */
    signalRate: recent.length ? (kept + merged) / recent.length : null,
    topSkipReasons: [...reasons.entries()]
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([reason, n]) => ({ reason, count: n })),
    unlinkedIdentities: unlinked[0]?.n ?? 0,
    recentFailures: failures.map((f) => ({
      at: f.at.toISOString(),
      eventType: f.eventType,
      error: f.error,
    })),
  };
}
