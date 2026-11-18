import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import tanstack from "ultracite/oxlint/tanstack";

export default defineConfig({
  extends: [core, react, tanstack],
  ignorePatterns: [
    ...core.ignorePatterns,
    "apps/api/drizzle/**",
    "apps/api/src/db/auth-schema.ts",
    "apps/web/src/api/schema.d.ts",
    "apps/web/src/routeTree.gen.ts",
  ],
  options: { typeAware: true },
  jsPlugins: [
    { name: "landmines-testing", specifier: "@interfere/landmines/testing" },
    { name: "landmines-style", specifier: "@interfere/landmines/style" },
    {
      name: "landmines-structure",
      specifier: "@interfere/landmines/structure",
    },
    { name: "landmines-types", specifier: "@interfere/landmines/types" },
  ],
  overrides: [
    {
      files: ["**/test/**", "**/*.test.ts"],
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
      files: ["apps/api/src/db/**", "apps/api/src/**/*.test.ts"],
      rules: { "no-restricted-imports": "off" },
    },
    {
      files: ["apps/api/src/**"],
      rules: { "no-console": "error" },
    },
    {
      files: ["apps/api/src/telemetry/**"],
      rules: { "no-console": "off" },
    },
    {
      files: ["apps/web/**", "apps/api/src/emails/**"],
      rules: {
        "no-use-before-define": [
          "error",
          { functions: false, classes: true, variables: false },
        ],
        "typescript/no-confusing-void-expression": [
          "error",
          { ignoreArrowShorthand: true },
        ],
        "react/function-component-definition": "off",
      },
    },
  ],
  rules: {
    "sort-keys": "off",
    "no-await-in-loop": "off",
    "func-style": ["error", "declaration", { allowArrowFunctions: true }],
    "no-use-before-define": [
      "error",
      { functions: false, classes: true, variables: true },
    ],
    "typescript/consistent-type-definitions": ["error", "type"],
    "node/callback-return": "off",
    "typescript/strict-boolean-expressions": [
      "error",
      { allowNullableString: true },
    ],
    "import/no-relative-parent-imports": "error",
    "landmines-testing/no-fixed-sleep": [
      "error",
      {
        allow: {
          "apps/api/test/assistant.test.ts": 15,
          "apps/api/test/board.test.ts": 1,
          "apps/api/src/ingest/discord-gateway.test.ts": 3,
          "apps/api/test/mcp.test.ts": 2,
          "apps/api/test/memory.test.ts": 1,
          "apps/api/test/pipeline.test.ts": 1,
          "apps/api/test/realtime.test.ts": 4,
          "apps/api/test/scale.test.ts": 1,
        },
      },
    ],
    "landmines-testing/no-flake-masking": [
      "error",
      {
        allow: {
          "apps/api/src/ingest/discord-gateway.test.ts": 2,
          "apps/api/test/order.test.ts": 1,
          "apps/api/test/pipeline.test.ts": 1,
          "apps/api/test/scale.test.ts": 1,
        },
      },
    ],
    "landmines-testing/no-test-doubles": "error",
    "landmines-testing/no-unsignaled-poll": "error",
    "landmines-testing/strict-msw": "error",
    "landmines-style/no-comments": "error",
    "landmines-structure/colocated-tests": "error",
    "landmines-structure/package-exports": "error",
    "landmines-structure/test-file-names": "error",
    "landmines-types/no-explicit-return-types": "error",
  },
});
