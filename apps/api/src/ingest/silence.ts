import type { AppContext } from "#context";
import { listQuietConnections } from "#db/queries/connections";
import type { ConnectionRow } from "#db/queries/connections";
import { countInboundEventsBetween } from "#db/queries/inbound-events";
import { DAY_MS } from "#lib/time";
import { raiseAttention } from "#work/attention";

import { installerOf } from "./lifecycle";

const QUIET_DAYS = 4;
const USUAL = 20;
const LOOKBACK_DAYS = 14;

/**
 * A connection that usually hears from its tool and has gone quiet is how a webhook the provider
 * disabled, a rotated secret or an expired token shows up. Whoever installed it is told, once per
 * silence.
 */
export async function noticeSilence(ctx: AppContext) {
  const quietSince = new Date(ctx.now().getTime() - QUIET_DAYS * DAY_MS);
  let noticed = 0;
  for (const conn of await listQuietConnections(ctx.db, {
    before: quietSince,
  })) {
    const usual = await countInboundEventsBetween(ctx.db, {
      connectionId: conn.id,
      since: new Date(quietSince.getTime() - LOOKBACK_DAYS * DAY_MS),
      until: quietSince,
    });
    if (usual >= USUAL && (await tell(ctx, conn))) {
      noticed += 1;
    }
  }
  return noticed;
}

async function tell(ctx: AppContext, conn: ConnectionRow) {
  const memberId = await installerOf(ctx, conn);
  const last = conn.lastEventAt;
  if (!memberId || !last) {
    return false;
  }
  const raised = await raiseAttention(ctx, {
    workspaceId: conn.workspaceId,
    memberId,
    kind: "connection.silent",
    title: `${conn.name} has received nothing since ${last.toISOString().slice(0, 10)}`,
    body: "It usually hears from its tool every day. Check that its webhook is still enabled and its secret matches; GET /v1/connections/{id}/health shows any rejected deliveries.",
    priority: "normal",
    dedupeKey: `connection-silent:${conn.id}:${last.toISOString()}`,
    onlyIfNew: true,
  });
  return raised !== null;
}
