import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "../context";
import { connections } from "../db/schema";
import { badRequest, notFound } from "../lib/errors";
import { newId } from "../lib/ids";
import { getConnector } from "./registry";
import { WebhookSettings } from "./webhook";

export type ConnectionRow = typeof connections.$inferSelect;

function validate(provider: string, secrets: Record<string, string>, settings: Record<string, unknown>) {
  const connector = getConnector(provider);
  if (!connector) throw badRequest(`Unknown connector "${provider}" — see GET /v1/connectors`);
  const missing = connector.secrets.filter((s) => s.required && !secrets[s.key]).map((s) => s.key);
  if (missing.length) throw badRequest(`${connector.name} connections need: ${missing.join(", ")}`);
  // Generic connectors get their own identity namespace: they must not be able to act as GitHub/Slack/Discord users.
  const ns = settings.identityNamespace;
  if (typeof ns === "string" && ["github", "slack", "discord"].includes(ns.split(":")[0]!)) {
    throw badRequest(`identityNamespace "${ns}" is reserved for the built-in ${ns} connector`);
  }
  if (provider === "webhook") {
    const parsed = WebhookSettings.safeParse(settings);
    if (!parsed.success) throw badRequest(`Invalid webhook settings: ${z.prettifyError(parsed.error)}`);
    if (parsed.data.verify.type !== "none" && !secrets.secret) throw badRequest("Signed webhooks need a `secret`");
  }
  return connector;
}

export async function createConnection(
  ctx: AppContext,
  workspaceId: string,
  input: { provider: string; name?: string; secrets?: Record<string, string>; settings?: Record<string, unknown> },
) {
  const connector = validate(input.provider, input.secrets ?? {}, input.settings ?? {});
  const row: ConnectionRow = {
    id: newId("con"),
    workspaceId,
    provider: input.provider,
    name: input.name ?? connector.name,
    status: "active",
    settings: input.settings ?? {},
    secrets: ctx.secrets.seal(input.secrets ?? {}),
    lastEventAt: null,
    createdAt: ctx.now(),
  };
  await ctx.db.insert(connections).values(row);
  return row;
}

export async function listConnections(ctx: AppContext, workspaceId: string) {
  return ctx.db.select().from(connections).where(eq(connections.workspaceId, workspaceId));
}

export async function getConnection(ctx: AppContext, workspaceId: string, id: string) {
  const [row] = await ctx.db
    .select()
    .from(connections)
    .where(and(eq(connections.id, id), eq(connections.workspaceId, workspaceId)));
  if (!row) throw notFound("Connection");
  return row;
}

export async function updateConnection(
  ctx: AppContext,
  workspaceId: string,
  id: string,
  patch: { name?: string; status?: ConnectionRow["status"]; settings?: Record<string, unknown>; secrets?: Record<string, string> },
) {
  const current = await getConnection(ctx, workspaceId, id);
  const secrets = { ...ctx.secrets.open<Record<string, string>>(current.secrets), ...patch.secrets };
  validate(current.provider, secrets, patch.settings ?? current.settings);
  const [row] = await ctx.db
    .update(connections)
    .set({ name: patch.name, status: patch.status, settings: patch.settings, secrets: ctx.secrets.seal(secrets) })
    .where(eq(connections.id, id))
    .returning();
  return row!;
}

export async function deleteConnection(ctx: AppContext, workspaceId: string, id: string) {
  await getConnection(ctx, workspaceId, id);
  await ctx.db.delete(connections).where(eq(connections.id, id));
}

/** The URLs to paste into the provider's app settings. */
export function webhookUrls(ctx: AppContext, conn: ConnectionRow): Record<string, string> {
  const endpoints = getConnector(conn.provider)?.endpoints ?? {};
  return Object.fromEntries(
    Object.entries(endpoints).map(([name, suffix]) => [name, `${ctx.config.PUBLIC_URL}/hooks/${conn.id}${suffix ? `/${suffix}` : ""}`]),
  );
}
