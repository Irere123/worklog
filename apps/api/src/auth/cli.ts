// Side-effect-free: the CLI only needs the config to know which tables to generate, so the database is a throwaway in-memory one.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import { loadConfig } from "../config";
import { ConsoleMailer } from "../delivery/mailer";
import { createAuth } from "./auth";

export const auth = createAuth(
  drizzle({ client: new PGlite() }),
  loadConfig({ DATABASE_URL: "memory://" }),
  new ConsoleMailer()
);
