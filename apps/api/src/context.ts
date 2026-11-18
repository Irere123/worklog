import type { Pool } from "pg";

import { createModels } from "./agent/models";
import type { Models } from "./agent/models";
import type { Config } from "./config";
import { openDb } from "./db";
import type { DbOrTx } from "./db";
import { listConnectorApps } from "./db/queries/connector-apps";
import { findUserById } from "./db/queries/users";
import { EventBus } from "./events";
import { withAppSignIn } from "./ingest/sign-in";
import { Tally } from "./ingest/tally";
import { installQueue } from "./jobs/queue";
import { createAuth } from "./lib/auth";
import type { Auth } from "./lib/auth";
import { SecretBox } from "./lib/crypto";
import { createMailer } from "./lib/mailer";
import type { Mailer } from "./lib/mailer";
import { tracedFetch } from "./telemetry/instrument";
import { startTelemetry } from "./telemetry/start";
import { agentWorkspace } from "./work/agents";
import { claimMemberships } from "./work/members";

export type AppContext = {
  config: Config;
  db: DbOrTx;
  pool: Pool;
  auth: Auth;
  bus: EventBus;
  tally: Tally;
  secrets: SecretBox;
  models: Models | null;
  mailer: Mailer;
  fetch: typeof fetch;
  now: () => Date;
  close: () => Promise<void>;
};

export async function createContext(
  env: Config,
  overrides: Partial<
    Pick<AppContext, "models" | "mailer" | "fetch" | "now">
  > & { service?: string } = {}
): Promise<AppContext> {
  const { db, close } = await openDb(env.DATABASE_URL, env.DATABASE_POOL_SIZE);
  const rawFetch = overrides.fetch ?? fetch;
  const stopTelemetry = startTelemetry(env, {
    service: overrides.service ?? "script",
    pool: db.$client,
    fetch: rawFetch,
  });
  await installQueue(db);
  const secrets = new SecretBox(
    env.WORKLOG_SECRET_KEY,
    env.WORKLOG_SECRET_KEYS_PREVIOUS
  );
  const config = withAppSignIn(env, await listConnectorApps(db), secrets);
  const mailer = overrides.mailer ?? createMailer(config);
  const tally = new Tally(db);
  const stopTally = tally.start();
  const ctx: AppContext = {
    config,
    db,
    pool: db.$client,
    auth: createAuth(db, config, mailer, {
      onSignIn: async (userId) => {
        const user = await findUserById(db, { id: userId });
        if (user) {
          await claimMemberships(ctx, user);
        }
      },
      agentWorkspace: async (userId, picked) =>
        await agentWorkspace(ctx, userId, picked),
    }),
    bus: new EventBus(db),
    tally,
    secrets,
    models:
      "models" in overrides ? (overrides.models ?? null) : createModels(config),
    mailer,
    fetch: tracedFetch(rawFetch),
    now: overrides.now ?? (() => new Date()),
    close: async () => {
      try {
        stopTally();
        await tally.flush();
        await close();
      } finally {
        await stopTelemetry();
      }
    },
  };
  return ctx;
}
