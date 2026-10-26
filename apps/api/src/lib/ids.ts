import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford base32, lowercase

/**
 * Time-sortable, prefixed IDs (ULID layout: 48-bit ms timestamp + 80 random bits),
 * e.g. `crd_01jbx3k9...`. Sorting by id sorts by creation time.
 */
export function newId(prefix: IdPrefix): string {
  let time = Date.now();
  let ts = "";
  for (let i = 0; i < 10; i++) {
    ts = ALPHABET[time % 32] + ts;
    time = Math.floor(time / 32);
  }
  const bytes = randomBytes(16);
  let rand = "";
  for (let i = 0; i < 16; i++) rand += ALPHABET[bytes[i]! % 32];
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
