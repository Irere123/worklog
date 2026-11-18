import { getConnector, listConnectors } from "#connectors";
import type { AppView } from "#connectors/types";
import type { AppContext } from "#context";
import {
  findConnectorApp,
  insertConnectorApp,
  listConnectorApps,
  updateConnectorApp,
} from "#db/queries/connector-apps";
import type { ConnectorAppRow } from "#db/queries/connector-apps";
import { countWorkspaces } from "#db/queries/workspaces";
import { safeEqual } from "#lib/crypto";
import { badRequest, conflict, forbidden } from "#lib/errors";

const CACHE_MS = 30_000;

const cache = new Map<string, { app: AppView | null; until: number }>();

/** The instance's app for a provider, created from the environment on first use. Null if neither. */
export async function loadApp(
  ctx: AppContext,
  provider: string,
  opts: { fresh?: boolean } = {}
): Promise<AppView | null> {
  const hit = cache.get(provider);
  if (hit && hit.until > Date.now() && opts.fresh !== true) {
    return hit.app;
  }
  const app = await readApp(ctx, provider);
  if (app) {
    cache.set(provider, { app, until: Date.now() + CACHE_MS });
  } else {
    cache.delete(provider);
  }
  return app;
}

/** Brings apps that come from the environment in line with it; run when a process starts. */
export async function syncAppsFromEnv(ctx: AppContext) {
  for (const connector of listConnectors()) {
    if (connector.app) {
      await loadApp(ctx, connector.id, { fresh: true });
    }
  }
}

async function readApp(ctx: AppContext, provider: string) {
  const row = await findConnectorApp(ctx.db, { provider });
  const seeded = getConnector(provider)?.app?.fromEnv(ctx.config) ?? null;
  if (row) {
    return await fromEnvIfChanged(ctx, row, seeded);
  }
  if (!seeded) {
    return null;
  }
  await insertConnectorApp(ctx.db, {
    provider,
    appId: seeded.appId,
    slug: seeded.slug,
    name: seeded.name,
    credentials: ctx.secrets.seal(seeded.credentials),
    createdVia: "env",
  });
  const created = await findConnectorApp(ctx.db, { provider });
  return created ? viewOfApp(ctx, created) : null;
}

const sameApp = (a: Omit<AppView, "provider">, b: AppView) =>
  a.appId === b.appId &&
  a.slug === b.slug &&
  a.name === b.name &&
  JSON.stringify(a.credentials) === JSON.stringify(b.credentials);

async function fromEnvIfChanged(
  ctx: AppContext,
  row: ConnectorAppRow,
  seeded: Omit<AppView, "provider"> | null
) {
  const current = viewOfApp(ctx, row);
  if (row.createdVia !== "env" || !seeded || sameApp(seeded, current)) {
    return current;
  }
  const updated = await updateConnectorApp(ctx.db, {
    provider: row.provider,
    set: {
      appId: seeded.appId,
      slug: seeded.slug,
      name: seeded.name,
      credentials: ctx.secrets.seal(seeded.credentials),
      updatedAt: ctx.now(),
    },
  });
  return updated ? viewOfApp(ctx, updated) : current;
}

/**
 * Registers the instance's app. Credentials that exist are never overwritten by accident: every
 * installation depends on them, so replacing them takes `replace`.
 */
export async function saveApp(
  ctx: AppContext,
  provider: string,
  input: Omit<AppView, "provider"> & {
    createdVia: ConnectorAppRow["createdVia"];
  },
  opts: { replace?: boolean } = {}
) {
  const spec = getConnector(provider)?.app;
  if (!spec) {
    throw badRequest(`${provider} doesn't install as an app`);
  }
  const missing = spec.credentials
    .filter((c) => c.required && !input.credentials[c.key])
    .map((c) => c.key);
  if (missing.length > 0) {
    throw badRequest(`The ${provider} app needs: ${missing.join(", ")}`);
  }
  const row = {
    appId: input.appId,
    slug: input.slug,
    name: input.name,
    credentials: ctx.secrets.seal(input.credentials),
    createdVia: input.createdVia,
  };
  cache.delete(provider);
  const created = await insertConnectorApp(ctx.db, { provider, ...row });
  if (created) {
    return viewOfApp(ctx, created);
  }
  if (opts.replace !== true) {
    throw conflict(
      `This server already has a ${provider} app. Replacing it breaks every installation made with it; pass replace to do it anyway.`
    );
  }
  const updated = await updateConnectorApp(ctx.db, {
    provider,
    set: { ...row, updatedAt: ctx.now() },
  });
  cache.delete(provider);
  if (!updated) {
    throw conflict(`The ${provider} app was removed while saving it`);
  }
  return viewOfApp(ctx, updated);
}

