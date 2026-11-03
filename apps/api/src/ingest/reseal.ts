import type { AppContext } from "#context";
import {
  listConnectionSecrets,
  updateConnectionSecretsIfUnchanged,
} from "#db/queries/connections";
import {
  listConnectorApps,
  updateConnectorAppCredentialsIfUnchanged,
} from "#db/queries/connector-apps";
import { log } from "#telemetry/log";

import { forgetCachedApps } from "./apps";

/**
 * Re-seals every connection's secrets and every app's credentials still sealed with a previous
 * key, so the previous key can be retired. A value changed meanwhile is left for the next run.
 */
export async function resealSecrets(ctx: AppContext) {
  let resealed = 0;
  for (const conn of await listConnectionSecrets(ctx.db)) {
    const to = resealedValue(ctx, conn.secrets, `connection ${conn.id}`);
    if (
      to &&
      (await updateConnectionSecretsIfUnchanged(ctx.db, {
        id: conn.id,
        from: conn.secrets,
        to,
      }))
    ) {
      resealed += 1;
    }
  }
  for (const app of await listConnectorApps(ctx.db)) {
    const to = resealedValue(ctx, app.credentials, `the ${app.provider} app`);
    if (
      to &&
      (await updateConnectorAppCredentialsIfUnchanged(ctx.db, {
        provider: app.provider,
        from: app.credentials,
        to,
      }))
    ) {
      resealed += 1;
    }
  }
  forgetCachedApps();
  return resealed;
}

// Null when it's current, or can't be opened: one value sealed with a key that's no longer
// configured mustn't stop the rest from moving to the current key.
function resealedValue(ctx: AppContext, sealed: string, what: string) {
  if (!ctx.secrets.stale(sealed)) {
    return null;
  }
  try {
    return ctx.secrets.seal(ctx.secrets.open(sealed));
  } catch (error) {
    log.error("secrets: can't re-seal", { error, what });
    return null;
  }
}
