import type { ConnectionView } from "#connectors/types";
import type { AppContext } from "#context";
import type { ConnectionRow } from "#db/queries/connections";

/** A connection as connector code sees it, with its secrets opened. */
export function viewOf(ctx: AppContext, conn: ConnectionRow): ConnectionView {
  return {
    id: conn.id,
    workspaceId: conn.workspaceId,
    provider: conn.provider,
    externalId: conn.externalId,
    settings: conn.settings,
    secrets: ctx.secrets.open(conn.secrets),
  };
}
