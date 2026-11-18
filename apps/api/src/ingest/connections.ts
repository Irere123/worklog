import { z } from "zod";

import { getConnector } from "#connectors";
import {
  isBuiltInNamespace,
  isConnectionNamespace,
} from "#connectors/namespaces";
import { WebhookSettings } from "#connectors/webhook";
import type { AppContext } from "#context";
import { listBoards } from "#db/queries/boards";
import {
  deleteConnectionById,
  getConnectionById,
  insertConnection,
  updateConnectionById,
} from "#db/queries/connections";
import type { ConnectionRow } from "#db/queries/connections";
import { transact } from "#db/transact";
import { badRequest } from "#lib/errors";
import { generateId } from "#lib/ids";

import { loadApp } from "./apps";
import { queueHooks } from "./hooks";
import { handleProviderError } from "./lifecycle";
import { queueSync } from "./sync-queue";
import { viewOf } from "./view";

async function requireBoard(
  ctx: AppContext,
  workspaceId: string,
  settings: Record<string, unknown>,
  before: Record<string, unknown> = {}
) {
  const { boardId } = settings;
  if (boardId === undefined || boardId === null || boardId === before.boardId) {
    return;
  }
  const boards = await listBoards(ctx.db, { workspaceId });
  if (typeof boardId !== "string" || !boards.some((b) => b.id === boardId)) {
    throw badRequest(
      `boardId ${JSON.stringify(boardId)} isn't a board in this workspace`
    );
  }
}

function validate(
  provider: string,
  secrets: Record<string, string>,
  settings: Record<string, unknown>,
  installed = false,
  before: Record<string, unknown> = {}
) {
  const connector = getConnector(provider);
  if (!connector) {
    throw badRequest(
      `Unknown connector "${provider}" — see GET /v1/connectors`
    );
  }
  const managed = Boolean(connector.hooks && secrets.token);
  const missing = installed
    ? []
    : connector.secrets
        .filter((s) => s.required && !secrets[s.key])
        .filter((s) => !(s.generated === true && managed))
        .map((s) => s.key);
  if (missing.length) {
    throw badRequest(
      `${connector.name} connections need: ${missing.join(", ")}`
    );
  }
  const ns = settings.identityNamespace;
  if (typeof ns === "string" && ns !== before.identityNamespace) {
    if (isBuiltInNamespace(ns)) {
      throw badRequest(
        `identityNamespace "${ns}" is reserved for the built-in ${ns.split(":")[0] ?? ns} connector`
      );
    }
    if (isConnectionNamespace(ns)) {
      throw badRequest(
        `identityNamespace "${ns}" is a connection's own; leave it out to use this one's`
      );
    }
  }
  if (provider === "webhook") {
    const parsed = WebhookSettings.safeParse(settings);
    if (!parsed.success) {
      throw badRequest(
        `Invalid webhook settings: ${z.prettifyError(parsed.error)}`
      );
    }
    if (parsed.data.verify.type !== "none" && !secrets.secret) {
      throw badRequest("Signed webhooks need a `secret`");
    }
  }
  return connector;
}

export async function createConnection(
  ctx: AppContext,
  workspaceId: string,
  input: {
    provider: string;
    name?: string;
    secrets?: Record<string, string>;
    settings?: Record<string, unknown>;
  }
) {
  const connector = validate(
    input.provider,
    input.secrets ?? {},
    input.settings ?? {}
  );
  await requireBoard(ctx, workspaceId, input.settings ?? {});
  const row: ConnectionRow = {
    id: generateId(),
    workspaceId,
    provider: input.provider,
    name: input.name ?? connector.name,
    status: "active",
    statusReason: null,
    externalId: null,
    installedById: null,
    settings: input.settings ?? {},
    secrets: ctx.secrets.seal(input.secrets ?? {}),
    lastEventAt: null,
    rejections: 0,
    lastRejectedAt: null,
    lastRejection: null,
    createdAt: ctx.now(),
  };
  await transact(ctx, async (tx) => {
    await insertConnection(tx.db, row);
    if (connector.hooks) {
      await queueHooks(tx, row);
    }
  });
  return row;
}

