import { getConnector } from "#connectors";
import type {
  BoardEffect,
  ConnectionView,
  Connector,
  Normalized,
  WorklogEvent,
} from "#connectors/types";
import type { AppContext } from "#context";
import {
  deleteActivityByExternalId,
  deleteLaneActivities,
  findActivityById,
  updateActivityById,
  updateUnmergedActivity,
} from "#db/queries/activities";
import {
  setOpenAttentionDone,
  updateAttentionText,
} from "#db/queries/attention";
import {
  findConnectionById,
  lockConnectionForWrites,
} from "#db/queries/connections";
import type { ConnectionRow } from "#db/queries/connections";
import type { InboundEvent } from "#db/queries/inbound-events";
import {
  findInboundEventById,
  listInboundEventIds,
  listInboundLanes,
  findNextRetryAt,
  findLiveWaiting,
  listWaitingDeliveries,
  lockWaitingDeliveries,
  updateInboundAttempt,
  updateInboundOutcomes,
} from "#db/queries/inbound-events";
import {
  insertIngestedEventIfNew,
  deleteIngestedEvent,
  findIngestedEvent,
  insertIngestedTombstone,
  setIngestedActivity,
} from "#db/queries/ingested-events";
import type { Member } from "#db/queries/members";
import { transact } from "#db/transact";
import { enqueue } from "#jobs/queue";
import { generateId } from "#lib/ids";
import { HOUR_MS } from "#lib/time";
import { log } from "#telemetry/log";
import { recordActivity } from "#work/activity";

import {
  applyAgentState,
  applyBoardEffects,
  applySignals,
  findCardIds,
} from "./effects";
import type { BoardScope } from "./effects";
import { laneQueue } from "./lanes";
import { resolvePeople } from "./people";
import type { People, Person } from "./people";
import { enqueueDrain } from "./pipeline";
import { gate } from "./quality";
import { retainedSince } from "./retention";
import { viewOf } from "./view";

/**
 * live: everything happens. sync: read back from the provider's API, so only what is recent may
 * notify or add cards; resolving and closing still apply, since they only catch state up.
 * replay: rebuilding activity, so signals and board effects, which already happened, don't run.
 */
export type Mode = "live" | "sync" | "replay";

export type Outcome = {
  kept: number;
  merged: number;
  dropped: { id: string; reason: string }[];
  duplicates: number;
  ignored?: string;
  skipped?: number;
};

type Source = {
  conn: ConnectionView;
  namespace: string;
  inboundId: string;
  mode: Mode;
  people: People;
};

type Effects = {
  raise: boolean;
  onlyIfNew: boolean;
  board: "all" | "state";
};

type Who = Omit<Person, "resolved"> & { resolved: Person["resolved"] | null };

const NOBODY: Who = { resolved: null, member: null, isBot: false };

/** A connection ready to process deliveries with, loaded once per drain. */
type Loaded = { connector: Connector; view: ConnectionView; namespace: string };

const BATCH = 25;
const BUDGET_MS = 20_000;
const MAX_ATTEMPTS = 5;
const STUCK_RETRY_MS = 30_000;

/**
 * Processes everything waiting in one lane, in order. A delivery that fails waits for its own
 * retry with backoff while the lane goes on: one poisoned payload must not stall the events behind
 * it, and the ledger and resolutions make the later retry safe out of order.
 */
export async function drainLane(
  ctx: AppContext,
  connectionId: string,
  lane: number
) {
  const loaded = await load(ctx, connectionId);
  if (!loaded) {
    return;
  }
  const started = Date.now();
  const tried = new Set<string>();
  for (;;) {
    const batch = await listWaitingDeliveries(ctx.db, {
      connectionId,
      lane,
      limit: BATCH,
    });
    const fresh = batch.filter((d) => !tried.has(d.id));
    if (fresh.length === 0) {
      await scheduleNextRetry(ctx, connectionId, lane);
      if (batch.some((d) => d.status === "pending")) {
        await enqueueDrain(
          ctx,
          connectionId,
          lane,
          new Date(ctx.now().getTime() + STUCK_RETRY_MS),
          "stuck"
        );
      }
      return;
    }
    let clean = true;
    let cutIn = false;
    for (const run of runsOf(fresh)) {
      for (const delivery of run) {
        tried.add(delivery.id);
      }
      clean = (await attemptTogether(ctx, loaded, lane, run)) && clean;
      if (
        run[0]?.via === "sync" &&
        (await findLiveWaiting(ctx.db, { connectionId, lane })) !== undefined
      ) {
        cutIn = true;
        break;
      }
    }
    if (
      clean &&
      !cutIn &&
      batch.length < BATCH &&
      batch.every((d) => d.attempts === 0)
    ) {
      await scheduleNextRetry(ctx, connectionId, lane);
      return;
    }
    if (Date.now() - started > BUDGET_MS) {
      await enqueueDrain(ctx, connectionId, lane);
      return;
    }
  }
}

