import { fileURLToPath } from "node:url";

import stylex from "@stylexjs/unplugin/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

const API = process.env.WORKLOG_API_URL ?? "http://localhost:4000";

const ICON_WEIGHTS = new Set(["regular", "fill", "bold"]);

const FRAMEWORK =
  /node_modules[\\/](?:\.bun[\\/][^\\/]+[\\/]node_modules[\\/])?(?:react|react-dom|scheduler|seroval|seroval-plugins|@tanstack[\\/](?:react-router|router-core|history|store|react-store|start-client-core|react-start|react-start-client|query-core|react-query))[\\/]/u;
const PRIMITIVES =
  /node_modules[\\/](?:\.bun[\\/][^\\/]+[\\/]node_modules[\\/])?(?:@base-ui|@floating-ui|sonner|tabbable|reselect|use-sync-external-store|openapi-fetch)[\\/]/u;

const SHARED =
  /[\\/]src[\\/](?:ui|lib|api|features[\\/](?:shell|auth)|features[\\/]cards[\\/](?:card-bits|card-refs|actions)|features[\\/]inbox[\\/]kinds|features[\\/]assistant[\\/]composer|features[\\/]activity[\\/]activity-line)[\\/.]/u;
const HEAVY =
  /[\\/]src[\\/](?:ui[\\/](?:markdown|date-picker|field)|features[\\/]shell[\\/](?:command|shortcuts|quick-log))\./u;

function isShared(id: string) {
  return SHARED.test(id) && !HEAVY.test(id) && !id.includes("node_modules");
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  environments: {
    client: {
      build: {
        rolldownOptions: {
          output: {
            codeSplitting: {
              groups: [
                { name: "icons", test: /@phosphor-icons/u, priority: 3 },
                { name: "framework", test: FRAMEWORK, priority: 2 },
                { name: "ui", test: PRIMITIVES, priority: 1 },
                { name: "app", test: isShared, priority: 1 },
              ],
            },
          },
        },
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/v1": { target: API, changeOrigin: true },
      "/api/auth": { target: API, changeOrigin: true },
    },
  },
  plugins: [
    phosphorWeights(),
    stylex({
      useCSSLayers: true,
      devPersistToDisk: true,
      cssInjectionTarget: (file: string) => file.includes("global"),
      aliases: { "#*": [fileURLToPath(new URL("src/*", import.meta.url))] },
      unstable_moduleResolution: {
        type: "commonJS",
        rootDir: import.meta.dirname,
      },
    }),
    tanstackStart({
      spa: { enabled: true, maskPath: "/home" },
      pages: ["/", "/pricing", "/faq", "/changelog", "/terms", "/privacy"].map(
        (path) => ({
          path,
          prerender: { enabled: true, crawlLinks: false },
        })
      ),
    }),
    react(),
  ],
});

function phosphorWeights() {
  return {
    name: "worklog:phosphor-weights",
    enforce: "pre",
    transform: {
      filter: {
        id: /@phosphor-icons[\\/]react[\\/]dist[\\/]defs[\\/][^\\/]+\.es\.js$/u,
      },
      handler(code) {
        const open = code.indexOf("new Map([");
        if (open === -1) {
          return null;
        }
        const start = open + "new Map([".length;
        const entries = splitEntries(code, start);
        if (!entries) {
          return null;
        }
        const kept = entries.list.filter((entry) =>
          ICON_WEIGHTS.has(
            /^\s*\[\s*"(?<weight>[a-z]+)"/u.exec(entry)?.groups?.weight ?? ""
          )
        );
        return {
          code: code.slice(0, start) + kept.join(",") + code.slice(entries.end),
          map: null,
        };
      },
    },
  } satisfies Plugin;
}

function splitEntries(code: string, start: number) {
  const list: string[] = [];
  let depth = 0;
  let from = start;
  for (let at = start; at < code.length; at += 1) {
    const char = code[at];
    if (char === "[" || char === "(" || char === "{") {
      depth += 1;
    } else if (char === "]" || char === ")" || char === "}") {
      if (depth === 0) {
        list.push(code.slice(from, at));
        return { list: list.filter((entry) => entry.trim()), end: at };
      }
      depth -= 1;
    } else if (char === "," && depth === 0) {
      list.push(code.slice(from, at));
      from = at + 1;
    }
  }
  return null;
}
