import { and, asc, eq, gt, isNull, lt, or } from "drizzle-orm";

import type { Db } from "../db";
import { events } from "../db/schema";
import type { EventType } from "../db/schema";
import { returned } from "../lib/assert";

export type StoredEvent = typeof events.$inferSelect;

type Listener = (event: StoredEvent) => void;

/**
 * Every change clients may care about is written to the `events` table with a monotonically
 * increasing `seq`, then fanned out to live subscribers (SSE). Clients that drop their connection
 * resume with `?after=<seq>` (or Last-Event-ID) and lose nothing — the gap OpenCode v1 had and v2 fixed.
 *
 * Single-process fan-out for now; with several API replicas, swap `notify` for Postgres LISTEN/NOTIFY.
 */
export class EventBus {
  private readonly listeners = new Set<Listener>();
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async publish(input: {
    workspaceId: string;
    audienceId?: string | null;
    type: EventType;
    data: Record<string, unknown>;
  }) {
    const rows = await this.db
      .insert(events)
      .values({
        workspaceId: input.workspaceId,
        audienceId: input.audienceId ?? null,
        type: input.type,
        data: input.data,
      })
      .returning();
    const event = returned(rows, "event");
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[bus] listener failed", error);
      }
    }
    return event;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Events after `afterSeq` that `memberId` may see. */
  async replay(
    workspaceId: string,
    memberId: string,
    afterSeq: number,
    limit = 500
  ): Promise<StoredEvent[]> {
    return await this.db
      .select()
      .from(events)
      .where(
        and(
          eq(events.workspaceId, workspaceId),
          gt(events.seq, afterSeq),
          or(isNull(events.audienceId), eq(events.audienceId, memberId))
        )
      )
      .orderBy(asc(events.seq))
      .limit(limit);
  }

  async prune(olderThan: Date) {
    await this.db.delete(events).where(lt(events.createdAt, olderThan));
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
