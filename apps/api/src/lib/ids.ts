import { randomBytes } from "node:crypto";

// Crockford base32, lowercase
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * Time-sortable, prefixed IDs (ULID layout: 48-bit ms timestamp + 80 random bits),
 * e.g. `crd_01jbx3k9...`. Sorting by id sorts by creation time.
 */
export function newId(prefix: IdPrefix): string {
  let time = Date.now();
  let ts = "";
  for (let i = 0; i < 10; i += 1) {
    ts = ALPHABET.charAt(time % 32) + ts;
    time = Math.floor(time / 32);
  }
  let rand = "";
  for (const byte of randomBytes(16)) {
    rand += ALPHABET.charAt(byte % 32);
  }
  return `${prefix}_${ts}${rand}`;
}

export type IdPrefix =
  | "ws"
  | "usr"
  | "ses"
  | "acc"
  | "ver"
  | "mem"
  | "idn"
  | "tok"
  | "con"
  | "dlv"
  | "brd"
  | "col"
  | "crd"
  | "cmt"
  | "tag"
  | "act"
  | "att"
  | "brf"
  | "tgt"
  | "aut"
  | "run"
  | "mmr"
  | "cnv"
  | "msg"
  | "inb"
  | "ntf"
  | "fbk";