export async function updateConnection(
  ctx: AppContext,
  workspaceId: string,
  id: string,
  patch: {
    name?: string;
    status?: ConnectionRow["status"];
    settings?: Record<string, unknown>;
    secrets?: Record<string, string>;
  }
) {
  const current = await getConnectionById(ctx.db, { id, workspaceId });
  if (
    patch.status &&
    current.externalId &&
    (current.status === "suspended" || current.status === "revoked")
  ) {
    throw badRequest(
      current.status === "revoked"
        ? "This connection was uninstalled; install it again to reconnect"
        : "This connection is suspended on the provider's side; unsuspend it there"
    );
  }
  const secrets = {
    ...ctx.secrets.open(current.secrets),
    ...patch.secrets,
  };
  const settings =
    patch.settings && current.externalId
      ? { ...current.settings, ...patch.settings }
      : patch.settings;
  validate(
    current.provider,
    secrets,
    settings ?? current.settings,
    current.externalId !== null,
    current.settings
  );
  if (settings) {
    await requireBoard(ctx, current.workspaceId, settings, current.settings);
  }
  const resumed = patch.status === "active" && current.status !== "active";
  return await transact(ctx, async (tx) => {
    const row = await updateConnectionById(tx.db, {
      id,
      set: {
        name: patch.name,
        status: patch.status,
        statusReason: resumed ? null : undefined,
        settings,
        secrets: tx.secrets.seal(secrets),
      },
    });
    if (resumed) {
      await queueSync(tx, row);
    }
    if (
      getConnector(row.provider)?.hooks &&
      (patch.settings || patch.secrets || resumed)
    ) {
      await queueHooks(tx, row);
    }
    return row;
  });
}

export async function deleteConnection(
  ctx: AppContext,
  workspaceId: string,
  id: string
) {
  await getConnectionById(ctx.db, { id, workspaceId });
  await deleteConnectionById(ctx.db, { id });
}

export function webhookUrls(
  ctx: AppContext,
  conn: ConnectionRow
): Record<string, string> {
  const endpoints = getConnector(conn.provider)?.endpoints ?? {};
  return Object.fromEntries(
    Object.entries(endpoints).map(([name, suffix]) => [
      name,
      `${ctx.config.PUBLIC_URL}/hooks/${conn.id}${suffix ? `/${suffix}` : ""}`,
    ])
  );
}

async function sourcesOf(ctx: AppContext, conn: ConnectionRow) {
  const connector = getConnector(conn.provider);
  if (!connector?.sources) {
    throw badRequest(`${conn.provider} connections have no sources to choose`);
  }
  const app = connector.app ? await loadApp(ctx, conn.provider) : null;
  try {
    return {
      spec: connector.sources,
      sources: await connector.sources.list(ctx, viewOf(ctx, conn), app),
    };
  } catch (error) {
    if (await handleProviderError(ctx, conn.id, error)) {
      throw badRequest(`${conn.name} is no longer connected; install it again`);
    }
    throw error;
  }
}

/** What the connection could watch: the repos an installation covers, the channels a bot is in. */
export async function listSources(
  ctx: AppContext,
  workspaceId: string,
  id: string
) {
  const conn = await getConnectionById(ctx.db, { id, workspaceId });
  const { sources } = await sourcesOf(ctx, conn);
  return sources;
}

/** Chooses what counts, from the list the provider gave, and reads the new choices' history. */
export async function setSources(
  ctx: AppContext,
  workspaceId: string,
  id: string,
  ids: string[]
) {
  const conn = await getConnectionById(ctx.db, { id, workspaceId });
  const { spec, sources } = await sourcesOf(ctx, conn);
  const known = new Map(sources.map((s) => [s.id, s]));
  const unknown = ids.filter((i) => !known.has(i));
  if (unknown.length > 0) {
    throw badRequest(`Not available to this connection: ${unknown.join(", ")}`);
  }
  const chosen = ids.flatMap((i) => known.get(i) ?? []);
  return await transact(ctx, async (tx) => {
    const row = await updateConnectionById(tx.db, {
      id,
      set: { settings: { ...conn.settings, ...spec.settings(chosen) } },
    });
    await queueSync(tx, row);
    if (getConnector(row.provider)?.hooks) {
      await queueHooks(tx, row);
    }
    return row;
  });
}
