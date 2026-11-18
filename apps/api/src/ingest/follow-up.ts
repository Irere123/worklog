import { getConnector } from "#connectors";
import type { ConnectionView } from "#connectors/types";
import type { AppContext } from "#context";
import { findConnectionById } from "#db/queries/connections";
import { insertIngestedEventIfNew } from "#db/queries/ingested-events";
import { transact } from "#db/transact";
import { enqueue } from "#jobs/queue";

import { viewOf } from "./view";

/**
 * An answer that takes longer than the provider waits (an assistant reply, a brief) runs as a job
 * after the acknowledgement, so a restart doesn't lose it. `once` names the request: a provider's
 * retry of it queues nothing. False when it was a retry.
 */
export async function queueFollowUp(
  ctx: AppContext,
  conn: ConnectionView,
  payload: Record<string, unknown>,
  opts: { once?: string } = {}
) {
  return await transact(ctx, async (tx) => {
    if (opts.once) {
      const first = await insertIngestedEventIfNew(tx.db, {
        workspaceId: conn.workspaceId,
        source: conn.provider,
        externalId: `follow-up:${opts.once}`,
        connectionId: conn.id,
        activityId: null,
      });
      if (!first) {
        return false;
      }
    }
    await enqueue(
      tx,
      "chat:follow-up",
      { ...payload, connectionId: conn.id },
      { maxAttempts: 2 }
    );
    return true;
  });
}

export async function followUp(
  ctx: AppContext,
  payload: Record<string, unknown>
) {
  const conn = await findConnectionById(ctx.db, {
    id: String(payload.connectionId),
  });
  const connector = conn ? getConnector(conn.provider) : undefined;
  if (!conn || !connector?.followUp) {
    return;
  }
  await connector.followUp(ctx, viewOf(ctx, conn), payload);
}
