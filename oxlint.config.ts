import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";

// Ultracite's core preset (https://www.ultracite.ai) with a few deliberate
// departures. Each one says why; add to this list only with a reason.
export default defineConfig({
  extends: [core],
  ignorePatterns: [
    ...core.ignorePatterns,
    // Generated: drizzle-kit migrations and better-auth's tables.
    "apps/api/drizzle/**",
    "apps/api/src/db/auth-schema.ts",
  ],
  options: { typeAware: true },
  overrides: [
    {
      // Tests read untyped JSON responses and assert on their shape; a wrong
      // shape fails the assertion, which is the check that matters here.
      files: ["**/test/**"],
      rules: {
        "typescript/no-explicit-any": "off",
        "typescript/no-non-null-assertion": "off",
        "typescript/no-unsafe-argument": "off",
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-call": "off",
        "typescript/no-unsafe-member-access": "off",
        "typescript/no-unsafe-return": "off",
        "typescript/no-unsafe-type-assertion": "off",
        "unicorn/no-await-expression-member": "off",
      },
    },
  ],
  rules: {
    // Key order carries meaning: schemas, table columns, API responses and
    // log fields are ordered for the reader, not the alphabet.
    "sort-keys": "off",
    // Awaits in loops are deliberate: ingestion and replay are ordered per
    // connection, and most loops run inside one transaction, where queries
    // run one at a time anyway. Use Promise.all where work is independent.
    "no-await-in-loop": "off",
    // Top-level functions are declarations (hoisted, named in stack traces);
    // arrows are for callbacks. Files read top-down: exports first, helpers
    // below, which hoisting makes safe.
    "func-style": ["error", "declaration", { allowArrowFunctions: true }],
    "no-use-before-define": [
      "error",
      { functions: false, classes: true, variables: true },
    ],
    // Shapes flow into jsonb columns typed as Record<string, unknown>;
    // interfaces have no implicit index signature, so they don't fit.
    "typescript/consistent-type-definitions": ["error", "type"],
    // `if (name)` meaning "present and non-empty" is the intent wherever a
    // string is nullable. Nullable numbers and booleans stay strict: 0 and
    // false are where the real bugs hide.
    // Written for Node-style callbacks; Hono's `await next()` middleware can't
    // satisfy it without tripping no-confusing-void-expression.
    "node/callback-return": "off",
    "typescript/strict-boolean-expressions": [
      "error",
      { allowNullableString: true },
    ],
  },
});
