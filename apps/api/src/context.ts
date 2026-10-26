import { createModels, type Models } from "./agent/models";
import { createAuth, type Auth } from "./auth/auth";
import type { Config } from "./config";
import { openDb, schema, type Db } from "./db";
import { eq } from "drizzle-orm";
import { createMailer, type Mailer } from "./delivery/mailer";
import { EventBus } from "./events/bus";
import { SecretBox } from "./lib/crypto";
import { claimMemberships } from "./members/service";

/** Everything a request handler, connector or automation needs. Built once per process. */
export type AppContext = {
  config: Config;
  db: Db;
  /** Better Auth: human sign-in (magic link, GitHub, Discord, Slack) and sessions. */
  auth: Auth;
  bus: EventBus;
  secrets: SecretBox;
  /** null when no OPENROUTER_API_KEY: AI features fall back to deterministic templates. */
  models: Models | null;
  mailer: Mailer;
  /** Outbound HTTP (Slack, Discord, webhooks) — injectable for tests. */
  fetch: typeof fetch;
  now: () => Date;
  /** Set by the scheduler: wakes the job queue right away (e.g. after a webhook is stored). */
  kickQueue?: () => void;
  close: () => Promise<void>;
};

export async function createContext(
  config: Config,
  overrides: Partial<Pick<AppContext, "models" | "mailer" | "fetch" | "now">> = {},
): Promise<AppContext> {
  const { db, close } = await openDb(config.DATABASE_URL);
  const mailer = overrides.mailer ?? createMailer(config);
  const ctx: AppContext = {
    config,
    db,
    auth: undefined as unknown as Auth,
    bus: new EventBus(db),
    secrets: new SecretBox(config.WORKLOG_SECRET_KEY),
    models: "models" in overrides ? (overrides.models ?? null) : createModels(config),
    mailer,
    fetch: overrides.fetch ?? fetch,
    now: overrides.now ?? (() => new Date()),
    close,
  };
  ctx.auth = createAuth(db, config, mailer, {
    onSignIn: async (userId) => {
      const [user] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
      if (user) await claimMemberships(ctx, user);
    },
  });
  return ctx;
}
