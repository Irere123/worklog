import { eq } from "drizzle-orm";

import { createModels } from "./agent/models";
import type { Models } from "./agent/models";
import { createAuth } from "./auth/auth";
import type { Auth } from "./auth/auth";
import type { Config } from "./config";
import { openDb, schema } from "./db";
import type { Db } from "./db";
import { createMailer } from "./delivery/mailer";
import type { Mailer } from "./delivery/mailer";
import { EventBus } from "./events/bus";
import { SecretBox } from "./lib/crypto";
import { claimMemberships } from "./members/service";

export type AppContext = {
  config: Config;
  db: Db;
  auth: Auth;
  bus: EventBus;
  secrets: SecretBox;
  // null when no OPENROUTER_API_KEY: AI features fall back to deterministic templates.
  models: Models | null;
  mailer: Mailer;
  fetch: typeof fetch;
  now: () => Date;
  kickQueue?: () => void;
  close: () => Promise<void>;
};

export async function createContext(
  config: Config,
  overrides: Partial<
    Pick<AppContext, "models" | "mailer" | "fetch" | "now">
  > = {}
): Promise<AppContext> {
  const { db, close } = await openDb(config.DATABASE_URL);
  const mailer = overrides.mailer ?? createMailer(config);
  const ctx: AppContext = {
    config,
    db,
    auth: createAuth(db, config, mailer, {
      // Runs after sign-in, long after ctx is built.
      onSignIn: async (userId) => {
        const [user] = await db
          .select()
          .from(schema.user)
          .where(eq(schema.user.id, userId));
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
