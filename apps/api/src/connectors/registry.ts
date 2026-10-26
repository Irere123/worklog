import type { Connector } from "../ingest/types";
import { customConnector } from "./custom";
import { discordConnector } from "./discord";
import { giteaConnector, githubConnector } from "./github";
import { slackConnector } from "./slack";
import { webhookConnector } from "./webhook";

/**
 * Every connector this server knows. Adding a tool = implementing `Connector` and registering it
 * here (or, for webhook-only tools, configuring the generic "webhook" connector — no code).
 */
const registry = new Map<string, Connector>();

export function registerConnector(connector: Connector) {
  if (registry.has(connector.id)) {
    throw new Error(`Connector ${connector.id} is already registered`);
  }
  registry.set(connector.id, connector);
}

for (const c of [
  githubConnector,
  giteaConnector,
  slackConnector,
  discordConnector,
  webhookConnector,
  customConnector,
]) {
  registerConnector(c);
}

export const getConnector = (id: string) => registry.get(id);
export const listConnectors = () => [...registry.values()];
