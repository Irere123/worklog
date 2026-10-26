import type { AppContext } from "#context";

export const EVENT_SCHEMA_VERSION = 1;

export type ExternalActor = {
  /** The source's most stable id for the account, not the login. */
  id: string;
  handle?: string | null;
  name?: string | null;
  bot?: boolean;
};

export type Signal =
  | { type: "review_requested"; who: ExternalActor }
  /** High priority by default; chat platforms pass "normal" (conversation, not a request). */
  | {
      type: "mentioned";
      who: ExternalActor;
      excerpt?: string;
      priority?: "normal" | "high";
    }
  | { type: "assigned"; who: ExternalActor }
  | {
      type: "review_result";
      who: ExternalActor;
      state: "approved" | "changes_requested" | "commented";
    }
  /** Closes their attention item for this thread. */
  | {
      type: "resolve";
      who?: ExternalActor;
      what: "review_requested" | "assigned";
    };

export type BoardEffect =
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
  /** Default "create"; "update"/"delete" apply a source-side edit or deletion to the event with this id. */
  op?: "create" | "update" | "delete";
  kind: string;
  occurredAt: Date;
  actor: ExternalActor | null;
  title: string;
  body?: string | null;
  url?: string | null;
  object?: {
    type: string;
    key: string;
    title?: string | null;
    url?: string | null;
  } | null;
  container?: { type: string; key: string; name?: string | null } | null;
  /** Also scopes attention items. */
  thread?: string | null;
  /** External keys (github:acme/api#3) and/or Worklog card numbers (WL-12). */
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
  /** Connector's hint, 0..1; the pipeline adjusts it. */
  importance?: number;
  visibility?: "team" | "private";
  /** Signals and board effects only — not shown in the stream (e.g. "assigned" is a nudge, not news). */
  hidden?: boolean;
  agent?: {
    onBehalfOf?: ExternalActor | null;
    state?: "working" | "needs_you" | "finished" | "failed";
  } | null;
  data?: Record<string, unknown>;
};

/** `ignored` is recorded on the raw event. */
export type Normalized = { events: WorklogEvent[]; ignored?: string };

export type ConnectionView = {
  id: string;
  workspaceId: string;
  provider: string;
  settings: Record<string, unknown>;
  secrets: Record<string, string>;
};

export type InboundRequest = {
  channel: string;
  headers: Headers;
  rawBody: string;
  receivedAt: Date;
};

export type Received =
  | { type: "event"; deliveryId: string; eventType: string; payload: unknown }
  /** Handshakes (Slack url_verification, Discord PING): answer right away, store nothing. */
  | { type: "respond"; body: unknown; status?: number }
  | { type: "interaction"; payload: unknown }
  | { type: "reject"; status: 400 | 401 | 404; error: string };

// `normalize` is pure (no database, no network) so mappings can be tested against recorded payloads.
export type Connector = {
  id: string;
  name: string;
  description: string;
  secrets: { key: string; required: boolean; description: string }[];
  settings: { key: string; description: string }[];
  /** E.g. "github", or "gitea:git.example.com" for self-hosted. */
  identityNamespace: (conn: ConnectionView) => string;
  receive: (
    req: InboundRequest,
    conn: ConnectionView
  ) => Promise<Received> | Received;
  normalize: (
    input: { eventType: string; payload: unknown; receivedAt: Date },
    conn: ConnectionView
  ) => Normalized;
  interact?: (
    ctx: AppContext,
    conn: ConnectionView,
    payload: unknown,
    channel: string
  ) => Promise<unknown>;
  endpoints: Record<string, string>;
};
