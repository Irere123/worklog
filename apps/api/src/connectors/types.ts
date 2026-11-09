import type { Config } from "#config";
import type { AppContext } from "#context";

export type ExternalActor = {
  /** The source's most stable id for the account, not the login. */
  id: string;
  handle?: string | null;
  name?: string | null;
  bot?: boolean;
  avatarUrl?: string | null;
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
export type Normalized = {
  events: WorklogEvent[];
  ignored?: string;
  /** Items of a page that were noise, so health counts what was read and not pages. */
  skipped?: number;
};

export type ConnectionView = {
  id: string;
  workspaceId: string;
  provider: string;
  /** The installation, for connections installed through the instance's app. */
  externalId: string | null;
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
  | {
      type: "event";
      deliveryId: string;
      eventType: string;
      payload: unknown;
      /** The repo or channel it concerns: deliveries in one partition are processed in order. */
      partition?: string;
    }
  /** Handshakes (Slack url_verification, Discord PING): answer right away, store nothing. */
  | { type: "respond"; body: unknown; status?: number }
  | { type: "interaction"; payload: unknown }
  | { type: "reject"; status: 400 | 401 | 404; error: string };

/** The secrets and settings a request is checked with: the connection's, or the app's on the app endpoint. */
export type Keys = Pick<ConnectionView, "secrets" | "settings">;

/** The instance's registration with the provider, with its credentials opened. */
export type AppView = {
  provider: string;
  appId: string | null;
  slug: string | null;
  name: string | null;
  credentials: Record<string, string>;
};

/** What a finished install connects: `externalId` routes the app's webhooks to the connection. */
export type Installed = {
  externalId: string;
  /**
   * The provider account, where reinstalling gives the same account a new installation id
   * (GitHub): it finds the revoked connection a reinstall brings back.
   */
  account?: string;
  name: string;
  secrets: Record<string, string>;
  settings: Record<string, unknown>;
};

/**
 * Install, uninstall, suspend and repository changes: they change the connection, not the
 * activity stream.
 */
export type ConnectionChange =
  | {
      type: "status";
      status: "active" | "suspended" | "revoked";
      reason: string;
    }
  | { type: "sync"; streams: string[] }
  | { type: "rename"; name: string };

export type AppSpec = {
  credentials: { key: string; required: boolean; description: string }[];
  /** Webhook paths on the app endpoint, like `endpoints` for a connection. */
  endpoints: Record<string, string>;
  /** Credentials from the environment, used to create the app row on first use. */
  fromEnv: (config: Config) => Omit<AppView, "provider"> | null;
  /** Which installation a request on the app endpoint belongs to (its connection's `externalId`). */
  route: (
    received: Extract<Received, { type: "event" | "interaction" }>
  ) => string | null;
  lifecycle?: (eventType: string, payload: unknown) => ConnectionChange | null;
  /** Where an admin goes to install, carrying the single-use `state`. */
  installUrl: (app: AppView, state: string, callbackUrl: string) => string;
  /** Events the provider only sends over a socket the server keeps open (Discord's Gateway). */
  stream?: StreamSpec;
  /**
   * Every installation the app has now, for providers that don't always say when one goes
   * (Discord never does; a GitHub webhook can be missed while the server is down).
   */
  installations?: (ctx: AppContext, app: AppView) => Promise<Set<string>>;
  /**
   * Finishes an install from the provider's redirect. Must verify the installation belongs to
   * whoever was redirected, never trusting the redirect's parameters alone.
   */
  completeInstall: (
    ctx: AppContext,
    app: AppView,
    query: Record<string, string>,
    callbackUrl: string
  ) => Promise<Installed>;
};

/** What a stream hands over: a delivery for an installation, or a change to it. */
export type Streamed =
  | {
      type: "event";
      externalId: string;
      deliveryId: string;
      eventType: string;
      payload: unknown;
      partition: string;
    }
  | { type: "change"; externalId: string; change: ConnectionChange };

/**
 * One app-wide socket. `run` holds it open, hands each item to `emit` and returns when it drops
 * (the runner opens it again) or `signal` aborts. `state` survives reconnects, for resuming.
 */
export type StreamSpec = {
  run: (
    ctx: AppContext,
    app: AppView,
    emit: (item: Streamed) => Promise<void>,
    opts: { signal: AbortSignal; state: Record<string, unknown> }
  ) => Promise<void>;
};

/** One page read from the provider's API, stored in the inbox like a delivery. */
export type SyncPage = {
  eventType: string;
  partition: string;
  payload: unknown;
};

export type SyncRead = {
  page: SyncPage | null;
  /** Saved after the page is stored, so a failure resumes from the last stored page. */
  cursor: Record<string, unknown>;
  /** Caught up: the next run starts from `cursor`, later. */
  done: boolean;
};

/**
 * Reading history and catching up on missed webhooks through the provider's API. `app` is the
 * instance's app, null when the provider has none.
 */
export type SyncSpec = {
  /** Usable for this connection (an app installation, or a token in its secrets). */
  available: (conn: ConnectionView, app: AppView | null) => boolean;
  streams: (
    ctx: AppContext,
    conn: ConnectionView,
    app: AppView | null
  ) => Promise<string[]>;
  /** Whether the connection's settings want a stream named some other way (a repo just added). */
  wants?: (conn: ConnectionView, stream: string) => boolean;
  read: (
    ctx: AppContext,
    conn: ConnectionView,
    app: AppView | null,
    stream: string,
    cursor: Record<string, unknown>,
    window: { since: Date }
  ) => Promise<SyncRead>;
};

/**
 * The immediate answer, and work to finish after it as a job (`followUp` gets `later.payload`).
 * `once` names the request, so the provider retrying it queues nothing.
 */
export type Interacted = {
  body: unknown;
  later?: { payload: Record<string, unknown>; once?: string };
};

/** A hook the connector keeps on the provider's side: present, active, and pointed at Worklog. */
export type HookResult = {
  target: string;
  state: "ok" | "created" | "repaired" | "failed";
  error?: string;
};

/**
 * Webhooks Worklog creates and maintains itself, for providers without apps (Gitea, Forgejo):
 * nobody pastes a URL or a secret into the provider.
 */
export type HooksSpec = {
  available: (conn: ConnectionView) => boolean;
  ensure: (
    ctx: AppContext,
    conn: ConnectionView,
    hook: { url: string; secret: string }
  ) => Promise<HookResult[]>;
};

/** Something a connection can watch: a repo, a channel. */
export type Source = { id: string; name: string; private?: boolean };

/** What the provider's directory knows about an account. */
export type AccountDetails = {
  email?: string | null;
  name?: string | null;
  handle?: string | null;
  bot?: boolean;
  avatarUrl?: string | null;
};

// `normalize` is pure (no database, no network) so mappings can be tested against recorded payloads.
export type Connector = {
  id: string;
  name: string;
  description: string;
  /** `generated`: Worklog makes it when it manages the hooks itself (given a token). */
  secrets: {
    key: string;
    required: boolean;
    description: string;
    generated?: boolean;
  }[];
  settings: { key: string; description: string }[];
  /** E.g. "github", or "gitea:git.example.com" / "gitlab:gitlab.com" for a forge with many hosts. */
  identityNamespace: (conn: ConnectionView) => string;
  /**
   * Whoever sets the connection up chooses its identity namespace and its event ids (the webhook
   * mapping, the push API), so ids are only unique within the connection.
   */
  perConnection?: boolean;
  receive: (req: InboundRequest, keys: Keys) => Promise<Received> | Received;
  normalize: (
    input: { eventType: string; payload: unknown; receivedAt: Date },
    conn: ConnectionView
  ) => Normalized;
  interact?: (
    ctx: AppContext,
    conn: ConnectionView,
    payload: unknown,
    channel: string
  ) => Promise<Interacted>;
  /** An answer to an interaction the connection can't take (it's revoked), in the provider's terms. */
  unavailable?: (message: string) => unknown;
  /** Answers an interaction acknowledged earlier, as a job, so a restart doesn't lose it. */
  followUp?: (
    ctx: AppContext,
    conn: ConnectionView,
    payload: Record<string, unknown>
  ) => Promise<void>;
  endpoints: Record<string, string>;
  /** Installs through the instance's own app instead of pasted secrets. */
  app?: AppSpec;
  hooks?: HooksSpec;
  sync?: SyncSpec;
  sources?: {
    list: (
      ctx: AppContext,
      conn: ConnectionView,
      app: AppView | null
    ) => Promise<Source[]>;
    /** The settings that record a choice of sources. */
    settings: (chosen: Source[]) => Record<string, unknown>;
  };
  /** Looks up an account seen in events, so its email can link it to a member. */
  enrich?: (
    ctx: AppContext,
    conn: ConnectionView,
    app: AppView | null,
    accountId: string
  ) => Promise<AccountDetails | null>;
};
