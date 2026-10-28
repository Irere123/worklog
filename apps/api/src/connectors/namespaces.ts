// The built-in connectors' identity namespaces ("github", "gitea:<host>", "slack", "discord"):
// theirs alone, so a generic connection can't act as their users. A new built-in connector adds
// its id here (a test checks every registered one is).
const BUILT_IN = new Set(["github", "gitea", "slack", "discord"]);

export function isBuiltInNamespace(namespace: string) {
  return BUILT_IN.has(namespace.split(":")[0] ?? "");
}

/**
 * A generic connection's namespace: the one its settings name, unless that is a built-in
 * connector's, which a connection set up before it was reserved might still hold.
 */
export function chosenNamespace(
  settings: Record<string, unknown>,
  fallback: string
) {
  const chosen = settings.identityNamespace;
  return typeof chosen === "string" && !isBuiltInNamespace(chosen)
    ? chosen
    : fallback;
}
