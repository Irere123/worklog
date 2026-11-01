import {
  CalendarDotsIcon,
  ChatCircleIcon,
  EnvelopeSimpleIcon,
  HashIcon,
  PaperPlaneRightIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
  WebhooksLogoIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";

import type { Schemas } from "#api/client";
import { api, unwrap } from "#api/client";
import { q } from "#api/queries";
import { ago, agoPhrase, fromNow } from "#lib/time";
import { Button } from "#ui/button";
import { Badge } from "#ui/chip";
import type { Tone } from "#ui/chip";
import { EmptyState, Skeleton } from "#ui/feedback";
import { Field, Input, Select, Switch, Textarea } from "#ui/field";
import { Dialog, Menu, MenuItem, Tooltip } from "#ui/overlay";
import { color, media, radius, space, text } from "#ui/tokens.stylex";

import { Card, SettingsPage, settingsStyles } from "./frame";

type Automation = Schemas["Automation"];
type Schedule = Automation["schedule"];
type Kind = Automation["kind"];

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function describeSchedule(s: Schedule) {
  if (s.type === "daily") {
    return `${daysPhrase(s.weekdays)} at ${s.at}`;
  }
  if (s.type === "weekly") {
    return `${DAYS[s.weekday]}s at ${s.at}`;
  }
  return `Every ${s.minutes >= 60 ? `${s.minutes / 60} h` : `${s.minutes} min`}${s.activeHoursOnly === true ? " during working hours" : ""}`;
}

function daysPhrase(weekdays: number[] | undefined) {
  const days = (weekdays ?? [0, 1, 2, 3, 4, 5, 6])
    .toSorted((a, b) => a - b)
    .join(",");
  const named: Record<string, string> = {
    "0,1,2,3,4,5,6": "Every day",
    "1,2,3,4,5": "Weekdays",
    "0,6": "Weekends",
  };
  return (
    named[days] ?? (weekdays ?? []).map((d) => DAYS[d]?.slice(0, 3)).join(", ")
  );
}

const KINDS: Record<Kind, string> = {
  "brief.daily": "Daily brief",
  "brief.weekly": "Weekly brief",
  digest: "Digest of held items",
  check: "Check-in",
  consolidate: "Memory tidy-up",
  custom: "Custom routine",
};

const STATUS: Record<string, { label: string; tone: Tone }> = {
  delivered: { label: "Delivered", tone: "green" },
  quiet: { label: "Nothing to say", tone: "neutral" },
  skipped: { label: "Skipped", tone: "neutral" },
  failed: { label: "Failed", tone: "red" },
};

function statusOf(status: string) {
  return STATUS[status] ?? { label: status, tone: "neutral" as Tone };
}

export function Automations() {
  const automations = useQuery(q.automations());
  const [editing, setEditing] = useState<Automation | "new" | null>(null);
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["automations"] });
  };
  const toggle = useMutation({
    mutationFn: async (a: Automation) =>
      await unwrap(
        api.PATCH("/v1/automations/{id}", {
          params: { path: { id: a.id } },
          body: { enabled: !a.enabled },
        })
      ),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });
  const run = useMutation({
    mutationFn: async (a: Automation) =>
      await unwrap(
        api.POST("/v1/automations/{id}/run", { params: { path: { id: a.id } } })
      ),
    onSuccess: (result) => {
      refresh();
      toast(
        result.status === "delivered"
          ? "Ran and delivered"
          : `Ran: ${statusOf(result.status).label}`,
        { description: result.summary ?? undefined }
      );
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <SettingsPage
      title="Automations"
      description="Routines your assistant runs on a schedule: briefs, digests, check-ins and your own. Quiet runs send nothing."
      actions={
        <Button
          size="sm"
          variant="primary"
          icon={<PlusIcon size={14} />}
          onClick={() => setEditing("new")}
        >
          New routine
        </Button>
      }
    >
      <Card>
        {automations.isPending && (
          <div {...stylex.props(settingsStyles.pad)}>
            <Skeleton lines={4} />
          </div>
        )}
        {automations.data?.length === 0 && (
          <EmptyState
            icon={<CalendarDotsIcon size={20} />}
            title="No routines yet"
          />
        )}
        <ul {...stylex.props(settingsStyles.list)}>
          {automations.data?.map((a) => (
            <li key={a.id} {...stylex.props(settingsStyles.listRow)}>
              <Switch
                checked={a.enabled}
                onCheckedChange={() => toggle.mutate(a)}
                label={`${a.name} enabled`}
              />
              <button
                type="button"
                onClick={() => setEditing(a)}
                {...stylex.props(settingsStyles.main, styles.rowButton)}
              >
                <p {...stylex.props(settingsStyles.strong)}>{a.name}</p>
                <p {...stylex.props(settingsStyles.sub)}>
                  {KINDS[a.kind]} · {describeSchedule(a.schedule)}
                  {a.enabled && a.nextRunAt
                    ? ` · runs ${fromNow(a.nextRunAt)}`
                    : ""}
                </p>
              </button>
              {a.lastStatus && (
                <Tooltip
                  label={
                    a.lastRunAt
                      ? `Last ran ${agoPhrase(a.lastRunAt)}`
                      : "Last run"
                  }
                >
                  <span>
                    <Badge tone={statusOf(a.lastStatus).tone}>
                      {statusOf(a.lastStatus).label}
                    </Badge>
                  </span>
                </Tooltip>
              )}
              {a.failureCount > 0 && (
                <Badge tone="red">
                  {a.failureCount === 1
                    ? "1 failure"
                    : `${a.failureCount} failures`}
                </Badge>
              )}
              <Tooltip label="Run now">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Run ${a.name} now`}
                  icon={<PlayIcon size={14} />}
                  busy={run.isPending && run.variables?.id === a.id}
                  onClick={() => run.mutate(a)}
                />
              </Tooltip>
            </li>
          ))}
        </ul>
      </Card>
      {editing !== null && (
        <AutomationDialog
          automation={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </SettingsPage>
  );
}

function AutomationDialog({
  automation,
  onClose,
}: {
  automation: Automation | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(automation?.name ?? "");
  const [kind, setKind] = useState<Kind>(automation?.kind ?? "custom");
  const [schedule, setSchedule] = useState<Schedule>(
    automation?.schedule ?? {
      type: "daily",
      at: "08:00",
      weekdays: [1, 2, 3, 4, 5],
    }
  );
  const [instructions, setInstructions] = useState(
    automation?.instructions ?? ""
  );
  const [targetIds, setTargetIds] = useState<string[]>(
    automation?.targetIds ?? []
  );
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: async () => {
      const fields = {
        name: name.trim(),
        schedule,
        instructions: instructions.trim() || undefined,
        targetIds,
      };
      if (automation) {
        return await unwrap(
          api.PATCH("/v1/automations/{id}", {
            params: { path: { id: automation.id } },
            body: fields,
          })
        );
      }
      return await unwrap(
        api.POST("/v1/automations", {
          body: { kind, ...fields, enabled: true },
        })
      );
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["automations"] });
      toast.success(automation ? "Routine saved" : "Routine created");
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: async () =>
      await unwrap(
        api.DELETE("/v1/automations/{id}", {
          params: { path: { id: automation?.id ?? "" } },
        })
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["automations"] });
      toast("Routine deleted");
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) {
          onClose();
        }
      }}
      title={automation ? automation.name : "New routine"}
      size="lg"
      footer={
        <>
          {automation && (
            <Button
              variant="ghost"
              icon={<TrashIcon size={14} />}
              onClick={() => remove.mutate()}
              sx={styles.delete}
            >
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim()}
            busy={save.isPending}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      <div {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.two)}>
          <Field label="Name">
            {(id) => (
              <Input
                id={id}
                autoFocus
                value={name}
                placeholder="Friday wins"
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          {!automation && (
            <Field label="Kind">
              {(id) => (
                <Select
                  id={id}
                  value={kind}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (isKind(next)) {
                      setKind(next);
                    }
                  }}
                >
                  {Object.entries(KINDS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>
        <ScheduleEditor value={schedule} onChange={setSchedule} />
        {(kind === "custom" || kind === "check" || instructions) && (
          <Field
            label="What should it do?"
            hint="Plain words. It can read the board and activity, and sends one message when there's something worth saying."
          >
            {(id) => (
              <Textarea
                id={id}
                value={instructions}
                placeholder="Every Friday, list what the team shipped this week and who deserves a thank-you."
                onChange={(e) => setInstructions(e.target.value)}
              />
            )}
          </Field>
        )}
        <DeliverTo value={targetIds} onChange={setTargetIds} />
        {automation && <RecentRuns id={automation.id} />}
      </div>
    </Dialog>
  );
}

function DeliverTo({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const targets = useQuery(q.targets());
  return (
    <fieldset {...stylex.props(styles.targets)}>
      <legend {...stylex.props(styles.legend)}>Deliver to</legend>
      {targets.data?.length === 0 && (
        <p {...stylex.props(settingsStyles.sub)}>
          Add a destination in Settings → Delivery. Without one it lands in
          Worklog only.
        </p>
      )}
      {targets.data?.map((t) => (
        <label key={t.id} {...stylex.props(styles.target)}>
          <input
            type="checkbox"
            checked={value.includes(t.id)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...value, t.id]
                  : value.filter((id) => id !== t.id)
              )
            }
          />
          {TARGET_ICONS[t.kind]}
          <span>{t.label}</span>
          <span {...stylex.props(settingsStyles.sub)}>{t.address}</span>
        </label>
      ))}
    </fieldset>
  );
}

function RecentRuns({ id }: { id: string }) {
  const runs = useQuery(q.automationRuns(id));
  if ((runs.data?.length ?? 0) === 0) {
    return null;
  }
  return (
    <div>
      <p {...stylex.props(styles.legend)}>Recent runs</p>
      <ul {...stylex.props(styles.runs)}>
        {runs.data?.slice(0, 6).map((r) => (
          <li key={r.id} {...stylex.props(styles.run)}>
            <Badge tone={statusOf(r.status).tone}>
              {statusOf(r.status).label}
            </Badge>
            <span {...stylex.props(styles.runText)}>
              {r.error ?? r.summary ?? "—"}
            </span>
            <span {...stylex.props(settingsStyles.sub)}>
              {ago(r.startedAt)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScheduleEditor({
  value,
  onChange,
}: {
  value: Schedule;
  onChange: (s: Schedule) => void;
}) {
  return (
    <div {...stylex.props(styles.schedule)}>
      <Field label="When">
        {(id) => (
          <Select
            id={id}
            value={value.type}
            onChange={(e) => {
              onChange(defaultSchedule(e.target.value));
            }}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="interval">Every few hours</option>
          </Select>
        )}
      </Field>
      {value.type === "weekly" && (
        <Field label="Day">
          {(id) => (
            <Select
              id={id}
              value={value.weekday}
              onChange={(e) =>
                onChange({ ...value, weekday: Number(e.target.value) })
              }
            >
              {DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {value.type === "interval" ? (
        <Field label="Every (minutes)">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={5}
              value={value.minutes}
              onChange={(e) =>
                onChange({
                  ...value,
                  minutes: Math.max(5, Number(e.target.value)),
                })
              }
            />
          )}
        </Field>
      ) : (
        <Field label="Time">
          {(id) => (
            <Input
              id={id}
              type="time"
              value={value.at}
              onChange={(e) => onChange({ ...value, at: e.target.value })}
            />
          )}
        </Field>
      )}
      {value.type === "daily" && (
        <div {...stylex.props(styles.days)}>
          {DAYS.map((d, i) => {
            const on = (value.weekdays ?? [0, 1, 2, 3, 4, 5, 6]).includes(i);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={d}
                onClick={() => {
                  const days = value.weekdays ?? [0, 1, 2, 3, 4, 5, 6];
                  onChange({
                    ...value,
                    weekdays: on
                      ? days.filter((x) => x !== i)
                      : [...days, i].toSorted((a, b) => a - b),
                  });
                }}
                {...stylex.props(styles.day, on && styles.dayOn)}
              >
                {d.slice(0, 2)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const TARGET_ICONS: Record<Schemas["DeliveryTarget"]["kind"], ReactNode> = {
  email: <EnvelopeSimpleIcon size={14} />,
  slack: <HashIcon size={14} />,
  discord: <ChatCircleIcon size={14} />,
  webhook: <WebhooksLogoIcon size={14} />,
};

const ADDRESS_HINT: Record<Schemas["DeliveryTarget"]["kind"], string> = {
  email: "name@team.org",
  slack: "Channel id, like C0123ABCD",
  discord: "Channel id",
  webhook: "https://…",
};

export function Delivery() {
  const targets = useQuery(q.targets());
  const [adding, setAdding] = useState<
    Schemas["DeliveryTarget"]["kind"] | null
  >(null);
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["targets"] });
  };
  const test = useMutation({
    mutationFn: async (id: string) =>
      await unwrap(
        api.POST("/v1/delivery-targets/{id}/test", { params: { path: { id } } })
      ),
    onSuccess: (r) =>
      r.delivered
        ? toast.success("Test message delivered")
        : toast.error(r.error ?? "Couldn't deliver"),
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) =>
      await unwrap(
        api.DELETE("/v1/delivery-targets/{id}", { params: { path: { id } } })
      ),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });
  const toggle = useMutation({
    mutationFn: async (t: Schemas["DeliveryTarget"]) =>
      await unwrap(
        api.PATCH("/v1/delivery-targets/{id}", {
          params: { path: { id: t.id } },
          body: { visibility: t.visibility === "team" ? "private" : "team" },
        })
      ),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });
  return (
    <SettingsPage
      title="Delivery"
      description="Where briefs, digests and routines can send. Team destinations only ever receive team-visible work."
      actions={
        <Menu
          align="end"
          trigger={
            <Button size="sm" variant="primary" icon={<PlusIcon size={14} />}>
              Add destination
            </Button>
          }
        >
          <MenuItem
            icon={<EnvelopeSimpleIcon size={14} />}
            onClick={() => setAdding("email")}
          >
            Email
          </MenuItem>
          <MenuItem
            icon={<HashIcon size={14} />}
            onClick={() => setAdding("slack")}
          >
            Slack channel
          </MenuItem>
          <MenuItem
            icon={<ChatCircleIcon size={14} />}
            onClick={() => setAdding("discord")}
          >
            Discord channel
          </MenuItem>
          <MenuItem
            icon={<WebhooksLogoIcon size={14} />}
            onClick={() => setAdding("webhook")}
          >
            Webhook
          </MenuItem>
        </Menu>
      }
    >
      <Card>
        {targets.isPending && (
          <div {...stylex.props(settingsStyles.pad)}>
            <Skeleton lines={3} />
          </div>
        )}
        {targets.data?.length === 0 && (
          <EmptyState
            icon={<PaperPlaneRightIcon size={20} />}
            title="Nowhere to send yet"
          >
            Briefs still appear in Worklog. Add your email or a Slack channel to
            get them where you are.
          </EmptyState>
        )}
        <ul {...stylex.props(settingsStyles.list)}>
          {targets.data?.map((t) => (
            <li key={t.id} {...stylex.props(settingsStyles.listRow)}>
              <span {...stylex.props(styles.targetIcon)}>
                {TARGET_ICONS[t.kind]}
              </span>
              <div {...stylex.props(settingsStyles.main)}>
                <p {...stylex.props(settingsStyles.strong)}>{t.label}</p>
                <p {...stylex.props(settingsStyles.sub)}>{t.address}</p>
              </div>
              <Tooltip label="Click to switch">
                <button type="button" onClick={() => toggle.mutate(t)}>
                  <Badge tone={t.visibility === "team" ? "blue" : "neutral"}>
                    {t.visibility === "team" ? "Team" : "Private"}
                  </Badge>
                </button>
              </Tooltip>
              <Button
                size="sm"
                variant="ghost"
                busy={test.isPending && test.variables === t.id}
                onClick={() => test.mutate(t.id)}
              >
                Send test
              </Button>
              <Tooltip label="Remove">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove ${t.label}`}
                  icon={<TrashIcon size={14} />}
                  onClick={() => remove.mutate(t.id)}
                />
              </Tooltip>
            </li>
          ))}
        </ul>
      </Card>
      {adding && <AddTarget kind={adding} onClose={() => setAdding(null)} />}
    </SettingsPage>
  );
}

