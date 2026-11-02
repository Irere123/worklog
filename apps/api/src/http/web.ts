import { readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";

import type { Context } from "hono";

import { router } from "./router";

// Paths the API owns: they keep their JSON 404s instead of falling through to the web app.
const API_PATH = /^\/(?:v1|api|hooks|docs|openapi\.json|health)(?:\/|$)/u;

// Built assets carry a content hash in their names, so a cached copy is never stale.
const IMMUTABLE = "public, max-age=31536000, immutable";

// Fonts and images are compressed already; a second pass costs CPU and saves nothing.
const COMPRESSIBLE =
  /^(?:text\/|application\/(?:javascript|json|manifest\+json)|image\/svg)/u;

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

type Encoding = "br" | "gzip";

type Served = {
  type: string;
  raw: ArrayBuffer;
  encoded: Partial<Record<Encoding, ArrayBuffer>>;
};

/**
 * The built web app (apps/web/dist/client), served beside the API from one origin, so the
 * session cookie and the event stream need no CORS. Any other path gets the app's shell, which
 * routes on the client.
 */
export function webAppRoutes(dist: string) {
  const root = path.resolve(dist);
  // The build never changes while the server runs, so each file is read and compressed once.
  // Only files that exist are kept: a request for any other path must not grow the cache.
  const cache = new Map<string, Promise<Served | null>>();
  const load = async (file: string) => {
    let served = cache.get(file);
    if (!served) {
      served = readServed(file).catch(() => null);
      cache.set(file, served);
    }
    const found = await served;
    if (!found) {
      cache.delete(file);
    }
    return found;
  };
  // Compressed on the zlib thread pool at startup, so the first visitor doesn't wait on it.
  void warm(root, load);

  return router().get("*", async (c) => {
    if (API_PATH.test(c.req.path)) {
      return await c.notFound();
    }
    const wanted = path.resolve(root, `.${decoded(c.req.path)}`);
    // Only files inside the build: `..` in a path must not reach the rest of the disk.
    const asset = wanted.startsWith(root + path.sep)
      ? await load(wanted)
      : null;
    if (asset) {
      if (c.req.path.startsWith("/assets/")) {
        c.header("cache-control", IMMUTABLE);
      }
      return send(c, asset);
    }
    // A tab on an older build asks for chunks this one doesn't have: a 404 lets it fail cleanly,
    // where the shell would arrive as a script and break with a MIME error.
    if (c.req.path.startsWith("/assets/")) {
      return await c.notFound();
    }
    const shell = await load(`${root}/_shell.html`);
    if (!shell) {
      return await c.notFound();
    }
    // The shell names this build's hashed assets, so a cached copy would load a stale build.
    c.header("cache-control", "no-cache");
    return send(c, shell);
  });
}

// A malformed escape (`%E0%A4%A`) names no file; it gets the shell like any unknown path.
function decoded(pathname: string) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return "/";
  }
}

async function warm(root: string, load: (file: string) => Promise<unknown>) {
  const files = await readdir(root, { recursive: true }).catch(() => []);
  for (const file of files) {
    // One at a time: warming must not crowd out requests arriving meanwhile.
    await load(path.join(root, file)).catch(() => null);
  }
}

async function readServed(file: string): Promise<Served | null> {
  const handle = Bun.file(file);
  const stat = await handle.stat().catch(() => null);
  if (stat?.isFile() !== true) {
    return null;
  }
  const raw = await handle.arrayBuffer();
  const { type } = handle;
  if (raw.byteLength < 1024 || !COMPRESSIBLE.test(type)) {
    return { type, raw, encoded: {} };
  }
  return {
    type,
    raw,
    encoded: {
      br: copied(
        await brotli(raw, {
          params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
        })
      ),
      gzip: copied(await gzipAsync(raw, { level: 9 })),
    },
  };
}

// A Buffer may share a larger pool; the response wants exactly its bytes.
function copied(buffer: Buffer) {
  return Uint8Array.from(buffer).buffer;
}

function send(c: Context, served: Served) {
  const encoding = pickEncoding(c.req.header("accept-encoding"), served);
  const headers: Record<string, string> = { "content-type": served.type };
  if (Object.keys(served.encoded).length > 0) {
    headers.vary = "accept-encoding";
  }
  const body = encoding === null ? undefined : served.encoded[encoding];
  if (encoding !== null && body !== undefined) {
    headers["content-encoding"] = encoding;
    return c.body(body, 200, headers);
  }
  return c.body(served.raw, 200, headers);
}

// `br;q=0` names Brotli only to refuse it.
function accepts(accepted: string, encoding: Encoding) {
  return accepted.split(",").some((part) => {
    const [name, ...params] = part.trim().split(";");
    const q = params
      .map((param) => param.trim())
      .find((param) => param.startsWith("q="));
    return (
      name?.trim() === encoding && (q === undefined || Number(q.slice(2)) > 0)
    );
  });
}

function pickEncoding(accepted: string | undefined, served: Served) {
  if (accepted === undefined) {
    return null;
  }
  const encodings: Encoding[] = ["br", "gzip"];
  return (
    encodings.find(
      (encoding) =>
        served.encoded[encoding] !== undefined && accepts(accepted, encoding)
    ) ?? null
  );
}
