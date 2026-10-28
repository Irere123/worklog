import type { Db } from "#db";
import { updateConnectionTallies } from "#db/queries/connections";
import type { ConnectionTally } from "#db/queries/connections";
import { updateConnectorAppTally } from "#db/queries/connector-apps";
import type { AppTally } from "#db/queries/connector-apps";
import { updateIdentitySightings } from "#db/queries/identities";

type Sighting = { n: number; first: Date; last: Date };

const later = (a: Date | null, b: Date) => (a && a > b ? a : b);

/**
 * Counters every delivery or event would otherwise write to one shared row: a bot's identity, the
 * connection, the app. Under load those rows serialize work that otherwise runs in parallel, so
 * each process adds up its counts and writes them in one statement every few seconds. A crash
 * loses the last few seconds of counts, never data; a failed write keeps them for the next.
 */
export class Tally {
  private readonly db: Db;
  private identities = new Map<string, Sighting>();
  private connections = new Map<string, ConnectionTally>();
  private apps = new Map<string, AppTally>();
  private writing: Promise<void> | null = null;

  constructor(db: Db) {
    this.db = db;
  }

  sighted(identityId: string, at: Date, n = 1) {
    const s = this.identities.get(identityId);
    if (s) {
      s.n += n;
      s.first = s.first < at ? s.first : at;
      s.last = later(s.last, at);
    } else {
      this.identities.set(identityId, { n, first: at, last: at });
    }
  }

  received(connectionId: string, at: Date) {
    const c = this.connection(connectionId);
    c.lastEventAt = later(c.lastEventAt, at);
  }

  rejected(connectionId: string, at: Date, reason: string) {
    const c = this.connection(connectionId);
    c.rejections += 1;
    if (!c.lastRejectedAt || at >= c.lastRejectedAt) {
      c.lastRejectedAt = at;
      c.lastRejection = reason;
    }
  }

  unrouted(provider: string, at: Date) {
    const a = this.app(provider);
    a.unrouted += 1;
    a.lastUnroutedAt = later(a.lastUnroutedAt, at);
  }

  /** A delivery on the app endpoint its secret didn't verify. */
  appRejected(provider: string, at: Date, reason: string) {
    const a = this.app(provider);
    a.rejections += 1;
    if (!a.lastRejectedAt || at >= a.lastRejectedAt) {
      a.lastRejectedAt = at;
      a.lastRejection = reason;
    }
  }

  /** Waits for a write in progress, then writes whatever was counted since. */
  async flush() {
    while (this.writing) {
      await this.writing;
    }
    const run = this.write();
    this.writing = run;
    try {
      await run;
    } finally {
      this.writing = null;
    }
  }

  /** Flushes every `ms` until the returned function is called. */
  start(ms = 2000) {
    const timer = setInterval(() => {
      void this.flushLogged();
    }, ms);
    timer.unref();
    return () => {
      clearInterval(timer);
    };
  }

  private async flushLogged() {
    try {
      await this.flush();
    } catch (error) {
      console.error("[tally] flush failed", error);
    }
  }

  private app(provider: string) {
    let a = this.apps.get(provider);
    if (!a) {
      a = {
        provider,
        unrouted: 0,
        lastUnroutedAt: null,
        rejections: 0,
        lastRejectedAt: null,
        lastRejection: null,
      };
      this.apps.set(provider, a);
    }
    return a;
  }

  private connection(id: string) {
    let c = this.connections.get(id);
    if (!c) {
      c = {
        id,
        lastEventAt: null,
        rejections: 0,
        lastRejectedAt: null,
        lastRejection: null,
      };
      this.connections.set(id, c);
    }
    return c;
  }

  // Each statement stands alone: one that fails puts its counts back for the next flush, and
  // the ones that succeeded aren't counted twice.
  private async write() {
    const { identities, connections, apps } = this;
    this.identities = new Map();
    this.connections = new Map();
    this.apps = new Map();
    const failures: unknown[] = [];
    try {
      await updateIdentitySightings(
        this.db,
        [...identities].map(([id, s]) => ({ id, ...s }))
      );
    } catch (error) {
      failures.push(error);
      for (const [id, s] of identities) {
        this.sighted(id, s.first, s.n);
        this.sighted(id, s.last, 0);
      }
    }
    try {
      await updateConnectionTallies(this.db, [...connections.values()]);
    } catch (error) {
      failures.push(error);
      for (const c of connections.values()) {
        this.restore(c);
      }
    }
    for (const a of apps.values()) {
      try {
        await updateConnectorAppTally(this.db, a);
      } catch (error) {
        failures.push(error);
        const into = this.app(a.provider);
        into.unrouted += a.unrouted;
        into.rejections += a.rejections;
        into.lastUnroutedAt = a.lastUnroutedAt
          ? later(into.lastUnroutedAt, a.lastUnroutedAt)
          : into.lastUnroutedAt;
        if (
          a.lastRejectedAt &&
          (!into.lastRejectedAt || a.lastRejectedAt > into.lastRejectedAt)
        ) {
          into.lastRejectedAt = a.lastRejectedAt;
          into.lastRejection = a.lastRejection;
        }
      }
    }
    if (failures.length > 0) {
      throw failures[0];
    }
  }

  private restore(c: ConnectionTally) {
    const into = this.connection(c.id);
    if (c.lastEventAt) {
      into.lastEventAt = later(into.lastEventAt, c.lastEventAt);
    }
    into.rejections += c.rejections;
    if (
      c.lastRejectedAt &&
      (!into.lastRejectedAt || c.lastRejectedAt > into.lastRejectedAt)
    ) {
      into.lastRejectedAt = c.lastRejectedAt;
      into.lastRejection = c.lastRejection;
    }
  }
}
