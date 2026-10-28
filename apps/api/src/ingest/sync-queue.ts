import type { AppContext } from "#context";
import type { ConnectionRow } from "#db/queries/connections";
import { enqueue } from "#jobs/queue";

export const syncQueue = (connectionId: string) => `sync:${connectionId}`;

/**
 * Reads the connection's history (all streams, or just `streams`) from the provider's API. One
 * queue per connection, so a big backfill reads one stream at a time and stays inside rate limits.
 */
export async function queueSync(
  ctx: AppContext,
  conn: Pick<ConnectionRow, "id">,
  opts: { streams?: string[] } = {}
) {
  await enqueue(
    ctx,
    "sync:connection",
    { connectionId: conn.id, streams: opts.streams ?? null },
    {
      queue: syncQueue(conn.id),
      maxAttempts: 3,
      ...(opts.streams ? {} : { key: `sync:${conn.id}` }),
    }
  );
}