async function scheduleNextRetry(
  ctx: AppContext,
  connectionId: string,
  lane: number
) {
  const next = await findNextRetryAt(ctx.db, { connectionId, lane });
  if (next) {
    await enqueueDrain(ctx, connectionId, lane, next);
  }
}

function runsOf(deliveries: InboundEvent[]) {
  const runs: InboundEvent[][] = [];
  let together: InboundEvent[] = [];
  for (const delivery of deliveries) {
    if (delivery.via !== "sync" && delivery.attempts === 0) {
      together.push(delivery);
    } else {
      if (together.length > 0) {
        runs.push(together);
        together = [];
      }
      runs.push([delivery]);
    }
  }
  if (together.length > 0) {
    runs.push(together);
  }
  return runs;
}

async function attemptTogether(
  ctx: AppContext,
  loaded: Loaded,
  lane: number,
  deliveries: InboundEvent[]
) {
  const [first] = deliveries;
  if (!first || deliveries.length === 1) {
    return first ? await attempt(ctx, loaded, lane, first) : true;
  }
  let people: People | undefined;
  try {
    const prepared = deliveries.map((inbound) => ({
      inbound,
      normalized: normalizeDelivery(loaded, inbound),
    }));
    const named = await resolvePeople(
      ctx,
      loaded.view.workspaceId,
      loaded.namespace,
      prepared.flatMap((p) => p.normalized.events)
    );
    people = named;
    await transact(
      ctx,
      async (tx) => {
        await lockConnectionForWrites(tx.db, { id: loaded.view.id });
        const waiting = await lockWaitingDeliveries(tx.db, {
          ids: deliveries.map((d) => d.id),
        });
        const rows = [];
        for (const { inbound, normalized } of prepared) {
          if (!waiting.has(inbound.id)) {
            continue;
          }
          const done = await ingestDelivery(tx, loaded, {
            inbound,
            normalized,
            people: named,
            mode: "live",
          });
          rows.push({ id: inbound.id, ...done });
        }
        await updateInboundOutcomes(tx.db, { rows, now: tx.now() });
      },
      { durable: false }
    );
    return true;
  } catch (error) {
    log.warn("ingest: deliveries failed together; trying each alone", {
      error,
      connectionId: loaded.view.id,
      lane,
      deliveries: deliveries.length,
    });
    let clean = true;
    for (const delivery of deliveries) {
      clean = (await attempt(ctx, loaded, lane, delivery, people)) && clean;
    }
    return clean;
  }
}

async function attempt(
  ctx: AppContext,
  loaded: Loaded,
  lane: number,
  delivery: InboundEvent,
  people?: People
) {
  const inboundEventId = delivery.id;
  try {
    await processInbound(ctx, delivery, { loaded, people });
    return true;
  } catch (error) {
    const attempts = delivery.attempts + 1;
    await scheduleNextRetry(ctx, loaded.view.id, lane);
    log.error("ingest: delivery failed", {
      error,
      inboundEventId,
      connectionId: loaded.view.id,
      attempt: attempts,
      givingUp: attempts >= MAX_ATTEMPTS,
    });
    return false;
  }
}

