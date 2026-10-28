import { randomBytes } from "node:crypto";

import { getConnector } from "#connectors";
import type { AppContext } from "#context";
import { upsertConnectionCursor } from "#db/queries/connection-cursors";
import {
  findConnectionById,
  updateConnectionById,
} from "#db/queries/connections";
import type { ConnectionRow } from "#db/queries/connections";
import { enqueue } from "#jobs/queue";

import { viewOf } from "./view";

/** Puts the connection's webhooks in place on the provider, where Worklog manages them. */
export async function queueHooks(
  ctx: AppContext,
  conn: Pick<ConnectionRow, "id">
) {
  await enqueue(
    ctx,
    "hooks:ensure",
    { connectionId: conn.id },
    { key: `hooks:${conn.id}`, maxAttempts: 3 }
  );
}

/**
 * Creates the hooks that are missing and turns disabled ones back on, one per chosen repo, each
 * with the connection's secret (made here if it has none). How each went shows in health, like a
 * sync stream.
 */
export async function ensureHooks(ctx: AppContext, connectionId: string) {
  const conn = await findConnectionById(ctx.db, { id: connectionId });
  const hooks = conn ? getConnector(conn.provider)?.hooks : undefined;
  if (!conn || !hooks || conn.status !== "active") {
    return;
  }
  const view = viewOf(ctx, conn);
  if (!hooks.available(view)) {
    return;
  }
  let secret = view.secrets.webhookSecret;
  if (!secret) {
    secret = randomBytes(32).toString("base64url");
    await updateConnectionById(ctx.db, {
      id: conn.id,
      set: {
        secrets: ctx.secrets.seal({ ...view.secrets, webhookSecret: secret }),
      },
    });
  }
  const results = await hooks.ensure(
    ctx,
    { ...view, secrets: { ...view.secrets, webhookSecret: secret } },
    { url: `${ctx.config.PUBLIC_URL}/hooks/${conn.id}`, secret }
  );
  for (const r of results) {
    await upsertConnectionCursor(ctx.db, {
      connectionId: conn.id,
      stream: `hook:${r.target}`,
      state: r.state === "failed" ? "failed" : "idle",
      error: r.error ?? null,
      syncedAt: r.state === "failed" ? undefined : ctx.now(),
      now: ctx.now(),
    });
  }
}
