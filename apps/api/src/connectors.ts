import { customConnector } from "./connectors/custom";
import { discordConnector } from "./connectors/discord";
import { giteaConnector, githubConnector } from "./connectors/github";
import { slackConnector } from "./connectors/slack";
import type { Connector } from "./connectors/types";
import { webhookConnector } from "./connectors/webhook";

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
