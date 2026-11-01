import path from "node:path";

import { router } from "./router";

// Paths the API owns: they keep their JSON 404s instead of falling through to the web app.
const API_PATH = /^\/(?:v1|api|hooks|docs|openapi\.json|health)(?:\/|$)/u;

// Built assets carry a content hash in their names, so a cached copy is never stale.
const IMMUTABLE = "public, max-age=31536000, immutable";

/**
 * The built web app (apps/web/dist/client), served beside the API from one origin, so the
 * session cookie and the event stream need no CORS. Any other path gets the app's shell, which
 * routes on the client.
 */
export function webAppRoutes(dist: string) {
  const root = path.resolve(dist);
  const shell = Bun.file(`${root}/_shell.html`);
  return router().get("*", async (c) => {
    if (API_PATH.test(c.req.path)) {
      return await c.notFound();
    }
    const wanted = path.resolve(root, `.${decodeURIComponent(c.req.path)}`);
    // Only files inside the build: `..` in a path must not reach the rest of the disk.
    const file = wanted.startsWith(root + path.sep) ? Bun.file(wanted) : null;
    if (file && (await file.exists())) {
      if (c.req.path.startsWith("/assets/")) {
        c.header("cache-control", IMMUTABLE);
      }
      return c.body(await file.arrayBuffer(), 200, {
        "content-type": file.type,
      });
    }
    return c.html(await shell.text());
  });
}
