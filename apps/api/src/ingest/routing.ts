import { getConnector } from "#connectors";
import type { InboundRequest } from "#connectors/types";
import type { AppContext } from "#context";
import { findConnectionByExternalId } from "#db/queries/connections";

import { loadApp } from "./apps";
import { applyChange } from "./lifecycle";
import { accept, store } from "./pipeline";
import type { Reply } from "./pipeline";
import { viewOf } from "./view";

const RECHECK_MS = 10_000;
const rechecked = new Map<string, number>();

/**
 * The app endpoint: one URL per provider for the whole instance. The app's secret verifies the
 * request, and the installation it names picks the connection.
 */
export async function receiveForApp(
  ctx: AppContext,
  provider: string,
  req: InboundRequest
) {
  const connector = getConnector(provider);
  const app = connector?.app ? await loadApp(ctx, provider) : null;
  if (!connector?.app || !app) {
    return {
      status: 404,
      body: { error: `no ${provider} app on this server` },
    } satisfies Reply;
  }
  let received = await connector.receive(req, {
    secrets: app.credentials,
    settings: {},
  });
  if (received.type === "reject" && mayRecheck(provider)) {
    const fresh = await loadApp(ctx, provider, { fresh: true });
    if (fresh) {
      received = await connector.receive(req, {
        secrets: fresh.credentials,
        settings: {},
      });
    }
  }
  if (received.type === "reject") {
    ctx.tally.appRejected(provider, req.receivedAt, received.error);
    return {
      status: received.status,
      body: { error: received.error },
    } satisfies Reply;
  }
  if (received.type === "respond") {
    return {
      status: received.status ?? 200,
      body: received.body,
    } satisfies Reply;
  }
  const externalId = connector.app.route(received);
  const conn = externalId
    ? await findConnectionByExternalId(ctx.db, { provider, externalId })
    : undefined;
  if (!conn) {
    ctx.tally.unrouted(provider, req.receivedAt);
    return {
      status: 200,
      body: { ok: true, ignored: "no connection for this installation" },
    } satisfies Reply;
  }
  const change =
    received.type === "event"
      ? connector.app.lifecycle?.(received.eventType, received.payload)
      : null;
  if (change && received.type === "event") {
    const stored = await store(ctx, conn, {
      deliveryId: received.deliveryId,
      eventType: received.eventType,
      payload: received.payload,
      receivedAt: req.receivedAt,
      via: "app",
      partitionKey: received.partition ?? "",
    });
    if (!stored) {
      return {
        status: 200,
        body: { ok: true, duplicate: true },
      } satisfies Reply;
    }
    await applyChange(ctx, conn, change);
    return { status: 200, body: { ok: true } } satisfies Reply;
  }
  return await accept(
    ctx,
    { connector, conn, view: viewOf(ctx, conn) },
    req,
    received,
    "app"
  );
}

function mayRecheck(provider: string) {
  const last = rechecked.get(provider) ?? 0;
  if (Date.now() - last < RECHECK_MS) {
    return false;
  }
  rechecked.set(provider, Date.now());
  return true;
}
