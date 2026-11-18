import { z } from "@hono/zod-openapi";

export const Timestamp = z
  .date()
  .transform((d) => d.toISOString())
  .openapi({ format: "date-time", example: "2026-10-26T08:30:00.000Z" });

export const IsoTimestamp = z
  .string()
  .openapi({ format: "date-time", example: "2026-10-26T08:30:00.000Z" });

// oxlint-disable-next-line require-unicode-regexp -- see above
export const HH_MM = /^\d{1,2}:\d{2}$/;

/**
 * A response whose row lacks a field the contract has (`signedUp`, from `userId`). The schema still
 * documents and validates the output; `from` only adds what is missing, and the parse drops the
 * rest. The OpenAPI generator probes nullability and optionality by parsing null and undefined,
 * so those pass through for the schema to reject.
 */
export function derived<I, S extends z.ZodType>(
  schema: S,
  from: (row: I) => z.input<S>
): z.ZodPipe<z.ZodTransform<z.input<S>, I>, S> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
  return z.preprocess(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- rows only ever come from `respond`, typed by the return type above
    (row) => (row === null || row === undefined ? row : from(row as I)),
    schema
  ) as z.ZodPipe<z.ZodTransform<z.input<S>, I>, S>;
}

export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      issues: z.array(z.unknown()).optional(),
    }),
  })
  .openapi("Error");
