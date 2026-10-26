import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** API tokens look like `wl_<43 chars>`; only their SHA-256 is stored. */
export function generateToken(): string {
  return `wl_${randomBytes(32).toString("base64url")}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hmacHex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** AES-256-GCM box for connector secrets stored in the database. */
export class SecretBox {
  private readonly key: Buffer;

  constructor(rawKey: string | undefined) {
    if (rawKey) {
      const key = /^[0-9a-f]{64}$/i.test(rawKey) ? Buffer.from(rawKey, "hex") : Buffer.from(rawKey, "base64");
      if (key.length !== 32) throw new Error("WORKLOG_SECRET_KEY must decode to 32 bytes");
      this.key = key;
    } else {
      // Development fallback only; loadConfig() refuses to start production without a key.
      this.key = createHash("sha256").update("worklog-insecure-dev-key").digest();
    }
  }

  seal(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
  }

  open<T = Record<string, string>>(sealed: string): T {
    const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
    if (!iv || !tag || !data) throw new Error("Malformed sealed secret");
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8")) as T;
  }
}
