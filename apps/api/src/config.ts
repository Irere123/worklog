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
  // 32 bytes, hex or base64.
  WORKLOG_SECRET_KEY: z.string().optional(),
  // Allows POST /v1/setup after the first workspace exists (multi-workspace hosting).
  SETUP_SECRET: z.string().optional(),

  // Required in production: openssl rand -hex 32
  AUTH_SECRET: z.string().min(32).optional(),
  // Comma-separated.
  WEB_ORIGINS: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),

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
