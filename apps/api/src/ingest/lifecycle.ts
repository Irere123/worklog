import { ProviderError } from "#connectors/http";
import type { ConnectionChange } from "#connectors/types";
import type { AppContext } from "#context";
import {
  findConnectionById,
  updateConnectionById,
} from "#db/queries/connections";
import type { ConnectionRow } from "#db/queries/connections";
import { findWorkspaceOwner } from "#db/queries/members";
import { transact } from "#db/transact";
import { raiseAttention } from "#work/attention";

import { queueSync } from "./sync-queue";

const VERB = {
  active: "is working again",
  suspended: "was suspended",
  revoked: "was disconnected",
} as const;

/** Applies what the provider said happened to an installation. */
export async function applyChange(
  ctx: AppContext,
  conn: ConnectionRow,
  change: ConnectionChange
) {
  if (change.type === "sync") {
    await queueSync(ctx, conn, { streams: change.streams });
    return;
  }
  if (change.type === "rename") {
    await updateConnectionById(ctx.db, {
      id: conn.id,
      set: { name: change.name },
    });
    return;
  }
  await setStatus(ctx, conn, change.status, change.reason);
}

export async function setStatus(
  ctx: AppContext,
  conn: ConnectionRow,
  status: "active" | "suspended" | "revoked",
  reason: string
) {
  // An admin's pause outlasts the provider saying it's fine again.
  if (
    conn.status === status ||
    (status === "active" && conn.status === "paused")
  ) {
    return;
  }
  await transact(ctx, async (tx) => {
    await updateConnectionById(tx.db, {
      id: conn.id,
      set: {
        status,
        statusReason: status === "active" ? null : reason,
        // An app install's tokens came from the install and die with it; a re-install brings new
        // ones. A hand-configured connection keeps its secrets so an admin can fix them.
        ...(status === "revoked" && conn.externalId
          ? { secrets: tx.secrets.seal({}) }
          : {}),
      },
    });
    await tellInstaller(tx, conn, `${conn.name} ${VERB[status]}: ${reason}`);
    // What happened while it was away comes in from the provider's API.
    if (status === "active") {
      await queueSync(tx, conn);
    }
  });
}

/** Who hears about a connection: whoever installed it, or the workspace's owner. */
export async function installerOf(ctx: AppContext, conn: ConnectionRow) {
  if (conn.installedById) {
    return conn.installedById;
  }
  const owner = await findWorkspaceOwner(ctx.db, {
    workspaceId: conn.workspaceId,
  });
  return owner?.id ?? null;
}

async function tellInstaller(
  ctx: AppContext,
  conn: ConnectionRow,
  title: string
) {
  const memberId = await installerOf(ctx, conn);
  if (!memberId) {
    return;
  }
  await raiseAttention(ctx, {
    workspaceId: conn.workspaceId,
    memberId,
    kind: "connection.status",
    title,
    priority: "normal",
    dedupeKey: `connection:${conn.id}`,
    replace: true,
  });
}

/**
 * What a failed provider call means for the connection: a token that stopped working revokes it.
 * True when it was handled and the caller should stop without retrying.
 */
export async function handleProviderError(
  ctx: AppContext,
  connectionId: string,
  error: unknown
) {
  if (!(error instanceof ProviderError) || error.kind !== "revoked") {
    return false;
  }
  const conn = await findConnectionById(ctx.db, { id: connectionId });
  if (conn) {
    await setStatus(ctx, conn, "revoked", error.message);
  }
  return true;
}
