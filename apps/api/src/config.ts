import { z } from "zod";

const Env = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().default(4000),
  PUBLIC_URL: z.url().default("http://localhost:4000"),
  DATABASE_URL: z
    .string()
    .default("postgres://postgres:postgres@localhost:5432/worklog"),
  // Connections per process. Each running job holds one while it writes, so keep it above
  // WORKER_CONCURRENCY plus what the API needs.
  DATABASE_POOL_SIZE: z.coerce.number().int().min(2).default(20),
  // Jobs one process runs at once. Ingestion lanes run in parallel up to this.
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(8),
  // 32 bytes, hex or base64.
  WORKLOG_SECRET_KEY: z.string().optional(),
  // Comma-separated keys WORKLOG_SECRET_KEY replaced. They still open what they sealed until a
  // re-seal (daily, or `bun run secrets:reseal`) moves it to the current key.
  WORKLOG_SECRET_KEYS_PREVIOUS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean)
    ),
  // Allows POST /v1/setup after the first workspace exists (multi-workspace hosting).
  SETUP_SECRET: z.string().optional(),

  // Required in production: openssl rand -hex 32
  AUTH_SECRET: z.string().min(32).optional(),
  // Comma-separated.
  WEB_ORIGINS: z.string().optional(),
  // The built web app (apps/web/dist/client) to serve from this server's own origin.
  WEB_DIST: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  // The instance's GitHub App, if it isn't created from the API (POST /v1/apps/github/manifest).
  // The client id and secret above are the same app's, so one app signs people in and connects
  // repos. The private key may use \n for line breaks.
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_SLUG: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  // With the client id and secret, the instance's Discord app: servers add its bot with one click.
  DISCORD_PUBLIC_KEY: z.string().optional(),
  DISCORD_BOT_TOKEN: z.string().optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  // With the client id and secret, the instance's Slack app: workspaces install it with one click.
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_APP_ID: z.string().optional(),

  // Unset: AI features degrade to templates.
  OPENROUTER_API_KEY: z.string().optional(),
  WORKLOG_MODEL: z.string().default("anthropic/claude-opus-5.5"),
  WORKLOG_FAST_MODEL: z.string().default("anthropic/claude-haiku-5.5"),

  // Mail goes via Resend if RESEND_API_KEY is set, else SMTP if SMTP_URL is set, else the console.
  RESEND_API_KEY: z.string().optional(),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("Worklog <worklog@localhost>"),

  // Raw webhook deliveries are kept this long, and replay can't reach further back. 0 keeps them all.
  INBOUND_RETENTION_DAYS: z.coerce.number().int().min(0).default(90),
  // History a new connection reads from the provider's API, where the connector can.
  BACKFILL_DAYS: z.coerce.number().int().min(0).default(14),
  // Read back from the API, only something this recent may still notify or create a card. A review
  // requested a month ago and long since done must not ping anyone.
  BACKFILL_NOTIFY_HOURS: z.coerce.number().int().min(0).default(48),

  RUN_SCHEDULER: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(
  env: Record<string, string | undefined> = process.env
): Config {
  // `KEY=` in an .env file means "not set", not "set to an empty string".
  const parsed = Env.safeParse(
    Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ""))
  );
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
  }
  if (
    parsed.data.NODE_ENV === "production" &&
    (!parsed.data.WORKLOG_SECRET_KEY || !parsed.data.AUTH_SECRET)
  ) {
    throw new Error(
      "WORKLOG_SECRET_KEY and AUTH_SECRET are required in production"
    );
  }
  return parsed.data;
}
