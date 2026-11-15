import { fileURLToPath } from "node:url";

import stylex from "@stylexjs/unplugin/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

const API = process.env.WORKLOG_API_URL ?? "http://localhost:4000";

// The app draws icons in these weights only (docs/research/web-app-design.md).
const ICON_WEIGHTS = new Set(["regular", "fill", "bold"]);

// The modules libraries every page needs; each part allows Bun's nested node_modules layout.
const FRAMEWORK =
  /node_modules[\\/](?:\.bun[\\/][^\\/]+[\\/]node_modules[\\/])?(?:react|react-dom|scheduler|seroval|seroval-plugins|@tanstack[\\/](?:react-router|router-core|history|store|react-store|start-client-core|react-start|react-start-client|query-core|react-query))[\\/]/u;
const PRIMITIVES =
  /node_modules[\\/](?:\.bun[\\/][^\\/]+[\\/]node_modules[\\/])?(?:@base-ui|@floating-ui|sonner|tabbable|reselect|use-sync-external-store|openapi-fetch)[\\/]/u;

// The app's own small modules that most pages share. Ones that bring a heavy library along
// (Markdown, the date picker, form controls) load with the pages that use them, and the
// dialogs the shell loads once the page is idle stay out.
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
            // Left alone, every icon and small shared helper becomes its own file, and a first
            // visit on a phone waits on dozens of round trips. What every page needs ships as a
            // few long-cached files; libraries only one route uses stay with that route.
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
    // Same origin as the API in dev, so the session cookie and the event stream need no CORS.
    proxy: {
      "/v1": { target: API, changeOrigin: true },
      "/api/auth": { target: API, changeOrigin: true },
    },
  },
  plugins: [
    phosphorWeights(),
    // Start renders on the server and the client; both environments must collect the same rules.
    stylex({
      useCSSLayers: true,
      devPersistToDisk: true,
      // Append to our own stylesheet; the default picks the first index.css, a font's.
      cssInjectionTarget: (file: string) => file.includes("global"),
      // The compiler resolves token files itself to hash their variables, so it needs the alias too.
      aliases: { "#*": [fileURLToPath(new URL("src/*", import.meta.url))] },
      unstable_moduleResolution: {
        type: "commonJS",
        rootDir: import.meta.dirname,
      },
    }),
    tanstackStart({
      // The shell is rendered at a signed-in route, where only the root's head and scripts make it
      // into the HTML. At "/" (the default) it would take the front page's place.
      spa: { enabled: true, maskPath: "/home" },
      // The front page is the one route a stranger opens first, so it ships as HTML that paints
      // before the app's JavaScript arrives. Every other route is behind sign-in: the shell.
      // Its links lead to the API or behind sign-in, so the crawl stops at the page itself.
      pages: [{ path: "/", prerender: { enabled: true, crawlLinks: false } }],
    }),
    react(),
  ],
});

/**
 * Phosphor ships six weights in every icon module. Dropping the three we never draw cuts what
 * each icon costs to download and parse by about half.
 */
function phosphorWeights(): Plugin {
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
  };
}

// Splits a Map literal's entries at top-level commas; the definitions hold no strings with brackets.
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