function backoff(attempts: number) {
  const base = 10_000 * 2 ** Math.max(0, attempts - 1);
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

/**
 * One delivery in its own transaction (a retry, a page of history, one that failed with others):
 * its events, their effects and its new status commit together, so a delivery is marked done
 * exactly when its effects are in. That makes the commit safe to make without waiting for the
 * disk: lost in a crash, the delivery is still pending and runs again.
 */
export async function processInbound(
  ctx: AppContext,
  ref: string | InboundEvent,
  opts: { replay?: boolean; loaded?: Loaded; people?: People } = {}
) {
  const inbound =
    typeof ref === "string"
      ? await findInboundEventById(ctx.db, { id: ref })
      : ref;
  if (!inbound) {
    return;
  }
  const loaded = opts.loaded ?? (await load(ctx, inbound.connectionId));
  if (!loaded) {
    return;
  }
  if (
    opts.replay !== true &&
    (inbound.status === "processed" || inbound.status === "ignored")
  ) {
    return;
  }
  let mode: Mode = inbound.via === "sync" ? "sync" : "live";
  if (opts.replay === true) {
    mode = "replay";
  }
  try {
    const normalized = normalizeDelivery(loaded, inbound);
    const people =
      opts.people ??
      (await resolvePeople(
        ctx,
        loaded.view.workspaceId,
        loaded.namespace,
        normalized.events
      ));
    await transact(
      ctx,
      async (tx) => {
        await lockConnectionForWrites(tx.db, { id: loaded.view.id });
        if (mode !== "replay") {
          const waiting = await lockWaitingDeliveries(tx.db, {
            ids: [inbound.id],
          });
          if (!waiting.has(inbound.id)) {
            return;
          }
        }
        const done = await ingestDelivery(tx, loaded, {
          inbound,
          normalized,
          people,
          mode,
        });
        await updateInboundAttempt(tx.db, {
          id: inbound.id,
          set: {
            ...done,
            error: null,
            retryAt: null,
            processedAt: tx.now(),
          },
        });
      },
      { durable: false }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (mode === "replay") {
      await updateInboundAttempt(ctx.db, {
        id: inbound.id,
        set: { error: `replay failed: ${message}` },
      });
      throw error;
    }
    const attempts = inbound.attempts + 1;
    await updateInboundAttempt(ctx.db, {
      id: inbound.id,
      set: { status: "failed", error: message },
      retryInMs: attempts >= MAX_ATTEMPTS ? null : backoff(attempts),
    });
    throw error;
  }
}

function normalizeDelivery({ connector, view }: Loaded, inbound: InboundEvent) {
  const normalized = connector.normalize(
    {
      eventType: inbound.eventType,
      payload: inbound.payload,
      receivedAt: inbound.receivedAt,
    },
    view
  );
  return connector.perConnection === true
    ? {
        ...normalized,
        events: normalized.events.map((e) => ({
          ...e,
          id: `${view.id}:${e.id}`,
        })),
      }
    : normalized;
}

async function ingestDelivery(
  tx: AppContext,
  loaded: Loaded,
  delivery: {
    inbound: InboundEvent;
    normalized: Normalized;
    people: People;
    mode: Mode;
  }
) {
  const { inbound, normalized, people, mode } = delivery;
  const outcome: Outcome = {
    kept: 0,
    merged: 0,
    dropped: [],
    duplicates: 0,
    ignored: normalized.ignored,
    skipped: normalized.skipped,
  };
  const source: Source = {
    conn: loaded.view,
    namespace: loaded.namespace,
    inboundId: inbound.id,
    mode,
    people,
  };
  for (const event of normalized.events) {
    await ingestEvent(tx, source, event, outcome);
  }
  const status: "processed" | "ignored" =
    outcome.kept + outcome.merged > 0 || normalized.events.some(actsOnPeople)
      ? "processed"
      : "ignored";
  return { status, outcome };
}

function actsOnPeople(event: WorklogEvent) {
  return event.hidden === true || (event.signals ?? []).length > 0;
}

async function ingestEvent(
  ctx: AppContext,
  source: Source,
  event: WorklogEvent,
  outcome: Outcome
) {
  if (event.op === "delete" || event.op === "update") {
    await applyRevision(ctx, source, event, outcome);
    return;
  }
  const who = (event.actor && source.people.get(event.actor.id)) ?? NOBODY;
  const verdict = gate(event, who.isBot, source.conn.settings);
  if (!verdict.keep) {
    outcome.dropped.push({ id: event.id, reason: verdict.reason });
    if (source.mode !== "replay") {
      await applyState(ctx, source, event, who);
    }
    return;
  }
  const scope = scopeOf(source);
  const effects = effectsFor(ctx, source.mode, event);
  const key = {
    workspaceId: source.conn.workspaceId,
    source: source.conn.provider,
    externalId: event.id,
  };
  await transact(ctx, async (tx) => {
    const planned = event.hidden === true ? null : generateId();
    const claimed = await insertIngestedEventIfNew(tx.db, {
      ...key,
      connectionId: source.conn.id,
      activityId: planned,
    });
    if (!claimed) {
      outcome.duplicates += 1;
      return;
    }
    const cardId = await linkCard(
      tx,
      scope,
      source.mode,
      await withoutAppliedState(tx, source, event),
      { actor: who.member, board: effects.board }
    );
    const onBehalfOf = event.agent?.onBehalfOf;
    const onBehalfOfId =
      (onBehalfOf && source.people.get(onBehalfOf.id)?.resolved.memberId) ??
      null;
    let activityId: string | null = null;
    if (planned) {
      activityId = await persist(tx, source, event, outcome, {
        id: planned,
        who,
        cardId,
        onBehalfOfId,
        importance: verdict.importance,
      });
      if (!activityId) {
        await deleteIngestedEvent(tx.db, key);
        return;
      }
      if (activityId !== planned) {
        await setIngestedActivity(tx.db, { ...key, activityId });
      }
    }
    if (source.mode !== "replay") {
      await notify(tx, scope, event, effects, {
        who,
        cardId,
        onBehalfOfId,
        activityId,
      });
    }
  });
}

async function applyState(
  ctx: AppContext,
  source: Source,
  event: WorklogEvent,
  who: Who
) {
  const resolves = (event.signals ?? []).filter((s) => s.type === "resolve");
  const board = (event.board ?? []).filter(changesState);
  if (resolves.length === 0 && board.length === 0) {
    return;
  }
  const key = {
    workspaceId: source.conn.workspaceId,
    source: source.conn.provider,
    externalId: event.id,
  };
  if (await findIngestedEvent(ctx.db, key)) {
    return;
  }
  const first = await insertIngestedEventIfNew(ctx.db, {
    ...key,
    externalId: stateKey(event),
    connectionId: source.conn.id,
    activityId: null,
  });
  if (!first) {
    return;
  }
  const scope = scopeOf(source);
  if (board.length > 0) {
    await applyBoardEffects(ctx, scope, board, who.member, event.occurredAt);
  }
  await applySignals(
    ctx,
    scope,
    { ...event, signals: resolves },
    {
      actor: who.member,
      actorIsBot: who.isBot,
      activityId: null,
      cardId: null,
      raise: false,
      onlyIfNew: true,
    }
  );
}

function stateKey(event: WorklogEvent) {
  return `state:${event.id}`;
}

function changesState(e: BoardEffect) {
  return e.type === "close_card" || e.type === "reopen_card";
}

async function withoutAppliedState(
  ctx: AppContext,
  source: Source,
  event: WorklogEvent
) {
  if (!(event.board ?? []).some(changesState)) {
    return event;
  }
  const applied = await findIngestedEvent(ctx.db, {
    workspaceId: source.conn.workspaceId,
    source: source.conn.provider,
    externalId: stateKey(event),
  });
  return applied
    ? { ...event, board: (event.board ?? []).filter((e) => !changesState(e)) }
    : event;
}

function effectsFor(ctx: AppContext, mode: Mode, event: WorklogEvent) {
  if (mode !== "sync") {
    return { raise: true, onlyIfNew: false, board: "all" } satisfies Effects;
  }
  const age = ctx.now().getTime() - event.occurredAt.getTime();
  const recent = age <= ctx.config.BACKFILL_NOTIFY_HOURS * HOUR_MS;
  return {
    raise: recent,
    onlyIfNew: true,
    board: recent ? "all" : "state",
  } satisfies Effects;
}

function scopeOf(source: Source) {
  const { boardId } = source.conn.settings;
  return {
    workspaceId: source.conn.workspaceId,
    namespace: source.namespace,
    boardId: typeof boardId === "string" ? boardId : undefined,
    source: source.conn.provider,
    people: source.people,
  } satisfies BoardScope;
}

async function linkCard(
  ctx: AppContext,
  scope: BoardScope,
  mode: Mode,
  event: WorklogEvent,
  opts: { actor: Member | null; board: Effects["board"] }
) {
  const effects =
    mode === "replay"
      ? []
      : (event.board ?? []).filter(
          (e) =>
            opts.board === "all" ||
            e.type === "close_card" ||
            e.type === "reopen_card"
        );
  const touched =
    effects.length > 0
      ? await applyBoardEffects(
          ctx,
          scope,
          effects,
          opts.actor,
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
    id: string;
    who: Who;
    cardId: string | null;
    onBehalfOfId: string | null;
    importance: number;
  }
) {
  const row = await recordActivity(ctx, {
    id: links.id,
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
  scope: BoardScope,
  event: WorklogEvent,
  effects: Effects,
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
    raise: effects.raise,
    onlyIfNew: effects.onlyIfNew,
  });
  if (event.agent?.state && effects.raise) {
    await applyAgentState(ctx, {
      workspaceId: scope.workspaceId,
      agentName: member?.name ?? event.actor?.name ?? "An agent",
      onBehalfOfId: links.onBehalfOfId,
      state: event.agent.state,
      title: event.title,
      body: event.body ?? null,
      url: event.url ?? null,
      activityId: links.activityId,
      cardId: links.cardId,
      thread: event.thread ?? event.id,
      agentId: member?.id ?? null,
    });
  }
}

async function applyRevision(
  ctx: AppContext,
  source: Source,
  event: WorklogEvent,
  outcome: Outcome
) {
  const key = {
    workspaceId: source.conn.workspaceId,
    source: source.conn.provider,
    externalId: event.id,
  };
  const mention = {
    workspaceId: source.conn.workspaceId,
    dedupeKey: `mention:${event.id}`,
  };
  if (event.op === "update") {
    await updateAttentionText(ctx.db, {
      ...mention,
      body: event.body?.slice(0, 280) ?? null,
    });
    const updated = await updateUnmergedActivity(ctx.db, {
      ...key,
      set: {
        title: event.title,
        body: event.body?.slice(0, 4000) ?? null,
        updatedAt: event.occurredAt,
      },
    });
    if (updated > 0) {
      outcome.merged += 1;
      return;
    }
    const entry = await findIngestedEvent(ctx.db, key);
    const burst = entry?.activityId
      ? await findActivityById(ctx.db, { id: entry.activityId })
      : undefined;
    if (burst && burst.count > 1) {
      await forgetMergedText(ctx, burst);
      outcome.dropped.push({
        id: event.id,
        reason: "edited inside a burst (the burst's text was removed)",
      });
      return;
    }
    outcome.dropped.push({
      id: event.id,
      reason: "edit of something not recorded",
    });
    return;
  }
  await setOpenAttentionDone(ctx.db, { ...mention, at: ctx.now() });
  await updateAttentionText(ctx.db, { ...mention, body: null });
  const reason = await transact(ctx, async (tx) => {
    const entry = await findIngestedEvent(tx.db, key);
    const activity = entry?.activityId
      ? await findActivityById(tx.db, { id: entry.activityId })
      : undefined;
    if (activity && activity.count > 1) {
      await forgetMergedText(tx, activity);
      return "deleted at the source (removed from the burst it was merged into)";
    }
    const removed = await deleteActivityByExternalId(tx.db, key);
    await insertIngestedTombstone(tx.db, {
      ...key,
      connectionId: source.conn.id,
    });
    return removed > 0
      ? "deleted at the source"
      : "deleted at the source (nothing recorded)";
  });
  outcome.dropped.push({ id: event.id, reason });
}

async function forgetMergedText(
  ctx: AppContext,
  activity: { id: string; body: string | null }
) {
  if (activity.body) {
    await updateActivityById(ctx.db, {
      id: activity.id,
      set: { body: null },
    });
  }
}

/**
 * Rebuilds a connection's activity from its stored deliveries, one job per lane on the lane's own
 * queue, so each runs in order with that lane's live events instead of racing them. Activity from
 * deliveries that retention already deleted can't be rebuilt, so it stays.
 */
export async function queueReplay(
  ctx: AppContext,
  conn: Pick<ConnectionRow, "id" | "workspaceId">,
  since?: Date
) {
  const kept = retainedSince(ctx);
  const from = kept && (!since || since < kept) ? kept : since;
  const lanes = await listInboundLanes(ctx.db, {
    connectionId: conn.id,
    since: from,
  });
  for (const lane of lanes) {
    await enqueue(
      ctx,
      "ingest:replay",
      {
        workspaceId: conn.workspaceId,
        connectionId: conn.id,
        lane,
        since: from?.toISOString() ?? null,
      },
      { queue: laneQueue(conn.id, lane), maxAttempts: 1 }
    );
  }
  return { lanes: lanes.length };
}

export async function replayLane(
  ctx: AppContext,
  params: {
    workspaceId: string;
    connectionId: string;
    lane: number;
    since?: Date;
  }
) {
  const loaded = await load(ctx, params.connectionId);
  if (!loaded) {
    return { reprocessed: 0, failed: 0, rebuiltFrom: 0 };
  }
  const window = { ...params, until: ctx.now() };
  const ids = await listInboundEventIds(ctx.db, window);
  const removed = await deleteLaneActivities(ctx.db, window);
  let failed = 0;
  for (const id of ids) {
    try {
      await processInbound(ctx, id, { replay: true, loaded });
    } catch (error) {
      failed += 1;
      log.error("ingest: replay of a delivery failed", {
        error,
        inboundEventId: id,
      });
    }
  }
  return { reprocessed: ids.length - failed, failed, rebuiltFrom: removed };
}

async function load(ctx: AppContext, connectionId: string) {
  const conn = await findConnectionById(ctx.db, { id: connectionId });
  const connector = conn ? getConnector(conn.provider) : undefined;
  if (!conn || !connector) {
    return null;
  }
  const view = viewOf(ctx, conn);
  return {
    connector,
    view,
    namespace: connector.identityNamespace(view),
  } satisfies Loaded;
}
