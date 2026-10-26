import type { AppContext } from "../context";

/**
 * The canonical event every connector produces (schema v1). Shaped after Activity Streams 2.0
 * (actor → kind → object, in a container) so any tool's events fit, and carrying everything the
 * shared pipeline needs to keep the stream high-signal: who did it, what it's about, how it groups
 * (thread), how bursts merge (coalesce), who it asks something of (signals), and board effects.
 */
export const EVENT_SCHEMA_VERSION = 1;

export type ExternalActor = {
  /** The source's most stable id for the account (GitHub numeric id, Slack U…, GitLab id). */
  id: string;
  /** Login/username, if the source has one (used for manual links and @mentions). */
  handle?: string | null;
  name?: string | null;
  bot?: boolean;
};

export type Signal =
  /** Someone's review is wanted (→ high-priority attention for them). */
  | { type: "review_requested"; who: ExternalActor }
  /** Someone was @mentioned. High priority by default; chat platforms pass "normal" (conversation, not a request). */
  | {
      type: "mentioned";
      who: ExternalActor;
      excerpt?: string;
      priority?: "normal" | "high";
    }
  /** Someone was assigned the object. */
  | { type: "assigned"; who: ExternalActor }
  /** A review landed on the object's author. */
  | {
      type: "review_result";
      who: ExternalActor;
      state: "approved" | "changes_requested" | "commented";
    }
  /** The thing someone was asked for is done — close their attention item for this thread. */
  | {
      type: "resolve";
      who?: ExternalActor;
      what: "review_requested" | "assigned";
    };

export type BoardEffect =
  /** An issue in the source tracker becomes (or updates) a card in "Maybe?" on the connection's board. */
  | {
      type: "upsert_card";
      externalKey: string;
      title: string;
      body?: string | null;
      url?: string | null;
    }
  | { type: "close_card"; externalKey: string }
  | { type: "reopen_card"; externalKey: string }
  | { type: "assign_card"; externalKey: string; who: ExternalActor };

export type WorklogEvent = {
  /**
   * Unique per source event, built from the source's own ids and timestamps (never the delivery id),
   * so redeliveries, replays, backfills and duplicate hooks all land on the same row.
   */
  id: string;
  /** "create" (default); "update"/"delete" apply an edit or deletion at the source to the event with this id. */
  op?: "create" | "update" | "delete";
  /** Canonical verb, e.g. pr.opened, pr.merged, review.submitted, issue.closed, message.posted. */
  kind: string;
  occurredAt: Date;
  actor: ExternalActor | null;
  /** Headline as it should read in a feed: "Merged PR acme/api#7: Retry payments". */
  title: string;
  body?: string | null;
  url?: string | null;
  /** What it's about (a PR, issue, message, deploy...). */
  object?: {
    type: string;
    key: string;
    title?: string | null;
    url?: string | null;
  } | null;
  /** Where it happened (repo, channel, project). */
  container?: { type: string; key: string; name?: string | null } | null;
  /** Related events share a thread, e.g. everything on one PR. Also scopes attention items. */
  thread?: string | null;
  /** Links to cards: external keys (github:acme/api#3) and/or Worklog card numbers (WL-12). */
  cardRefs?: { externalKeys?: string[]; numbers?: number[] };
  signals?: Signal[];
  board?: BoardEffect[];
  /**
   * Bursts merge: events with the same key inside the window become one activity whose title is
   * re-rendered from `template` (`{n}` = total units, `{s}` = plural suffix).
   */
  coalesce?: {
    key: string;
    windowMinutes: number;
    units: number;
    template: string;
  } | null;
  /** Connector's hint, 0..1. The pipeline adjusts it (bots, merges). */
  importance?: number;
  visibility?: "team" | "private";
  /** Signals and board effects only — not shown in the stream (e.g. "assigned" is a nudge, not news). */
  hidden?: boolean;
  /** Agent work: who it was done for and where it stands. */
  agent?: {
    onBehalfOf?: ExternalActor | null;
    state?: "working" | "needs_you" | "finished" | "failed";
  } | null;
  data?: Record<string, unknown>;
};

/** What normalize() returns: events, or a reason it's deliberately ignored (recorded on the raw event). */
export type Normalized = { events: WorklogEvent[]; ignored?: string };

export type ConnectionView = {
  id: string;
  workspaceId: string;
  provider: string;
  settings: Record<string, unknown>;
  secrets: Record<string, string>;
};

export type InboundRequest = {
  /** Sub-path after the connection id: "" for plain webhooks, "events" / "commands" / "interactions"... */
  channel: string;
  headers: Headers;
  rawBody: string;
  receivedAt: Date;
};

export type Received =
  /** An event to store and process asynchronously. */
  | { type: "event"; deliveryId: string; eventType: string; payload: unknown }
  /** Answer right away and store nothing (handshakes: Slack url_verification, Discord PING). */
  | { type: "respond"; body: unknown; status?: number }
  /** An interactive command (slash command, interaction): answered synchronously by the connector. */
  | { type: "interaction"; payload: unknown }
  | { type: "reject"; status: 400 | 401 | 404; error: string };

/**
 * A connector. Built-in ones (GitHub, Slack, Discord, Gitea, generic webhooks) implement exactly this,
 * and so can anyone adding a tool. Only `receive` touches HTTP details; `normalize` is pure — no
 * database, no network — so every mapping can be tested against recorded payloads.
 */
export type Connector = {
  id: string;
  name: string;
  description: string;
  /** Secret fields (encrypted at rest) and which are required. */
  secrets: { key: string; required: boolean; description: string }[];
  /** Documented settings (non-secret). */
  settings: { key: string; description: string }[];
  /** Identity namespace for actors from this connection (e.g. "github", or "gitea:git.example.com" for self-hosted). */
  identityNamespace: (conn: ConnectionView) => string;
  /** Authenticate and classify one HTTP delivery. */
  receive: (
    req: InboundRequest,
    conn: ConnectionView
  ) => Promise<Received> | Received;
  /** Translate one stored delivery into canonical events. Pure. */
  normalize: (
    input: { eventType: string; payload: unknown; receivedAt: Date },
    conn: ConnectionView
  ) => Normalized;
  /** Synchronous interactions (slash commands). Return the HTTP response body. */
  interact?: (
    ctx: AppContext,
    conn: ConnectionView,
    payload: unknown,
    channel: string
  ) => Promise<unknown>;
  /** Channels (URL suffixes) this connector listens on, for showing webhook URLs. */
  endpoints: Record<string, string>;
};
