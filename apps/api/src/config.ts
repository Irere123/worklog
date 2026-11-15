import { z } from "zod";

const Env = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().default(4000),
  // "::" listens on IPv6 as well, which Railway's private network uses. Left at 0.0.0.0 by
  // default: a host with IPv6 turned off can't bind "::".
  HOST: z.string().default("0.0.0.0"),
  // The worker's health check, apart from PORT so it can run beside the API on one machine.
  WORKER_PORT: z.coerce.number().int().default(4001),
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
  // Who may start a workspace once one exists: anyone who signs in (open, as a hosted Worklog
  // needs) or nobody, so people join only by invite (closed, for a team's own server).
  SIGNUP: z.enum(["open", "closed"]).default("open"),

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
  // Dictation's speech-to-text, through OpenRouter's transcription API. The fast model then fixes
  // the workspace's own names in what it heard, so a cheap model here is as accurate as a dear one.
  WORKLOG_TRANSCRIBE_MODEL: z.string().default("openai/whisper-large-v3-turbo"),

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

  // Spans, logs and runtime samples go to Tinybird (tinybird/ holds its project) when the token is
  // set, one with append rights on its datasources. Unset: logs only reach the console.
  TINYBIRD_TOKEN: z.string().optional(),
  // The workspace's region: https://api.tinybird.co, https://api.us-east.tinybird.co, …
  TINYBIRD_HOST: z.url().default("https://api.tinybird.co"),
  // Share of traces kept. A trace with an error, or slower than TELEMETRY_SLOW_MS, is always kept.
  TELEMETRY_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
  TELEMETRY_SLOW_MS: z.coerce.number().int().min(0).default(2000),
  // What's running, so an error can be traced to the deploy that brought it: a git sha or tag.
  WORKLOG_RELEASE: z.string().default("dev"),

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
  const given = withPlatformDefaults(
    Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ""))
  );
  const parsed = Env.safeParse(given);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
  }
  if (parsed.data.NODE_ENV === "production") {
    const missing = [
      parsed.data.WORKLOG_SECRET_KEY ? null : "WORKLOG_SECRET_KEY",
      parsed.data.AUTH_SECRET ? null : "AUTH_SECRET",
      // Sign-in links, OAuth callbacks and links in briefs all start with it: left at
      // localhost, they'd all point nowhere.
      given.PUBLIC_URL === undefined ? "PUBLIC_URL" : null,
    ].filter((name) => name !== null);
    if (missing.length > 0) {
      throw new Error(`${missing.join(", ")} required in production`);
    }
  }
  return parsed.data;
}

// What Railway sets on every deployment: the service's generated domain (a custom domain is set
// as PUBLIC_URL instead) and the commit it was built from.
function withPlatformDefaults(env: Record<string, string | undefined>) {
  return {
    ...env,
    PUBLIC_URL:
      env.PUBLIC_URL ??
      (env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${env.RAILWAY_PUBLIC_DOMAIN}`
        : undefined),
    WORKLOG_RELEASE: env.WORKLOG_RELEASE ?? env.RAILWAY_GIT_COMMIT_SHA,
  };
}
