// Side-effect-free: the CLI only needs the config to know which tables to generate, so the pool never connects.
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { loadConfig } from "#config";
import { schema } from "#db";
import { createAuth } from "#lib/auth";
import { ConsoleMailer } from "#lib/mailer";

export const auth = createAuth(
  drizzle({ client: new Pool(), schema }),
  loadConfig({}),
  new ConsoleMailer()
);
