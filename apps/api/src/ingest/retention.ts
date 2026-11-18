import type { AppContext } from "#context";
import { deleteAttentionResolutionsBefore } from "#db/queries/attention";
import { listAllConnectionIds } from "#db/queries/connections";
import { deleteFinishedDeliveries } from "#db/queries/inbound-events";
import { deleteIngestedEventsBefore } from "#db/queries/ingested-events";
import { deleteExpiredInstallStates } from "#db/queries/install-states";
import { DAY_MS } from "#lib/time";

const BATCH = 1000;

export function retainedSince(ctx: AppContext) {
  const days = ctx.config.INBOUND_RETENTION_DAYS;
  return days > 0 ? new Date(ctx.now().getTime() - days * DAY_MS) : undefined;
}

const RESOLUTION_DAYS = 30;

export async function pruneDeliveries(ctx: AppContext) {
  const before = retainedSince(ctx);
  if (!before) {
    return 0;
  }
  let pruned = 0;
  for (const connectionId of await listAllConnectionIds(ctx.db)) {
    pruned += await drain(
      async (limit) =>
        await deleteFinishedDeliveries(ctx.db, { connectionId, before, limit })
    );
    await drain(
      async (limit) =>
        await deleteIngestedEventsBefore(ctx.db, {
          connectionId,
          before,
          limit,
        })
    );
  }
  return pruned;
}

export async function pruneIngestState(ctx: AppContext) {
  await deleteAttentionResolutionsBefore(ctx.db, {
    before: new Date(ctx.now().getTime() - RESOLUTION_DAYS * DAY_MS),
  });
  await deleteExpiredInstallStates(ctx.db, { now: ctx.now() });
}

async function drain(batch: (limit: number) => Promise<number>) {
  let total = 0;
  let deleted = BATCH;
  while (deleted === BATCH) {
    deleted = await batch(BATCH);
    total += deleted;
  }
  return total;
}
