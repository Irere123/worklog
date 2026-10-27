import type { Db } from "#db";
import {
  deleteEventsBefore,
  insertEvent,
  listEventsAfter,
} from "#db/queries/events";
import type { StoredEvent } from "#db/queries/events";
import type { EventType } from "#db/schema";

type Listener = (event: StoredEvent) => void;

type Publish = {
  workspaceId: string;
  audienceId?: string | null;
  type: EventType;
  data: Record<string, unknown>;
};

// Persisted with a monotonic `seq` before fan-out, so clients resuming with `?after=<seq>` (or Last-Event-ID) lose nothing.
// Single-process fan-out; with several API replicas, swap `notify` for Postgres LISTEN/NOTIFY.
export class EventBus {
  private readonly listeners: Set<Listener>;
  private readonly db: Db;
  private readonly held: Publish[] | null;

  constructor(
    db: Db,
    listeners = new Set<Listener>(),
    held: Publish[] | null = null
  ) {
    this.db = db;
    this.listeners = listeners;
    this.held = held;
  }

  async publish(input: Publish): Promise<void> {
    if (this.held) {
      this.held.push(input);
      return;
    }
    const event = await insertEvent(this.db, {
      workspaceId: input.workspaceId,
      audienceId: input.audienceId ?? null,
      type: input.type,
      data: input.data,
    });
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[bus] listener failed", error);
      }
    }
  }

  /**
   * A bus that keeps publishes until `release`, for `transact`. Inserted inside a transaction, an
   * event would get its `seq` before commit and could become visible after a higher `seq` that a
   * client has already resumed past.
   */
  hold(): EventBus {
    return new EventBus(this.db, this.listeners, []);
  }

  get holding(): boolean {
    return this.held !== null;
  }

  async release() {
    const live = new EventBus(this.db, this.listeners);
    for (const input of this.held?.splice(0) ?? []) {
      await live.publish(input);
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
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
