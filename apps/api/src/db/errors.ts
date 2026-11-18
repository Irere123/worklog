import { DrizzleQueryError } from "drizzle-orm";
import { DatabaseError } from "pg";

export function violates(error: unknown, constraint: string) {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  return cause instanceof DatabaseError && cause.constraint === constraint;
}
