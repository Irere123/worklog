import type { Pool } from "pg";

import { createModels } from "./agent/models";
import type { Models } from "./agent/models";
import { createAuth } from "./auth/auth";
import type { Auth } from "./auth/auth";
import type { Config } from "./config";
import { openDb } from "./db";
import type { DbOrTx } from "./db";
import { findUserById } from "./db/queries/users";
import { createMailer } from "./delivery/mailer";
import type { Mailer } from "./delivery/mailer";
import { EventBus } from "./events/bus";
import { installQueue } from "./jobs/queue";
import { SecretBox } from "./lib/crypto";
import { claimMemberships } from "./members/service";

export type AppContext = {
  config: Config;
  // The transaction inside `transact`; the pool everywhere else.
  db: DbOrTx;
  // For Graphile Worker, which takes a pg Pool.
  pool: Pool;
  auth: Auth;
  bus: EventBus;
  secrets: SecretBox;
  // null when no OPENROUTER_API_KEY: AI features fall back to deterministic templates.
  models: Models | null;
  mailer: Mailer;
  fetch: typeof fetch;
  now: () => Date;
  close: () => Promise<void>;
};

export async function createContext(
  config: Config,
  overrides: Partial<
    Pick<AppContext, "models" | "mailer" | "fetch" | "now">
  > = {}
): Promise<AppContext> {
  const { db, close } = await openDb(config.DATABASE_URL);
  await installQueue(db);
  const mailer = overrides.mailer ?? createMailer(config);
  const ctx: AppContext = {
    config,
    db,
    pool: db.$client,
    auth: createAuth(db, config, mailer, {
      // Runs after sign-in, long after ctx is built.
      onSignIn: async (userId) => {
        const user = await findUserById(db, { id: userId });
        if (user) {
          await claimMemberships(ctx, user);
        }
      },
    }),
    bus: new EventBus(db),
    secrets: new SecretBox(config.WORKLOG_SECRET_KEY),
    models:
      "models" in overrides ? (overrides.models ?? null) : createModels(config),
    mailer,
    fetch: overrides.fetch ?? fetch,
    now: overrides.now ?? (() => new Date()),
    close,
  };
  return ctx;
}
