import { DrizzleQueryError } from "drizzle-orm";
import { DatabaseError } from "pg";

// Ecto's `unique_constraint`: a query turns a known violation into a 409 instead of a 500. Checking
// before writing isn't enough, since two requests can pass the check together.
export function violates(error: unknown, constraint: string): boolean {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  return cause instanceof DatabaseError && cause.constraint === constraint;
}
