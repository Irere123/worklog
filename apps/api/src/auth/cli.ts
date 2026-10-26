/**
 * Side-effect-free entry point for the Better Auth CLI (`bun run auth:generate`). It only needs the
 * configuration to know which tables to generate; the database here is a throwaway in-memory one.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { loadConfig } from "../config";
import { ConsoleMailer } from "../delivery/mailer";
import { createAuth } from "./auth";

export const auth = createAuth(drizzle({ client: new PGlite() }), loadConfig({ DATABASE_URL: "memory://" }), new ConsoleMailer());
