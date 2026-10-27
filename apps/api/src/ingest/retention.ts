import type { AppContext } from "#context";
import { listAllConnectionIds } from "#db/queries/connections";
import { deleteFinishedDeliveries } from "#db/queries/inbound-events";
import { DAY_MS } from "#lib/time";

const BATCH = 1000;

// Undefined when INBOUND_RETENTION_DAYS=0 keeps every delivery.
export function retainedSince(ctx: AppContext): Date | undefined {
  const days = ctx.config.INBOUND_RETENTION_DAYS;
  return days > 0 ? new Date(ctx.now().getTime() - days * DAY_MS) : undefined;
}

export async function pruneDeliveries(ctx: AppContext) {
  const before = retainedSince(ctx);
  if (!before) {
    return 0;
  }
  let pruned = 0;
  for (const connectionId of await listAllConnectionIds(ctx.db)) {
    let deleted = BATCH;
    while (deleted === BATCH) {
      deleted = await deleteFinishedDeliveries(ctx.db, {
        connectionId,
        before,
        limit: BATCH,
      });
      pruned += deleted;
    }
  }
  return pruned;
}
