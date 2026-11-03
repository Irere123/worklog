import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import tanstack from "ultracite/oxlint/tanstack";

// Ultracite's core preset (https://www.ultracite.ai) with a few deliberate
// departures. Each one says why; add to this list only with a reason.
export default defineConfig({
  extends: [core, react, tanstack],
  ignorePatterns: [
    ...core.ignorePatterns,
    // Generated: drizzle-kit migrations and better-auth's tables.
    "apps/api/drizzle/**",
    "apps/api/src/db/auth-schema.ts",
    // Generated: the API types (openapi-typescript) and the route tree (TanStack Router).
    "apps/web/src/api/schema.d.ts",
    "apps/web/src/routeTree.gen.ts",
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
    {
      // Queries live in src/db/queries (AGENTS.md, Database), so domain code
      // can't build SQL. The match is on the bare name, so driver subpaths
      // such as drizzle-orm/node-postgres pass; only db/ imports those.
      files: ["apps/api/src/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "drizzle-orm",
                message: "Write the query in src/db/queries and call it.",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["apps/api/src/db/**"],
      rules: { "no-restricted-imports": "off" },
    },
    {
      // Logs go through `log` (src/telemetry/log.ts), which keeps them with their trace and
      // groups errors into issues; a console line reaches neither.
      files: ["apps/api/src/**"],
      rules: { "no-console": "error" },
    },
    {
      files: ["apps/api/src/telemetry/**"],
      rules: { "no-console": "off" },
    },
    {
      files: ["apps/web/**"],
      rules: {
        // StyleX convention: each file's \`stylex.create\` sits below its components, which
        // read the styles only when they render, long after the module has loaded.
        "no-use-before-define": [
          "error",
          { functions: false, classes: true, variables: false },
        ],
        // \`onClick={() => setOpen(true)}\` is the React idiom; braces on every one-line
        // handler add noise without catching anything.
        "typescript/no-confusing-void-expression": [
          "error",
          { ignoreArrowShorthand: true },
        ],
        // Components follow the repo-wide func-style rule: top-level declarations.
        "react/function-component-definition": "off",
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
    // Written for Node-style callbacks; Hono's `await next()` middleware can't
    // satisfy it without tripping no-confusing-void-expression.
    "node/callback-return": "off",
    // `if (name)` meaning "present and non-empty" is the intent wherever a
    // string is nullable. Nullable numbers and booleans stay strict: 0 and
    // false are where the real bugs hide.
    "typescript/strict-boolean-expressions": [
      "error",
      { allowNullableString: true },
    ],
    // Imports that leave their folder use the `#` aliases (apps/api/package.json), so they read
    // the same from every file and one search finds every importer of a module.
    "import/no-relative-parent-imports": "error",
  },
});
