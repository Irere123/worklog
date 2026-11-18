import { z } from "zod";

const Env = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default("0.0.0.0"),
  WORKER_PORT: z.coerce.number().int().default(4001),
  PUBLIC_URL: z.url().default("http://localhost:4000"),
  DATABASE_URL: z
    .string()
    .default("postgres://postgres:postgres@localhost:5432/worklog"),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(2).default(20),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(8),
  WORKLOG_SECRET_KEY: z.string().optional(),
  WORKLOG_SECRET_KEYS_PREVIOUS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean)
    ),
  SETUP_SECRET: z.string().optional(),
  SIGNUP: z.enum(["open", "closed"]).default("open"),

  AUTH_SECRET: z.string().min(32).optional(),
  WEB_ORIGINS: z.string().optional(),
  WEB_DIST: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_SLUG: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  DISCORD_PUBLIC_KEY: z.string().optional(),
  DISCORD_BOT_TOKEN: z.string().optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_APP_ID: z.string().optional(),

  OPENROUTER_API_KEY: z.string().optional(),
  WORKLOG_MODEL: z.string().default("anthropic/claude-opus-5.5"),
  WORKLOG_FAST_MODEL: z.string().default("anthropic/claude-haiku-5.5"),
  WORKLOG_TRANSCRIBE_MODEL: z.string().default("openai/whisper-large-v3-turbo"),

  RESEND_API_KEY: z.string().optional(),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("Worklog <worklog@localhost>"),

  INBOUND_RETENTION_DAYS: z.coerce.number().int().min(0).default(90),
  BACKFILL_DAYS: z.coerce.number().int().min(0).default(14),
  BACKFILL_NOTIFY_HOURS: z.coerce.number().int().min(0).default(48),

  TINYBIRD_TOKEN: z.string().optional(),
  TINYBIRD_HOST: z.url().default("https://api.tinybird.co"),
  TELEMETRY_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
  TELEMETRY_SLOW_MS: z.coerce.number().int().min(0).default(2000),
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
      given.PUBLIC_URL === undefined ? "PUBLIC_URL" : null,
    ].filter((name) => name !== null);
    if (missing.length > 0) {
      throw new Error(`${missing.join(", ")} required in production`);
    }
  }
  return parsed.data;
}

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
