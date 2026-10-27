import { recordActivity } from "#activity/service";
import { getConnector } from "#connectors/registry";
import type { AppContext } from "#context";
import {
  deleteActivityByExternalId,
  deleteConnectionActivities,
  updateUnmergedActivity,
} from "#db/queries/activities";
import {
  findConnectionById,
  setConnectionLastEventAt,
} from "#db/queries/connections";
import type { ConnectionRow } from "#db/queries/connections";
import { countUnlinkedIdentities } from "#db/queries/identities";
import {
  countInboundEventsByStatus,
  findInboundEventById,
  insertInboundEvent,
  listInboundEventIds,
  listInboundFailures,
  listInboundOutcomes,
  updateInboundAttempt,
} from "#db/queries/inbound-events";
import type { InboundEvent } from "#db/queries/inbound-events";
import { findMemberById } from "#db/queries/members";
import type { Member } from "#db/queries/members";
import { transact } from "#db/transact";
import { enqueue } from "#jobs/queue";
import { newId } from "#lib/ids";

import {
  applyAgentState,
  applyBoardEffects,
  applySignals,
  findCardIds,
} from "./effects";
import { resolveActor } from "./identity";
import { gate } from "./quality";
import type { ConnectionView, InboundRequest, WorklogEvent } from "./types";

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
  const conn = await findConnectionById(ctx.db, { id: connectionId });
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
  const stored = await store(ctx, conn, {
    deliveryId: received.deliveryId,
    eventType: received.eventType,
    payload: received.payload,
    receivedAt: req.receivedAt,
  });
  if (!stored) {
    return { status: 200, body: { ok: true, duplicate: true } };
  }
  await setConnectionLastEventAt(ctx.db, {
    id: conn.id,
    at: req.receivedAt,
  });
  return { status: 200, body: { ok: true } };
}

export async function receivePushed(
  ctx: AppContext,
  conn: ConnectionRow,
  deliveryId: string,
  events: unknown[]
) {
  const stored = await store(ctx, conn, {
    deliveryId,
    eventType: "worklog.events",
    payload: { events },
    receivedAt: ctx.now(),
  });
  if (!stored) {
    return { duplicate: true };
  }
  return { duplicate: false, inboundEventId: stored };
}

/**
 * The delivery and its job commit together. Stored without a job, a delivery would never be
 * processed: the provider's retry is a duplicate and gets a 200.
 */
async function store(
  ctx: AppContext,
  conn: ConnectionRow,
  delivery: Pick<
    InboundEvent,
    "deliveryId" | "eventType" | "payload" | "receivedAt"
  >
): Promise<string | null> {
  return await transact(ctx, async (tx) => {
    const row = await insertInboundEvent(tx.db, {
      id: newId("inb"),
      workspaceId: conn.workspaceId,
      connectionId: conn.id,
      ...delivery,
    });
    if (!row) {
      return null;
    }
    // One connection's deliveries are processed in order (merging and thread state depend on it).
    await enqueue(
      tx,
      "ingest:process",
      { inboundEventId: row.id },
      { queue: `ingest:${conn.id}` }
    );
    return row.id;
  });
}

export async function processInbound(
  ctx: AppContext,
  inboundEventId: string,
  { replay = false }: { replay?: boolean } = {}
) {
  const inbound = await findInboundEventById(ctx.db, { id: inboundEventId });
  if (!inbound) {
    return;
  }
  const conn = await findConnectionById(ctx.db, { id: inbound.connectionId });
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
    await updateInboundAttempt(ctx.db, {
      id: inbound.id,
      set: { status, outcome, error: null, processedAt: ctx.now() },
    });
  } catch (error) {
    await updateInboundAttempt(ctx.db, {
      id: inbound.id,
      set: {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      },
    });
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
  const member = resolved.memberId
    ? await findMemberById(ctx.db, { id: resolved.memberId })
    : undefined;
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
  const key = {
    workspaceId: conn.workspaceId,
    source: conn.provider,
    externalId: event.id,
  };
  if (event.op === "delete") {
    const removed = await deleteActivityByExternalId(ctx.db, key);
    outcome.dropped.push({
      id: event.id,
      reason:
        removed > 0
          ? "deleted at the source"
          : "deleted at the source (nothing recorded)",
    });
    return;
  }
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
  } else {
    outcome.dropped.push({
      id: event.id,
      reason: "edit of something not recorded",
    });
  }
}

export async function replayConnection(
  ctx: AppContext,
  workspaceId: string,
  connectionId: string,
  since?: Date
) {
  const ids = await listInboundEventIds(ctx.db, {
    workspaceId,
    connectionId,
    since,
  });
  const removed = await deleteConnectionActivities(ctx.db, {
    connectionId,
    since,
  });
  for (const id of ids) {
    await processInbound(ctx, id, { replay: true });
  }
  return { reprocessed: ids.length, rebuiltFrom: removed };
}

export async function connectionHealth(
  ctx: AppContext,
  conn: ConnectionRow,
  days = 7
) {
  const since = new Date(ctx.now().getTime() - days * 86_400_000);
  const connector = getConnector(conn.provider);
  const [byStatus, recent, unlinked, failures] = await Promise.all([
    countInboundEventsByStatus(ctx.db, { connectionId: conn.id, since }),
    listInboundOutcomes(ctx.db, { connectionId: conn.id, since, limit: 2000 }),
    connector
      ? countUnlinkedIdentities(ctx.db, {
          workspaceId: conn.workspaceId,
          provider: connector.identityNamespace(viewOf(ctx, conn)),
        })
      : 0,
    listInboundFailures(ctx.db, { connectionId: conn.id, limit: 5 }),
  ]);
  const reasons = new Map<string, number>();
  let kept = 0;
  let merged = 0;
  for (const outcome of recent) {
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
    unlinkedIdentities: unlinked,
    recentFailures: failures.map((f) => ({
      at: f.at.toISOString(),
      eventType: f.eventType,
      error: f.error,
    })),
  };
}
