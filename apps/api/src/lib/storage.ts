import { AwsV4Signer } from "aws4fetch";

import type { Config } from "#config";

import { upstreamFailed } from "./errors";

/**
 * Files people upload, in a Cloudflare R2 bucket served from its public URL. Talks R2's S3 API,
 * so any S3-compatible store with a public URL works too.
 */
export type Storage = {
  /** Stores the file and returns the address anyone can load it from. */
  put: (key: string, body: Uint8Array, contentType: string) => Promise<string>;
  delete: (key: string) => Promise<void>;
  /** The key of a file this bucket serves, or undefined for any other address. */
  keyOf: (url: string) => string | undefined;
};

export function storageEnabled(config: Config) {
  return Boolean(
    config.R2_ACCOUNT_ID &&
    config.R2_ACCESS_KEY_ID &&
    config.R2_SECRET_ACCESS_KEY &&
    config.R2_BUCKET &&
    config.R2_PUBLIC_URL
  );
}

/**
 * `fetch` is read on every call rather than captured, so swapping the context's fetch (as tests
 * do) reaches the bucket too.
 */
export function createStorage(
  config: Config,
  fetch: () => typeof globalThis.fetch
) {
  if (!storageEnabled(config)) {
    return null;
  }
  const bucket = `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${config.R2_BUCKET}`;
  const publicUrl = `${config.R2_PUBLIC_URL?.replace(/\/+$/u, "")}/`;

  async function send(
    method: "PUT" | "DELETE",
    key: string,
    init: { body?: Uint8Array; headers?: Record<string, string> } = {}
  ) {
    const signed = await new AwsV4Signer({
      method,
      url: `${bucket}/${key}`,
      headers: init.headers,
      body: init.body,
      accessKeyId: config.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: config.R2_SECRET_ACCESS_KEY ?? "",
      service: "s3",
      region: "auto",
    }).sign();
    const res = await fetch()(signed.url, {
      method,
      headers: signed.headers,
      body: init.body,
    });
    if (!res.ok) {
      throw upstreamFailed(`File storage answered ${res.status}`);
    }
  }

  const storage: Storage = {
    put: async (key, body, contentType) => {
      await send("PUT", key, {
        body,
        headers: {
          "content-type": contentType,
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
      return `${publicUrl}${key}`;
    },
    delete: async (key) => {
      await send("DELETE", key);
    },
    keyOf: (url) =>
      url.startsWith(publicUrl) ? url.slice(publicUrl.length) : undefined,
  };
  return storage;
}
