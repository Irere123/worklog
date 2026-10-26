import { z } from "zod";

const Env = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().default(4000),
  /** Public base URL of this server, used in links (emails, webhook URLs). */
  PUBLIC_URL: z.url().default("http://localhost:4000"),
  /**
   * postgres://... for a real Postgres server. Anything else is treated as an
   * embedded PGlite data directory ("memory://" keeps it in memory).
   */
  DATABASE_URL: z.string().default("./.data/pglite"),
  /** 32-byte key (hex or base64) used to encrypt connector secrets at rest. */
  WORKLOG_SECRET_KEY: z.string().optional(),
  /** Allows POST /v1/setup after the first workspace exists (multi-workspace hosting). */
  SETUP_SECRET: z.string().optional(),

  /** Signs sessions and auth tokens (Better Auth). Required in production: openssl rand -hex 32 */
  AUTH_SECRET: z.string().min(32).optional(),
  /** Extra browser origins allowed to use cookie sessions (comma-separated), e.g. the web app's URL. */
  WEB_ORIGINS: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),

  /** AI runs through OpenRouter, so any model is one env var away. Unset = AI features degrade to templates. */
  OPENROUTER_API_KEY: z.string().optional(),
  WORKLOG_MODEL: z.string().default("anthropic/claude-opus-5.5"),
  WORKLOG_FAST_MODEL: z.string().default("anthropic/claude-haiku-5.5"),

  /** Email: Resend if RESEND_API_KEY is set, else SMTP if SMTP_URL is set, else printed to the console. */
  RESEND_API_KEY: z.string().optional(),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("Worklog <worklog@localhost>"),

  /** Run the scheduler (automations, entropy) inside the API process. */
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
