import { fileURLToPath } from "node:url";

import stylex from "@stylexjs/unplugin/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API = process.env.WORKLOG_API_URL ?? "http://localhost:4000";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    port: 3000,
    // Same origin as the API in dev, so the session cookie and the event stream need no CORS.
    proxy: {
      "/v1": { target: API, changeOrigin: true },
      "/api/auth": { target: API, changeOrigin: true },
    },
  },
  plugins: [
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
    tanstackStart({ spa: { enabled: true } }),
    react(),
  ],
});
