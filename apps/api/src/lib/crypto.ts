import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { z } from "zod";

const SecretsSchema = z.record(z.string(), z.string());

export function generateToken() {
  return `wl_${randomBytes(32).toString("base64url")}`;
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** A short, stable digest: a delivery id for a body that carries none. */
export function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export function hmacHex(secret: string, payload: string) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const kidOf = (key: Buffer) =>
  createHash("sha256").update(key).digest("hex").slice(0, 8);

/**
 * AES-256-GCM. A sealed value names the key that sealed it (`v2.<kid>.…`), so the key can be
 * rotated: the new one seals, the previous ones still open, and `stale` says what to re-seal.
 * Values sealed before key ids (three parts) open with any configured key.
 */
export class SecretBox {
  private readonly key: Buffer;
  private readonly kid: string;
  private readonly keys: Map<string, Buffer>;

  constructor(rawKey: string | undefined, previous: string[] = []) {
    this.key = rawKey
      ? decodeKey(rawKey, "WORKLOG_SECRET_KEY")
      : createHash("sha256").update("worklog-insecure-dev-key").digest();
    this.kid = kidOf(this.key);
    this.keys = new Map([[this.kid, this.key]]);
    for (const raw of previous) {
      const key = decodeKey(raw, "WORKLOG_SECRET_KEYS_PREVIOUS");
      this.keys.set(kidOf(key), key);
    }
  }

  seal(value: Record<string, string>) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf-8"),
      cipher.final(),
    ]);
    return [
      "v2",
      this.kid,
      ...[iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")),
    ].join(".");
  }

  open(sealed: string) {
    const parts = sealed.split(".");
    if (parts[0] === "v2" && parts.length === 5) {
      const key = this.keys.get(parts[1] ?? "");
      if (!key) {
        throw new Error(
          `Sealed with key ${parts[1]}, which isn't configured (WORKLOG_SECRET_KEYS_PREVIOUS)`
        );
      }
      return decrypt(key, parts.slice(2));
    }
    let failure: unknown = new Error("Malformed sealed secret");
    for (const key of this.keys.values()) {
      try {
        return decrypt(key, parts);
      } catch (error) {
        failure = error;
      }
    }
    throw failure;
  }

  /** Sealed with an older key, or before key ids: re-seal it with the current one. */
  stale(sealed: string) {
    return !sealed.startsWith(`v2.${this.kid}.`);
  }
}

function decrypt(key: Buffer, parts: string[]) {
  const [iv, tag, data] = parts.map((p) => Buffer.from(p, "base64url"));
  if (!iv || !tag || !data || parts.length !== 3) {
    throw new Error("Malformed sealed secret");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const json = Buffer.concat([
    decipher.update(data),
    decipher.final(),
  ]).toString("utf-8");
  return SecretsSchema.parse(JSON.parse(json));
}

function decodeKey(rawKey: string, name: string) {
  const key = /^[0-9a-f]{64}$/iu.test(rawKey)
    ? Buffer.from(rawKey, "hex")
    : Buffer.from(rawKey, "base64");
  if (key.length !== 32) {
    throw new Error(`${name} must decode to 32 bytes`);
  }
  return key;
}
