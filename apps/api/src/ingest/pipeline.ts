import { and, asc, count, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { recordActivity } from "../activity/service";
import type { AppContext } from "../context";
import { activities, connections, identities, inboundEvents, members } from "../db/schema";
import { enqueue, registerJob } from "../jobs/queue";
import { newId } from "../lib/ids";
import { getConnector } from "../connectors/registry";
import { applyAgentState, applyBoardEffects, applySignals, findCardIds } from "./effects";
import { resolveActor } from "./identity";
import { gate, type QualitySettings } from "./quality";
import type { ConnectionView, Connector, InboundRequest, WorklogEvent } from "./types";

type ConnectionRow = typeof connections.$inferSelect;
type Outcome = { kept: number; merged: number; dropped: { id: string; reason: string }[]; duplicates: number; ignored?: string };

export function viewOf(ctx: AppContext, conn: ConnectionRow): ConnectionView {
  return {
    id: conn.id,
    workspaceId: conn.workspaceId,
    provider: conn.provider,
    settings: conn.settings,
    secrets: ctx.secrets.open<Record<string, string>>(conn.secrets),
  };
}

// ---------------------------------------------------------------------------
// 1. Receive: authenticate, store raw, acknowledge. Interpretation happens off the request path.
// ---------------------------------------------------------------------------

export async function receive(ctx: AppContext, connectionId: string, req: InboundRequest): Promise<{ status: number; body: unknown }> {
  const [conn] = await ctx.db.select().from(connections).where(eq(connections.id, connectionId));
  const connector = conn ? getConnector(conn.provider) : undefined;
  if (!conn || !connector || conn.status !== "active") return { status: 404, body: { error: "unknown connection" } };
  const view = viewOf(ctx, conn);
  const received = await connector.receive(req, view);

  switch (received.type) {
    case "reject":
      return { status: received.status, body: { error: received.error } };
    case "respond":
      return { status: received.status ?? 200, body: received.body };
    case "interaction":
      return { status: 200, body: await connector.interact!(ctx, view, received.payload, req.channel) };
    case "event": {
      const inserted = await ctx.db
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
      if (!inserted.length) return { status: 200, body: { ok: true, duplicate: true } };
      await ctx.db.update(connections).set({ lastEventAt: req.receivedAt }).where(eq(connections.id, conn.id));
      // One connection's deliveries are processed in order (merging and thread state depend on it).
      await enqueue(ctx, "ingest.process", { inboundEventId: inserted[0]!.id }, { orderingKey: `ingest:${conn.id}` });
      ctx.kickQueue?.();
      return { status: 200, body: { ok: true } };
    }
  }
}

/** Code integrations push canonical events straight into the same pipeline (POST /v1/connections/{id}/events). */
export async function receivePushed(ctx: AppContext, conn: ConnectionRow, deliveryId: string, events: unknown[]) {
  const inserted = await ctx.db
    .insert(inboundEvents)
    .values({ id: newId("inb"), workspaceId: conn.workspaceId, connectionId: conn.id, deliveryId, eventType: "worklog.events", payload: { events }, receivedAt: ctx.now() })
    .onConflictDoNothing()
    .returning({ id: inboundEvents.id });
  if (!inserted.length) return { duplicate: true };
  await enqueue(ctx, "ingest.process", { inboundEventId: inserted[0]!.id }, { orderingKey: `ingest:${conn.id}` });
  ctx.kickQueue?.();
  return { duplicate: false, inboundEventId: inserted[0]!.id };
}

// ---------------------------------------------------------------------------
// 2. Process: normalize → gate → resolve identity → link cards → merge bursts → persist → effects
// ---------------------------------------------------------------------------

export async function processInbound(ctx: AppContext, inboundEventId: string, opts: { replay?: boolean } = {}) {
  const [inbound] = await ctx.db.select().from(inboundEvents).where(eq(inboundEvents.id, inboundEventId));
  if (!inbound) return;
  const [conn] = await ctx.db.select().from(connections).where(eq(connections.id, inbound.connectionId));
  const connector = conn ? getConnector(conn.provider) : undefined;
  if (!conn || !connector) return;
  const view = viewOf(ctx, conn);

  try {
    const normalized = connector.normalize({ eventType: inbound.eventType, payload: inbound.payload, receivedAt: inbound.receivedAt }, view);
    const outcome: Outcome = { kept: 0, merged: 0, dropped: [], duplicates: 0, ignored: normalized.ignored };
    for (const event of normalized.events) await ingestEvent(ctx, connector, view, inbound.id, event, outcome, opts);
    const status = outcome.kept + outcome.merged > 0 || normalized.events.some((e) => e.hidden || e.signals?.length) ? "processed" : "ignored";
    await ctx.db
      .update(inboundEvents)
      .set({ status, outcome, error: null, attempts: sql`${inboundEvents.attempts} + 1`, processedAt: ctx.now() })
      .where(eq(inboundEvents.id, inbound.id));
  } catch (err) {
    await ctx.db
      .update(inboundEvents)
      .set({ status: "failed", error: err instanceof Error ? err.message : String(err), attempts: sql`${inboundEvents.attempts} + 1` })
      .where(eq(inboundEvents.id, inbound.id));
    throw err; // the queue retries with backoff
  }
}

async function ingestEvent(ctx: AppContext, connector: Connector, conn: ConnectionView, inboundId: string, event: WorklogEvent, outcome: Outcome, opts: { replay?: boolean }) {
  const namespace = connector.identityNamespace(conn);
  if (event.op === "delete" || event.op === "update") {
    await applyRevision(ctx, conn, event, outcome);
    return;
  }
  const resolved = event.actor ? await resolveActor(ctx, conn.workspaceId, namespace, event.actor, event.occurredAt) : null;
  const [actor] = resolved?.memberId ? await ctx.db.select().from(members).where(eq(members.id, resolved.memberId)) : [];
  // An account linked to a Worklog agent is a teammate, not bot noise.
  const isBot = (resolved?.isBot ?? false) && actor?.kind !== "agent";
  const verdict = gate(event, isBot, conn.settings as QualitySettings);
  if (!verdict.keep) {
    outcome.dropped.push({ id: event.id, reason: verdict.reason });
    return;
  }
  const scope = {
    workspaceId: conn.workspaceId,
    namespace,
    boardId: typeof conn.settings.boardId === "string" ? conn.settings.boardId : undefined,
    source: conn.provider,
  };

  const touched = !opts.replay && event.board?.length ? await applyBoardEffects(ctx, scope, event.board, actor ?? null, event.occurredAt) : [];
  const cardId = (await findCardIds(ctx, conn.workspaceId, event.cardRefs))[0] ?? touched[0] ?? null;
  const onBehalfOf = event.agent?.onBehalfOf ? await resolveActor(ctx, conn.workspaceId, namespace, event.agent.onBehalfOf, event.occurredAt) : null;

  let activityId: string | null = null;
  if (!event.hidden) {
    const row = await recordActivity(ctx, {
      workspaceId: conn.workspaceId,
      actorId: resolved?.memberId ?? null,
      actorIdentityId: resolved?.identityId ?? null,
      source: conn.provider,
      kind: event.kind,
      title: event.title,
      body: event.body,
      url: event.url ?? event.object?.url ?? null,
      cardId,
      visibility: event.visibility,
      externalId: event.id,
      occurredAt: event.occurredAt,
      connectionId: conn.id,
      inboundEventId: inboundId,
      onBehalfOfId: onBehalfOf?.memberId ?? null,
      agentState: event.agent?.state ?? null,
      threadKey: event.thread ?? null,
      importance: verdict.importance,
      coalesce: event.coalesce,
      data: {
        ...event.data,
        schema: 1,
        object: event.object ?? undefined,
        container: event.container ?? undefined,
        externalActor: event.actor && !resolved?.memberId ? { handle: event.actor.handle, name: event.actor.name } : undefined,
      },
    });
    if (!row) outcome.duplicates++;
    else if (row.merged) outcome.merged++;
    else outcome.kept++;
    activityId = row?.id ?? null;
  }
  if (opts.replay) return;

  await applySignals(ctx, scope, event, { actor: actor ?? null, actorIsBot: isBot, activityId, cardId });
  if (event.agent?.state) {
    await applyAgentState(ctx, {
      workspaceId: conn.workspaceId,
      agentName: actor?.name ?? event.actor?.name ?? "An agent",
      onBehalfOfId: onBehalfOf?.memberId ?? null,
      state: event.agent.state,
      title: event.title,
      url: event.url ?? null,
      activityId,
      thread: event.thread ?? event.id,
      agentId: actor?.id ?? null,
    });
  }
}

/** Edits and deletions at the source (a Slack message edited or deleted) are applied — deletions especially. */
async function applyRevision(ctx: AppContext, conn: ConnectionView, event: WorklogEvent, outcome: Outcome) {
  const where = and(eq(activities.workspaceId, conn.workspaceId), eq(activities.source, conn.provider), eq(activities.externalId, event.id));
  if (event.op === "delete") {
    const removed = await ctx.db.delete(activities).where(where).returning({ id: activities.id });
    outcome.dropped.push({ id: event.id, reason: removed.length ? "deleted at the source" : "deleted at the source (nothing recorded)" });
    return;
  }
  const updated = await ctx.db
    .update(activities)
    .set({ title: event.title, body: event.body?.slice(0, 4000) ?? null, updatedAt: event.occurredAt })
    .where(and(where, eq(activities.count, 1)))
    .returning({ id: activities.id });
  if (updated.length) outcome.merged++;
  else outcome.dropped.push({ id: event.id, reason: "edit of something not recorded" });
}

registerJob("ingest.process", async (ctx, payload) => processInbound(ctx, String(payload.inboundEventId)));

// ---------------------------------------------------------------------------
// 3. Replay: rebuild a connection's activity from the raw inbox after fixing a connector.
//    Side effects (attention, board) are not re-run.
// ---------------------------------------------------------------------------

export async function replayConnection(ctx: AppContext, workspaceId: string, connectionId: string, since?: Date) {
  const where = and(eq(inboundEvents.connectionId, connectionId), eq(inboundEvents.workspaceId, workspaceId), since ? gte(inboundEvents.receivedAt, since) : undefined);
  const raw = await ctx.db.select({ id: inboundEvents.id }).from(inboundEvents).where(where).orderBy(asc(inboundEvents.receivedAt));
  const removed = await ctx.db
    .delete(activities)
    .where(and(eq(activities.connectionId, connectionId), since ? gte(activities.occurredAt, since) : undefined))
    .returning({ id: activities.id });
  for (const r of raw) await processInbound(ctx, r.id, { replay: true });
  return { reprocessed: raw.length, rebuiltFrom: removed.length };
}

registerJob("ingest.replay", async (ctx, payload) => {
  await replayConnection(ctx, String(payload.workspaceId), String(payload.connectionId), payload.since ? new Date(String(payload.since)) : undefined);
});

// ---------------------------------------------------------------------------
// 4. Health: is this connection producing signal, and why was anything dropped?
// ---------------------------------------------------------------------------

export async function connectionHealth(ctx: AppContext, conn: ConnectionRow, days = 7) {
  const since = new Date(ctx.now().getTime() - days * 86_400_000);
  const connector = getConnector(conn.provider);
  const [byStatus, recent, unlinked, failures] = await Promise.all([
    ctx.db
      .select({ status: inboundEvents.status, n: count() })
      .from(inboundEvents)
      .where(and(eq(inboundEvents.connectionId, conn.id), gte(inboundEvents.receivedAt, since)))
      .groupBy(inboundEvents.status),
    ctx.db
      .select({ outcome: inboundEvents.outcome })
      .from(inboundEvents)
      .where(and(eq(inboundEvents.connectionId, conn.id), gte(inboundEvents.receivedAt, since)))
      .limit(2000),
    connector
      ? ctx.db
          .select({ n: count() })
          .from(identities)
          .where(and(eq(identities.workspaceId, conn.workspaceId), eq(identities.provider, connector.identityNamespace(viewOf(ctx, conn))), isNull(identities.memberId)))
      : Promise.resolve([{ n: 0 }]),
    ctx.db
      .select({ at: inboundEvents.receivedAt, error: inboundEvents.error, eventType: inboundEvents.eventType })
      .from(inboundEvents)
      .where(and(eq(inboundEvents.connectionId, conn.id), eq(inboundEvents.status, "failed")))
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
    if (o.ignored) reasons.set(o.ignored, (reasons.get(o.ignored) ?? 0) + 1);
    for (const d of o.dropped ?? []) reasons.set(d.reason, (reasons.get(d.reason) ?? 0) + 1);
  }
  const statuses = Object.fromEntries(byStatus.map((s) => [s.status, Number(s.n)]));
  return {
    days,
    lastEventAt: conn.lastEventAt?.toISOString() ?? null,
    deliveries: statuses as Record<string, number>,
    activities: { kept, merged },
    /** Share of deliveries that became (or merged into) activity — low isn't bad; it means noise was filtered. */
    signalRate: recent.length ? (kept + merged) / recent.length : null,
    topSkipReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([reason, n]) => ({ reason, count: n })),
    unlinkedIdentities: Number(unlinked[0]?.n ?? 0),
    recentFailures: failures.map((f) => ({ at: f.at.toISOString(), eventType: f.eventType, error: f.error })),
  };
}
