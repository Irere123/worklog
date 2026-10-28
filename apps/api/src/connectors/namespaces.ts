// The built-in connectors' identity namespaces ("github", "gitea:<host>", "slack", "discord"):
// theirs alone, so a generic connection can't act as their users. A new built-in connector adds
// its id here (a test checks every registered one is).
const BUILT_IN = new Set(["github", "gitea", "slack", "discord"]);

// A generic connection's own namespace, used when it names none ("custom:<id>", "webhook:<id>"):
// another connection taking it would act as its users. Others under those prefixes are free.
const PER_CONNECTION = /^(?:custom|webhook):con_/u;

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
