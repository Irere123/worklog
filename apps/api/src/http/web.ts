import { readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";

import type { Context } from "hono";

import { router } from "./router";

const API_PATH = /^\/(?:v1|api|hooks|docs|openapi\.json|health)(?:\/|$)/u;

const IMMUTABLE = "public, max-age=31536000, immutable";

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
  void warm(root, load);

  return router().get("*", async (c) => {
    if (API_PATH.test(c.req.path)) {
      return await c.notFound();
    }
    const name = decoded(c.req.path);
    const wanted = name === null ? null : path.resolve(root, `.${name}`);
    const asset =
      wanted !== null && wanted.startsWith(root + path.sep)
        ? await load(wanted)
        : null;
    if (asset) {
      if (c.req.path.startsWith("/assets/")) {
        c.header("cache-control", IMMUTABLE);
      }
      return send(c, asset);
    }
    if (
      wanted !== null &&
      (wanted === root || wanted.startsWith(root + path.sep))
    ) {
      const page = await load(path.join(wanted, "index.html"));
      if (page) {
        c.header("cache-control", "no-cache");
        return send(c, page);
      }
    }
    if (c.req.path.startsWith("/assets/")) {
      return await c.notFound();
    }
    const shell = await load(`${root}/_shell.html`);
    if (!shell) {
      return await c.notFound();
    }
    c.header("cache-control", "no-cache");
    return send(c, shell);
  });
}

function decoded(pathname: string) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

async function warm(root: string, load: (file: string) => Promise<unknown>) {
  const files = await readdir(root, { recursive: true }).catch(() => []);
  for (const file of files) {
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