/** Every provider that installs as an app, and whether this server has its app yet. */
export async function listApps(ctx: AppContext) {
  const providers = listConnectors().filter((c) => c.app);
  let rows = await listConnectorApps(ctx.db);
  const missing = providers.filter(
    (c) => !rows.some((r) => r.provider === c.id)
  );
  for (const connector of missing) {
    await loadApp(ctx, connector.id);
  }
  if (missing.length > 0) {
    rows = await listConnectorApps(ctx.db);
  }
  return providers.map((connector) => ({
    connector,
    row: rows.find((r) => r.provider === connector.id) ?? null,
  }));
}

/**
 * An app serves every workspace on the server. With one workspace its admins own it; once a
 * server hosts several, registering one also takes the setup secret, like creating a workspace.
 * The caller has checked the member is an admin.
 */
export async function requireServerAdmin(
  ctx: AppContext,
  secret: string | undefined
) {
  if ((await countWorkspaces(ctx.db)) <= 1) {
    return;
  }
  const expected = ctx.config.SETUP_SECRET;
  if (!expected || !secret || !safeEqual(secret, expected)) {
    throw forbidden(
      "This server hosts several workspaces: registering an app needs the x-setup-secret header"
    );
  }
}

/** Where the provider sends the admin's browser back. */
export function callbackUrl(ctx: AppContext, provider: string) {
  return `${ctx.config.PUBLIC_URL}/oauth/${provider}/callback`;
}

function stateOf(row: ConnectorAppRow | null) {
  if (!row) {
    return {
      configured: false,
      createdVia: null,
      appId: null,
      slug: null,
      name: null,
      unrouted: 0,
      lastUnroutedAt: null,
      rejections: 0,
      lastRejectedAt: null,
      lastRejection: null,
    };
  }
  return {
    configured: true,
    createdVia: row.createdVia,
    appId: row.appId,
    slug: row.slug,
    name: row.name,
    unrouted: row.unrouted,
    lastUnroutedAt: row.lastUnroutedAt,
    rejections: row.rejections,
    lastRejectedAt: row.lastRejectedAt,
    lastRejection: row.lastRejection,
  };
}

/** What an admin needs to see about a provider's app: its state and where it points. */
export function describeApp(
  ctx: AppContext,
  provider: string,
  row: ConnectorAppRow | null
) {
  const endpoints = getConnector(provider)?.app?.endpoints ?? {};
  return {
    provider,
    ...stateOf(row),
    credentials: getConnector(provider)?.app?.credentials ?? [],
    webhookUrls: Object.fromEntries(
      Object.entries(endpoints).map(([name, suffix]) => [
        name,
        `${ctx.config.PUBLIC_URL}/hooks/apps/${provider}${suffix ? `/${suffix}` : ""}`,
      ])
    ),
    callbackUrl: callbackUrl(ctx, provider),
  };
}

export async function describeApps(ctx: AppContext) {
  const apps = await listApps(ctx);
  return apps.map(({ connector, row }) => describeApp(ctx, connector.id, row));
}

/** Registers an app made by hand on the provider's site. */
export async function registerApp(
  ctx: AppContext,
  provider: string,
  input: {
    appId?: string;
    slug?: string;
    name?: string;
    credentials: Record<string, string>;
    replace?: boolean;
    secret?: string;
  }
) {
  await requireServerAdmin(ctx, input.secret);
  await saveApp(
    ctx,
    provider,
    {
      appId: input.appId ?? null,
      slug: input.slug ?? null,
      name: input.name ?? null,
      credentials: input.credentials,
      createdVia: "manual",
    },
    { replace: input.replace }
  );
  const row = await findConnectorApp(ctx.db, { provider });
  return describeApp(ctx, provider, row ?? null);
}

export function forgetCachedApps() {
  cache.clear();
}

function viewOfApp(ctx: AppContext, row: ConnectorAppRow): AppView {
  return {
    provider: row.provider,
    appId: row.appId,
    slug: row.slug,
    name: row.name,
    credentials: ctx.secrets.open(row.credentials),
  };
}
