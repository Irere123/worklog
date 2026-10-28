import type { Config } from "#config";
import type { ConnectorAppRow } from "#db/queries/connector-apps";
import type { SecretBox } from "#lib/crypto";

type SignInKeys = readonly [
  "GITHUB_CLIENT_ID" | "SLACK_CLIENT_ID" | "DISCORD_CLIENT_ID",
  "GITHUB_CLIENT_SECRET" | "SLACK_CLIENT_SECRET" | "DISCORD_CLIENT_SECRET",
];

const SIGN_IN = new Map<string, SignInKeys>([
  ["github", ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"]],
  ["slack", ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"]],
  ["discord", ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET"]],
]);

/**
 * The config with sign-in credentials filled in from the server's registered apps, where the
 * environment leaves them unset: an app's client id and secret are also its OAuth app.
 */
export function withAppSignIn(
  config: Config,
  apps: ConnectorAppRow[],
  secrets: SecretBox
): Config {
  const filled: Config = { ...config };
  for (const app of apps) {
    const keys = SIGN_IN.get(app.provider);
    // Either one set means the environment chose an OAuth app; half of another app is no use.
    if (!keys || filled[keys[0]] || filled[keys[1]]) {
      continue;
    }
    try {
      const { clientId, clientSecret } = secrets.open(app.credentials);
      if (clientId && clientSecret) {
        filled[keys[0]] = clientId;
        filled[keys[1]] = clientSecret;
      }
    } catch (error) {
      console.error(
        `[auth] can't read the ${app.provider} app's credentials`,
        error
      );
    }
  }
  return filled;
}
