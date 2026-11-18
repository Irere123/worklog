import { createHash } from "node:crypto";

/**
 * Each connection has this many ordered queues. A delivery's partition (a repo, a channel) picks
 * its lane, so everything about one thread runs in order while different repos and channels run in
 * parallel. Bounded, so the number of queues doesn't grow with the number of channels.
 */
export const LANES = 16;

export function laneOf(partition: string) {
  if (!partition) {
    return 0;
  }
  return (
    createHash("sha256").update(partition).digest().readUInt32BE(0) % LANES
  );
}

export const laneQueue = (connectionId: string, lane: number) =>
  `ingest:${connectionId}:${lane}`;
