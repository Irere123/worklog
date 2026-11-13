import {
  ArrowLeftIcon,
  ArrowsClockwiseIcon,
  CopyIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import type { Schemas } from "#api/client";
import { api, unwrap } from "#api/client";
import { q } from "#api/queries";
import { SourceGlyph } from "#features/activity/activity-line";
import { ago, agoPhrase, exactTime } from "#lib/time";
import { Button } from "#ui/button";
import { Badge, Dot } from "#ui/chip";
import type { Status, Tone } from "#ui/chip";
import { ErrorNote, Skeleton } from "#ui/feedback";
import { Checkbox, Field, Input } from "#ui/field";
import { Dialog, Tooltip } from "#ui/overlay";
import { color, font, media, radius, space, text } from "#ui/tokens.stylex";

import { Card, Row, SettingsPage, settingsStyles } from "./frame";
import { WebhookConnectDialog } from "./webhook-connect";

type Connector = Schemas["Connector"];
type Connection = Schemas["Connection"];

const STATUS: Record<
  Connection["status"],
  { label: string; tone: Tone; status: Status }
> = {
  active: { label: "Connected", tone: "green", status: "done" },
  pending: {
    label: "Waiting for first event",
    tone: "amber",
    status: "waiting",
  },
  paused: { label: "Paused", tone: "neutral", status: "paused" },
  suspended: { label: "Needs attention", tone: "red", status: "needs_you" },
  revoked: { label: "Disconnected", tone: "red", status: "failed" },
};

// Settings that hold several values; the rest are single strings.
const LISTS = new Set([
  "repos",
  "bots",
  "ignoreKinds",
  "channels",
  "channelNames",
  "privateChannels",
]);

export function Connections() {
  const connectors = useQuery(q.connectors());
  const connections = useQuery(q.connections());
  const apps = useQuery(q.apps());
  const [connecting, setConnecting] = useState<Connector | null>(null);
  const install = useMutation({
    mutationFn: async (provider: string) =>
      await unwrap(
        api.POST("/v1/apps/{provider}/install", {
          params: { path: { provider } },
        })
      ),
    onSuccess: (link) => location.assign(link.url),
    onError: (error) => toast.error(error.message),
  });
  const appReady = (provider: string) =>
    apps.data?.some((a) => a.provider === provider && a.configured) ?? false;

  return (
    <SettingsPage
      title="Connections"
      description={
        connections.data?.length === 0
          ? "Where activity comes from. Nothing is connected yet: start with the tool your team lives in, or log work by hand with L."
          : "Where activity comes from. Worklog dedupes it, credits the right person and drops the noise."
      }
    >
      {connections.data?.length !== 0 && (
        <Card title="Connected">
          {connections.isPending && (
            <div {...stylex.props(settingsStyles.pad)}>
              <Skeleton lines={3} />
            </div>
          )}
          <ul {...stylex.props(settingsStyles.list)}>
            {connections.data?.map((c) => (
              <li key={c.id}>
                <Link
                  to="/settings/connections/$connectionId"
                  params={{ connectionId: c.id }}
                  {...stylex.props(settingsStyles.listRow, styles.linkRow)}
                >
                  <ProviderMark provider={c.provider} />
                  <div {...stylex.props(settingsStyles.main)}>
                    <p {...stylex.props(settingsStyles.strong)}>{c.name}</p>
                    <p {...stylex.props(settingsStyles.sub)}>
                      {connectors.data?.find((x) => x.id === c.provider)
                        ?.name ?? c.provider}
                      {c.lastEventAt
                        ? ` · last event ${agoPhrase(c.lastEventAt)}`
                        : " · no events yet"}
                    </p>
                  </div>
                  <Badge
                    tone={STATUS[c.status].tone}
                    status={STATUS[c.status].status}
                  >
                    {STATUS[c.status].label}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Add a connection">
        <ul {...stylex.props(styles.catalog)}>
          {connectors.data?.map((c) => (
            <li key={c.id} {...stylex.props(styles.connector)}>
              <div {...stylex.props(styles.connectorHead)}>
                <ProviderMark provider={c.id} />
                <p {...stylex.props(settingsStyles.strong)}>{c.name}</p>
              </div>
              <p {...stylex.props(styles.connectorDesc)}>{c.description}</p>
              <div {...stylex.props(styles.caps)}>
                {c.capabilities.app && <Badge>One-click app</Badge>}
                {c.capabilities.sync && <Badge>Brings history</Badge>}
                {c.capabilities.hooks && <Badge>Sets up webhooks</Badge>}
              </div>
              <div {...stylex.props(styles.connectorActions)}>
                {c.capabilities.app && appReady(c.id) && (
                  <Button
                    size="sm"
                    variant="primary"
                    busy={install.isPending && install.variables === c.id}
                    onClick={() => install.mutate(c.id)}
                  >
                    Install
                  </Button>
                )}
                <Button
                  size="sm"
                  icon={<PlusIcon size={13} />}
                  onClick={() => setConnecting(c)}
                >
                  {c.capabilities.app && appReady(c.id)
                    ? "Connect manually"
                    : "Connect"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      {connecting?.id === "webhook" && (
        <WebhookConnectDialog onClose={() => setConnecting(null)} />
      )}
      {connecting && connecting.id !== "webhook" && (
        <ConnectDialog
          connector={connecting}
          onClose={() => setConnecting(null)}
        />
      )}
    </SettingsPage>
  );
}

/** The tool's own mark in a calm tile, the same mark its activity carries in the feed. */
function ProviderMark({ provider }: { provider: string }) {
  return (
    <span {...stylex.props(styles.mark)}>
      <SourceGlyph source={provider} />
    </span>
  );
}

function ConnectDialog({
  connector,
  onClose,
}: {
  connector: Connector;
  onClose: () => void;
}) {
  const [name, setName] = useState(connector.name);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<Record<string, string>>({});
  const client = useQueryClient();
  const create = useMutation({
    mutationFn: async () =>
      await unwrap(
        api.POST("/v1/connections", {
          body: {
            provider: connector.id,
            name: name.trim(),
            secrets: Object.fromEntries(
              Object.entries(secrets).filter(([, v]) => v.trim())
            ),
            settings: Object.fromEntries(
              Object.entries(settings)
                .filter(([, v]) => v.trim())
                .map(([k, v]) => [
                  k,
                  LISTS.has(k) ? v.split(/[\s,]+/u).filter(Boolean) : v.trim(),
                ])
            ),
          },
        })
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["connections"] });
      toast.success(`${connector.name} connected`);
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });
  const missing = connector.secrets.some(
    (s) => s.required && !secrets[s.key]?.trim()
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) {
          onClose();
        }
      }}
      title={`Connect ${connector.name}`}
      description={connector.description}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim() || missing}
            busy={create.isPending}
            onClick={() => create.mutate()}
          >
            Connect
          </Button>
        </>
      }
    >
      <div {...stylex.props(styles.form)}>
        <Field label="Name" hint="How it shows up in Worklog.">
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        {connector.secrets.map((s) => (
          <Field
            key={s.key}
            label={`${humanize(s.key)}${s.required ? "" : " (optional)"}`}
            hint={s.description}
          >
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={secrets[s.key] ?? ""}
                onChange={(e) =>
                  setSecrets({ ...secrets, [s.key]: e.target.value })
                }
              />
            )}
          </Field>
        ))}
        {connector.settings
          .filter((s) => s.key !== "rules" && s.key !== "boardId")
          .map((s) => (
            <Field
              key={s.key}
              label={`${humanize(s.key)} (optional)`}
              hint={`${s.description}${LISTS.has(s.key) ? " Separate several with commas." : ""}`}
            >
              {(id) => (
                <Input
                  id={id}
                  spellCheck={false}
                  value={settings[s.key] ?? ""}
                  onChange={(e) =>
                    setSettings({ ...settings, [s.key]: e.target.value })
                  }
                />
              )}
            </Field>
          ))}
      </div>
    </Dialog>
  );
}

function humanize(key: string) {
  const spaced = key.replaceAll(/(?<upper>[A-Z])/gu, " $<upper>").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function ConnectionDetail({ id }: { id: string }) {
  const connections = useQuery(q.connections());
  const health = useQuery(q.connectionHealth(id));
  const deliveries = useQuery(q.deliveries(id));
  const connectors = useQuery(q.connectors());
  const client = useQueryClient();
  const connection = connections.data?.find((c) => c.id === id);
  const connector = connectors.data?.find((c) => c.id === connection?.provider);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["connections"] });
  };
  const update = useMutation({
    mutationFn: async (status: "active" | "paused") =>
      await unwrap(
        api.PATCH("/v1/connections/{id}", {
          params: { path: { id } },
          body: { status },
        })
      ),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });
  const sync = useMutation({
    mutationFn: async () =>
      await unwrap(
        api.POST("/v1/connections/{id}/sync", { params: { path: { id } } })
      ),
    onSuccess: (r) => {
      toast.success(`Catching up: ${r.queued} queued`);
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: async () =>
      await unwrap(
        api.DELETE("/v1/connections/{id}", { params: { path: { id } } })
      ),
    onSuccess: () => {
      refresh();
      toast("Disconnected");
      history.back();
    },
    onError: (error) => toast.error(error.message),
  });

  if (connections.isPending) {
    return <Skeleton lines={6} />;
  }
  if (!connection) {
    return <ErrorNote error={new Error("That connection doesn’t exist.")} />;
  }
  const h = health.data;

  return (
    <SettingsPage
      title={connection.name}
      description={
        <Link to="/settings/connections" {...stylex.props(styles.back)}>
          <ArrowLeftIcon size={13} /> All connections
        </Link>
      }
      actions={
        <>
          {connector?.capabilities.sync === true && (
            <Button
              size="sm"
              icon={<ArrowsClockwiseIcon size={13} />}
              busy={sync.isPending}
              onClick={() => sync.mutate()}
            >
              Sync now
            </Button>
          )}
          {connection.status === "paused" ? (
            <Button
              size="sm"
              icon={<PlayIcon size={13} />}
              onClick={() => update.mutate("active")}
            >
              Resume
            </Button>
          ) : (
            <Button
              size="sm"
              icon={<PauseIcon size={13} />}
              onClick={() => update.mutate("paused")}
            >
              Pause
            </Button>
          )}
          <Tooltip label="Disconnect">
            <Button
              size="sm"
              variant="ghost"
              aria-label="Disconnect"
              icon={<TrashIcon size={14} />}
              onClick={() => remove.mutate()}
            />
          </Tooltip>
        </>
      }
    >
      {h?.rejections.failingNow === true && (
        <div {...stylex.props(styles.alert)}>
          <WarningCircleIcon size={15} /> Deliveries are being rejected: check
          the webhook secret. Last: {h.rejections.last}
        </div>
      )}
      {connection.statusReason && (
        <div {...stylex.props(styles.alert)}>
          <WarningCircleIcon size={15} /> {connection.statusReason}
        </div>
      )}
      <HealthCard health={h} pending={health.isPending} />

      <WebhookUrls urls={connection.webhookUrls} />

      {connector?.capabilities.sources === true && (
        <Sources
          id={id}
          selected={stringList(
            connection.settings.repos ?? connection.settings.channels
          )}
        />
      )}

      <RecentDeliveries
        deliveries={deliveries.data}
        pending={deliveries.isPending}
      />
    </SettingsPage>
  );
}

type Health = Schemas["ConnectionHealth"];
type Delivery = Schemas["Delivery"];

const SYNC_TONES: Record<Health["sync"][number]["state"], Tone> = {
  idle: "neutral",
  running: "amber",
  failed: "red",
};

const SYNC_STATUS: Record<Health["sync"][number]["state"], Status> = {
  idle: "done",
  running: "working",
  failed: "failed",
};

const SYNC_LABELS: Record<Health["sync"][number]["state"], string> = {
  idle: "Up to date",
  running: "Syncing",
  failed: "Failed",
};

const DELIVERY_TONES: Record<Delivery["status"], Tone> = {
  pending: "amber",
  processed: "green",
  ignored: "neutral",
  failed: "red",
};

function HealthCard({
  health,
  pending,
}: {
  health: Health | undefined;
  pending: boolean;
}) {
  const total = health
    ? Object.values(health.deliveries).reduce((a, b) => a + b, 0)
    : 0;
  return (
    <Card title="Last 14 days">
      {pending ? (
        <div {...stylex.props(settingsStyles.pad)}>
          <Skeleton lines={2} />
        </div>
      ) : (
        health && (
          <div {...stylex.props(styles.stats)}>
            <Stat label="Deliveries" value={String(total)} />
            <Stat
              label="Kept as activity"
              value={String(health.activities.kept)}
            />
            <Stat
              label="Signal"
              value={
                health.signalRate === null
                  ? "—"
                  : `${Math.round(health.signalRate * 100)}%`
              }
            />
            <Stat
              label="Unlinked people"
              value={String(health.unlinkedIdentities)}
            />
          </div>
        )
      )}
      {health && health.topSkipReasons.length > 0 && (
        <Row
          label="Filtered as noise"
          description="What Worklog dropped, and why."
        >
          <div {...stylex.props(styles.reasons)}>
            {health.topSkipReasons.slice(0, 4).map((r) => (
              <Badge key={r.reason}>
                {r.reason} · {r.count}
              </Badge>
            ))}
          </div>
        </Row>
      )}
      {health?.sync.map((s) => (
        <Row
          key={s.stream}
          label={`Sync · ${s.stream}`}
          description={
            s.error ??
            (s.syncedAt
              ? `Caught up ${agoPhrase(s.syncedAt)}`
              : "Not synced yet")
          }
        >
          <Badge tone={SYNC_TONES[s.state]} status={SYNC_STATUS[s.state]}>
            {SYNC_LABELS[s.state]}
          </Badge>
        </Row>
      ))}
    </Card>
  );
}

function WebhookUrls({ urls }: { urls: Record<string, string> }) {
  if (Object.keys(urls).length === 0) {
    return null;
  }
  return (
    <Card
      title="Webhook URLs"
      description="Paste into the provider’s webhook settings, with the same secret."
    >
      {Object.entries(urls).map(([label, url]) => (
        <Row
          key={label}
          label={humanize(label)}
          description={<code {...stylex.props(styles.code)}>{url}</code>}
        >
          <Button
            size="sm"
            icon={<CopyIcon size={13} />}
            onClick={() => {
              void navigator.clipboard.writeText(url);
              toast.success("Copied");
            }}
          >
            Copy
          </Button>
        </Row>
      ))}
    </Card>
  );
}

function RecentDeliveries({
  deliveries,
  pending,
}: {
  deliveries: Delivery[] | undefined;
  pending: boolean;
}) {
  return (
    <Card title="Recent deliveries">
      {pending && (
        <div {...stylex.props(settingsStyles.pad)}>
          <Skeleton lines={4} />
        </div>
      )}
      {deliveries?.length === 0 && (
        <p {...stylex.props(settingsStyles.pad, settingsStyles.sub)}>
          Nothing received yet.
        </p>
      )}
      <ul {...stylex.props(settingsStyles.list)}>
        {deliveries?.slice(0, 20).map((d) => (
          <li key={d.id} {...stylex.props(settingsStyles.listRow)}>
            <Dot tone={DELIVERY_TONES[d.status]} />
            <div {...stylex.props(settingsStyles.main)}>
              <p {...stylex.props(settingsStyles.strong, styles.mono)}>
                {d.eventType}
              </p>
              <p {...stylex.props(settingsStyles.sub)}>
                {d.error ?? `${d.status} · via ${d.via}`}
              </p>
            </div>
            <span
              title={exactTime(d.receivedAt)}
              {...stylex.props(settingsStyles.sub)}
            >
              {ago(d.receivedAt)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

function Sources({ id, selected }: { id: string; selected: string[] }) {
  const sources = useQuery(q.sources(id));
  const [picked, setPicked] = useState<string[] | null>(null);
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: async (ids: string[]) =>
      await unwrap(
        api.PUT("/v1/connections/{id}/sources", {
          params: { path: { id } },
          body: { ids },
        })
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["connections"] });
      setPicked(null);
      toast.success("Watching the chosen sources");
    },
    onError: (error) => toast.error(error.message),
  });
  const current = picked ?? selected;
  return (
    <Card
      title="What it watches"
      description="Pick the repositories or channels whose activity counts."
      footer={
        picked !== null && (
          <Button
            size="sm"
            variant="primary"
            busy={save.isPending}
            onClick={() => save.mutate(current)}
          >
            Save
          </Button>
        )
      }
    >
      {sources.isPending && (
        <div {...stylex.props(settingsStyles.pad)}>
          <Skeleton lines={3} />
        </div>
      )}
      {sources.isError && (
        <div {...stylex.props(settingsStyles.pad)}>
          <ErrorNote error={sources.error} />
        </div>
      )}
      <ul {...stylex.props(styles.sources)}>
        {sources.data?.map((s) => (
          <li key={s.id}>
            <label {...stylex.props(styles.source)}>
              <Checkbox
                checked={current.includes(s.id)}
                onCheckedChange={(on) =>
                  setPicked(
                    on ? [...current, s.id] : current.filter((x) => x !== s.id)
                  )
                }
              />
              <span>{s.name}</span>
              {s.private === true && <Badge>private</Badge>}
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div {...stylex.props(styles.stat)}>
      <span {...stylex.props(styles.statValue)}>{value}</span>
      <span {...stylex.props(styles.statLabel)}>{label}</span>
    </div>
  );
}

const styles = stylex.create({
  linkRow: {
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.surface },
    },
  },
  catalog: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: space.md,
    padding: space.xl,
    paddingTop: space.sm,
  },
  connector: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.md,
    boxShadow: `inset 0 0 0 1px ${color.line}`,
  },
  connectorHead: { display: "flex", alignItems: "center", gap: space.md },
  connectorDesc: {
    flexGrow: 1,
    fontSize: text.meta,
    lineHeight: "16px",
    color: color.fgMuted,
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  caps: { display: "flex", flexWrap: "wrap", gap: space.xs },
  connectorActions: { display: "flex", gap: space.sm, marginTop: space.xs },
  mark: {
    display: "grid",
    placeItems: "center",
    width: 28,
    height: 28,
    flexShrink: 0,
    borderRadius: radius.sm,
    color: color.fg,
    backgroundColor: color.ui,
    boxShadow: `inset 0 0 0 1px ${color.line}`,
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
    paddingInline: space.xl,
    paddingBottom: space.xl,
    overflowY: "auto",
  },
  back: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
  },
  alert: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderRadius: radius.md,
    fontSize: text.label,
    color: color.redFg,
    backgroundColor: color.redSubtle,
  },
  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    paddingInline: space.xl,
    paddingBottom: space.lg,
    paddingTop: space.sm,
  },
  stat: { display: "flex", flexDirection: "column", gap: 2 },
  statValue: {
    fontSize: text.titleLg,
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.02em",
  },
  statLabel: { fontSize: text.meta, color: color.fgMuted },
  reasons: {
    display: "flex",
    flexWrap: "wrap",
    gap: space.xs,
    justifyContent: "flex-end",
    maxWidth: 360,
  },
  code: { fontFamily: font.mono, fontSize: 11.5, overflowWrap: "anywhere" },
  mono: { fontFamily: font.mono, fontSize: 12 },
  sources: {
    display: "flex",
    flexDirection: "column",
    paddingInline: space.xl,
    paddingBottom: space.lg,
    maxHeight: 320,
    overflowY: "auto",
  },
  source: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    height: 32,
    fontSize: text.label,
    cursor: "pointer",
  },
});
