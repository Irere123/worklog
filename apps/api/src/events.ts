import type { Db } from "#db";
import {
  deleteEventsBefore,
  findLatestEventSeq,
  insertEvent,
  insertEvents,
  listAllEventsAfter,
  listEventsAfter,
} from "#db/queries/events";
import type { StoredEvent } from "#db/queries/events";
import type { EventType } from "#db/schema";
import { log } from "#telemetry/log";

type Listener = (event: StoredEvent) => void;

type Publish = {
  workspaceId: string;
  audienceId?: string | null;
  type: EventType;
  data: Record<string, unknown>;
};

// How often other processes' events are read: the most a realtime update waits for, roughly.
const POLL_MS = 250;
// Events from concurrent inserts can commit out of seq order, a moment apart: a seq skipped over
// is looked for again for this long, then taken for a rolled-back insert's gap.
const MISSING_MS = 60_000;
const BATCH = 1000;

/** What every bus in a process shares: who listens, and what has gone out to them. */
type Hub = {
  listeners: Set<Listener>;
  /** Seqs this process sent itself, recorded only while relaying, to skip them when read back. */
  sent: Set<number>;
  /** Seqs read past before they were visible, and since when. */
  missing: Map<number, number>;
  /** The latest seq when relaying started: nothing at or before it is news. */
  floor: number;
  cursor: number;
  relaying: boolean;
  reading: boolean;
  again: boolean;
  /** The last read failed; said once until one succeeds. */
  failing: boolean;
  /** Local inserts in flight: a read waits for these before it sends anything. */
  inflight: Set<Promise<void>>;
};

/**
 * Persisted with a monotonic `seq` before fan-out, so clients resuming with `?after=<seq>` (or
 * Last-Event-ID) lose nothing. Each process fans out what it publishes itself at once; `listen`
 * also brings in what other processes publish (a worker ingesting, another API replica).
 */
export class EventBus {
  private readonly hub: Hub;
  private readonly db: Db;
  private readonly held: Publish[] | null;

  constructor(db: Db, hub?: Hub, held: Publish[] | null = null) {
    this.db = db;
    this.hub = hub ?? {
      listeners: new Set(),
      sent: new Set(),
      missing: new Map(),
      floor: 0,
      cursor: 0,
      relaying: false,
      reading: false,
      again: false,
      failing: false,
      inflight: new Set(),
    };
    this.held = held;
  }

  async publish(input: Publish): Promise<void> {
    if (this.held) {
      this.held.push(input);
      return;
    }
    await this.local(async () => {
      const event = await insertEvent(this.db, {
        workspaceId: input.workspaceId,
        audienceId: input.audienceId ?? null,
        type: input.type,
        data: input.data,
      });
      this.dispatch(event);
    });
  }

  // A relay read can see the rows before the insert returns their seqs: it waits for the local
  // inserts in flight when it ran, which then have marked their rows sent.
  private async local(write: () => Promise<void>) {
    const run = write();
    this.hub.inflight.add(run);
    try {
      await run;
    } finally {
      this.hub.inflight.delete(run);
    }
  }

  /**
   * A bus that keeps publishes until `release`, for `transact`. Inserted inside a transaction, an
   * event would get its `seq` before commit and could become visible after a higher `seq` that a
   * client has already resumed past.
   */
  hold(): EventBus {
    return new EventBus(this.db, this.hub, []);
  }

  get holding(): boolean {
    return this.held !== null;
  }

  // One insert for everything the transaction published.
  async release() {
    const held = this.held?.splice(0) ?? [];
    if (held.length === 0) {
      return;
    }
    await this.local(async () => {
      const stored = await insertEvents(
        this.db,
        held.map((input) => ({
          workspaceId: input.workspaceId,
          audienceId: input.audienceId ?? null,
          type: input.type,
          data: input.data,
        }))
      );
      for (const event of stored) {
        this.dispatch(event);
      }
    });
  }