function AddTarget({
  kind,
  onClose,
}: {
  kind: Schemas["DeliveryTarget"]["kind"];
  onClose: () => void;
}) {
  const connections = useQuery(q.connections());
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [visibility, setVisibility] = useState<"private" | "team">(
    kind === "email" ? "private" : "team"
  );
  const [connectionId, setConnectionId] = useState("");
  const client = useQueryClient();
  const usable = connections.data?.filter((c) => c.provider === kind) ?? [];
  const add = useMutation({
    mutationFn: async () =>
      await unwrap(
        api.POST("/v1/delivery-targets", {
          body: {
            kind,
            address: address.trim(),
            label: label.trim() || undefined,
            visibility,
            connectionId: connectionId || undefined,
          },
        })
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["targets"] });
      toast.success("Destination added");
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) {
          onClose();
        }
      }}
      title={`Add ${targetNoun(kind)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!address.trim()}
            busy={add.isPending}
            onClick={() => add.mutate()}
          >
            Add
          </Button>
        </>
      }
    >
      <div {...stylex.props(styles.body)}>
        <Field label="Address">
          {(id) => (
            <Input
              id={id}
              autoFocus
              placeholder={ADDRESS_HINT[kind]}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          )}
        </Field>
        <Field label="Label" hint="Optional.">
          {(id) => (
            <Input
              id={id}
              placeholder={kind === "email" ? "My inbox" : "#team-updates"}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          )}
        </Field>
        {(kind === "slack" || kind === "discord") && (
          <Field label="Through connection">
            {(id) => (
              <Select
                id={id}
                value={connectionId}
                onChange={(e) => setConnectionId(e.target.value)}
              >
                <option value="">Choose…</option>
                {usable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field
          label="Who sees it"
          hint="A team destination never receives private items."
        >
          {(id) => (
            <Select
              id={id}
              value={visibility}
              onChange={(e) => {
                const next = e.target.value;
                if (next === "private" || next === "team") {
                  setVisibility(next);
                }
              }}
            >
              <option value="private">Just me</option>
              <option value="team">The team</option>
            </Select>
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function isKind(value: string): value is Kind {
  return Object.hasOwn(KINDS, value);
}

function defaultSchedule(type: string): Schedule {
  if (type === "weekly") {
    return { type: "weekly", weekday: 5, at: "16:00" };
  }
  if (type === "interval") {
    return { type: "interval", minutes: 60, activeHoursOnly: true };
  }
  return { type: "daily", at: "08:00", weekdays: [1, 2, 3, 4, 5] };
}

function targetNoun(kind: Schemas["DeliveryTarget"]["kind"]) {
  if (kind === "webhook") {
    return "a webhook";
  }
  if (kind === "email") {
    return "an email";
  }
  return `a ${kind[0]?.toUpperCase()}${kind.slice(1)} channel`;
}

const styles = stylex.create({
  rowButton: { textAlign: "left" },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
    paddingInline: space.xl,
    paddingBottom: space.xl,
    overflowY: "auto",
  },
  two: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: space.md },
  schedule: {
    display: "flex",
    alignItems: "flex-end",
    flexWrap: "wrap",
    gap: space.md,
  },
  days: { display: "flex", gap: space.xs, paddingBottom: 2 },
  day: {
    width: 32,
    height: 28,
    borderRadius: radius.sm,
    fontSize: text.meta,
    fontWeight: 500,
    color: color.fgMuted,
    backgroundColor: {
      default: color.ui,
      ":hover": { default: null, [media.hover]: color.uiHover },
    },
  },
  dayOn: {
    color: color.fgOnSolid,
    backgroundColor: {
      default: color.accent,
      ":hover": { default: null, [media.hover]: color.accentHover },
    },
  },
  targets: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    borderWidth: 0,
    padding: 0,
    margin: 0,
  },
  legend: { fontSize: text.label, fontWeight: 500, marginBottom: space.sm },
  target: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    fontSize: text.label,
    cursor: "pointer",
  },
  runs: { display: "flex", flexDirection: "column", gap: space.sm },
  run: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    fontSize: text.meta,
  },
  runText: {
    flexGrow: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: color.fg,
  },
  delete: { marginInlineEnd: "auto", color: color.redFg },
  targetIcon: {
    display: "grid",
    placeItems: "center",
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    color: color.fgMuted,
    backgroundColor: color.ui,
  },
});
