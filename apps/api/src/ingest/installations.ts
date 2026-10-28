import { listConnectors } from "#connectors";
import type { AppContext } from "#context";
import { listInstalledConnections } from "#db/queries/connections";

import { loadApp } from "./apps";
import { setStatus } from "./lifecycle";

/**
 * Revokes connections whose installation the provider no longer lists. Only on a list the
 * provider gave in full: a call that fails revokes nothing.
 */
export async function reconcileInstallations(ctx: AppContext) {
  let revoked = 0;
  for (const connector of listConnectors()) {
    const list = connector.app?.installations;
    const app = list ? await loadApp(ctx, connector.id) : null;
    if (!list || !app) {
      continue;
    }
    let current: Set<string>;
    try {
      current = await list(ctx, app);
    } catch (error) {
      console.error(
        `[lifecycle] can't list ${connector.id} installations`,
        error
      );
      continue;
    }
    const conns = await listInstalledConnections(ctx.db, {
      provider: connector.id,
    });
    for (const conn of conns) {
      if (conn.externalId && !current.has(conn.externalId)) {
        await setStatus(
          ctx,
          conn,
          "revoked",
          "the app is no longer installed there"
        );
        revoked += 1;
      }
    }
  }
  return revoked;
}
