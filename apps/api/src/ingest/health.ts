import { getConnector } from "#connectors";
import type { AppContext } from "#context";
import { listConnectionCursors } from "#db/queries/connection-cursors";
import type { ConnectionRow } from "#db/queries/connections";
import { countUnlinkedIdentities } from "#db/queries/identities";
import {
  countInboundEventsByStatus,
  countPendingInboundEvents,
  listInboundFailures,
  listInboundLags,
  listInboundOutcomes,
} from "#db/queries/inbound-events";
import { DAY_MS } from "#lib/time";

import type { Outcome } from "./process";
import { viewOf } from "./view";

export async function connectionHealth(
  ctx: AppContext,
  conn: ConnectionRow,
  days = 7
) {
  const since = new Date(ctx.now().getTime() - days * DAY_MS);
  const connector = getConnector(conn.provider);
  const [byStatus, recent, unlinked, failures, pending, lags, cursors] =
    await Promise.all([
      countInboundEventsByStatus(ctx.db, { connectionId: conn.id, since }),
      listInboundOutcomes(ctx.db, {
        connectionId: conn.id,
        since,
        limit: 2000,
      }),
      connector
        ? countUnlinkedIdentities(ctx.db, {
            workspaceId: conn.workspaceId,
            provider: connector.identityNamespace(viewOf(ctx, conn)),
          })
        : 0,
      listInboundFailures(ctx.db, { connectionId: conn.id, limit: 5 }),
      countPendingInboundEvents(ctx.db, { connectionId: conn.id }),
      listInboundLags(ctx.db, { connectionId: conn.id, since, limit: 500 }),
      listConnectionCursors(ctx.db, { connectionId: conn.id }),
    ]);
  const { kept, merged, duplicates, reasons, seen } = summarize(recent);
  const statuses: Record<string, number> = Object.fromEntries(
    byStatus.map((s) => [s.status, s.n])
  );
  return {
    days,
    status: conn.status,
    statusReason: conn.statusReason,
    // As used, which isn't always what settings say (a reserved one held from before isn't).
    identityNamespace: connector
      ? connector.identityNamespace(viewOf(ctx, conn))
      : null,
    lastEventAt: conn.lastEventAt?.toISOString() ?? null,
    deliveries: statuses,
    activities: { kept, merged, duplicates },
    /** Low isn't bad: it means noise was filtered. */
    signalRate: seen > 0 ? (kept + merged) / seen : null,
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
    rejections: rejectionsOf(conn),
    backlog: {
      pending: pending.n,
      oldestAt: pending.oldest?.toISOString() ?? null,
    },
    lagMs: { p50: percentile(lags, 0.5), p95: percentile(lags, 0.95) },
    sync: cursors.map((c) => ({
      stream: c.stream,
      state: c.state,
      syncedAt: c.syncedAt?.toISOString() ?? null,
      error: c.error,
    })),
  };
}

function summarize(outcomes: unknown[]) {
  const reasons = new Map<string, number>();
  let kept = 0;
  let merged = 0;
  let duplicates = 0;
  // Events, not deliveries: a page of history is one delivery holding many.
  let seen = 0;
  for (const outcome of outcomes) {
    const o = (outcome ?? {}) as Partial<Outcome>;
    kept += o.kept ?? 0;
    merged += o.merged ?? 0;
    duplicates += o.duplicates ?? 0;
    const dropped = o.dropped ?? [];
    const events =
      (o.kept ?? 0) +
      (o.merged ?? 0) +
      (o.duplicates ?? 0) +
      dropped.length +
      (o.skipped ?? 0);
    seen += Math.max(events, 1);
    if (o.ignored) {
      reasons.set(o.ignored, (reasons.get(o.ignored) ?? 0) + 1);
    }
    for (const d of dropped) {
      reasons.set(d.reason, (reasons.get(d.reason) ?? 0) + 1);
    }
  }
  return { kept, merged, duplicates, reasons, seen };
}

function rejectionsOf(conn: ConnectionRow) {
  return {
    total: conn.rejections,
    lastAt: conn.lastRejectedAt?.toISOString() ?? null,
    last: conn.lastRejection,
    // Rejected after the last accepted delivery: the secret or signature setup is likely wrong.
    failingNow:
      conn.lastRejectedAt !== null &&
      (conn.lastEventAt === null || conn.lastRejectedAt > conn.lastEventAt),
  };
}

function percentile(values: number[], p: number) {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.toSorted((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return Math.round(sorted[index] ?? 0);
}