  private dispatch(event: StoredEvent) {
    if (this.hub.relaying) {
      this.hub.sent.add(event.seq);
    }
    for (const listener of this.hub.listeners) {
      try {
        listener(event);
      } catch (error) {
        log.error("bus: listener failed", { error });
      }
    }
  }

  subscribe(listener: Listener): () => void {
    this.hub.listeners.add(listener);
    return () => {
      this.hub.listeners.delete(listener);
    };
  }

  /**
   * Starts relaying other processes' events to this process's listeners: what's new is read a few
   * times a second. Read on a timer, not woken by NOTIFY: Postgres commits notifying transactions
   * one at a time, so a NOTIFY on every insert would make every write that publishes wait its turn.
   * Returns the function that stops it.
   */
  async listen(opts: { everyMs?: number } = {}): Promise<() => Promise<void>> {
    this.hub.floor = await findLatestEventSeq(this.db);
    this.hub.cursor = this.hub.floor;
    this.hub.relaying = true;
    // The read under way, which stopping waits for: a tick that finds one leaves it be.
    let reading = Promise.resolve();
    const timer = setInterval(() => {
      if (this.hub.reading) {
        this.hub.again = true;
      } else {
        reading = this.catchUp();
      }
    }, opts.everyMs ?? POLL_MS);
    return async () => {
      clearInterval(timer);
      this.hub.again = false;
      await reading;
      this.hub.relaying = false;
      this.hub.sent.clear();
      this.hub.missing.clear();
    };
  }

  // One read at a time; a tick that finds one under way asks for one more after it.
  private async catchUp() {
    if (this.hub.reading) {
      this.hub.again = true;
      return;
    }
    this.hub.reading = true;
    try {
      do {
        this.hub.again = false;
        await this.readNew();
      } while (this.hub.again);
      this.hub.failing = false;
    } catch (error) {
      // Once per outage, not four times a second.
      if (!this.hub.failing) {
        log.error("bus: relay failed", { error });
      }
      this.hub.failing = true;
    } finally {
      this.hub.reading = false;
    }
  }

  private async readNew() {
    const { hub } = this;
    for (;;) {
      const rows = await listAllEventsAfter(this.db, {
        afterSeq: hub.cursor,
        alsoSeqs: [...hub.missing.keys()],
        limit: BATCH,
      });
      // Only those in flight now can be in what was read; later ones don't hold it up.
      await Promise.allSettled(hub.inflight);
      for (const event of rows) {
        hub.missing.delete(event.seq);
        for (let gap = hub.cursor + 1; gap < event.seq; gap += 1) {
          if (!hub.sent.has(gap)) {
            hub.missing.set(gap, Date.now());
          }
        }
        if (event.seq > hub.floor && !hub.sent.has(event.seq)) {
          this.dispatch(event);
        }
        hub.cursor = Math.max(hub.cursor, event.seq);
      }
      // A seq still missing may yet be read back: what this process sent of it must stay known.
      for (const seq of hub.sent) {
        if (seq <= hub.cursor && !hub.missing.has(seq)) {
          hub.sent.delete(seq);
        }
      }
      for (const [seq, since] of hub.missing) {
        if (Date.now() - since > MISSING_MS) {
          hub.missing.delete(seq);
        }
      }
      if (rows.length < BATCH) {
        return;
      }
    }
  }

  async replay(
    workspaceId: string,
    memberId: string,
    afterSeq: number,
    limit = 500
  ): Promise<StoredEvent[]> {
    return await listEventsAfter(this.db, {
      workspaceId,
      memberId,
      afterSeq,
      limit,
    });
  }

  async prune(olderThan: Date) {
    await deleteEventsBefore(this.db, { before: olderThan });
  }
}

export function canSee(
  event: StoredEvent,
  workspaceId: string,
  memberId: string
): boolean {
  return (
    event.workspaceId === workspaceId &&
    (event.audienceId === null || event.audienceId === memberId)
  );
}
