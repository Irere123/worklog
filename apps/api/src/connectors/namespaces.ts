const BUILT_IN = new Set(["github", "gitea", "gitlab", "slack", "discord"]);

const PER_CONNECTION = /^(?:custom|webhook):(?:con_|[0-9A-Za-z]{27}$)/u;

export function isBuiltInNamespace(namespace: string) {
  return BUILT_IN.has(namespace.split(":")[0] ?? "");
}

export function isConnectionNamespace(namespace: string) {
  return PER_CONNECTION.test(namespace);
}

/**
 * A generic connection's namespace: the one its settings name, unless that is a built-in
 * connector's or another connection's own, which a connection set up before they were reserved
 * might still hold.
 */
export function chosenNamespace(
  settings: Record<string, unknown>,
  own: string
) {
  const chosen = settings.identityNamespace;
  return typeof chosen === "string" &&
    !isBuiltInNamespace(chosen) &&
    !(isConnectionNamespace(chosen) && chosen !== own)
    ? chosen
    : own;
}
