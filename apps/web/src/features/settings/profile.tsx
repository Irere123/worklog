import * as stylex from "@stylexjs/stylex";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Schemas } from "#api/client";
import { api, unwrap } from "#api/client";
import { q } from "#api/queries";
import { useMe } from "#features/auth/session";
import {
  disableDesktopAlerts,
  enableDesktopAlerts,
  useDesktopAlerts,
} from "#lib/desktop-alerts";
import { Avatar } from "#ui/avatar";
import { Button } from "#ui/button";
import { Badge } from "#ui/chip";
import { Skeleton } from "#ui/feedback";
import { Field, Input, Select, Stepper, Switch, TimeSelect } from "#ui/field";
import { color, media, radius, space, text } from "#ui/tokens.stylex";

import { Card, Row, SettingsPage, settingsStyles } from "./frame";

type Settings = Schemas["MemberSettings"];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ZONES =
  typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : ["UTC"];

function useUpdateMe() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      name?: string;
      title?: string | null;
      avatarUrl?: string | null;
      timezone?: string;
      email?: string;
      settings?: Settings;
    }) => await unwrap(api.PATCH("/v1/me", { body })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["me"] });
      void client.invalidateQueries({ queryKey: ["members"] });
      toast.success("Saved");
    },
    onError: (error) => toast.error(error.message),
  });
}

export function Profile() {
  const me = useMe();
  const update = useUpdateMe();
  const member = me?.member;
  const form = useForm({
    defaultValues: {
      name: member?.name ?? "",
      title: member?.title ?? "",
      avatarUrl: member?.avatarUrl ?? "",
      email: member?.email ?? "",
      timezone:
        member?.timezone ??
        new Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    onSubmit: ({ value }) =>
      update.mutate({
        name: value.name.trim(),
        title: value.title.trim() || null,
        avatarUrl: value.avatarUrl.trim() || null,
        email: value.email.trim() || undefined,
        timezone: value.timezone,
      }),
  });
  if (!member) {
    return <Skeleton lines={6} />;
  }
  const { settings } = member;
  const workdays = settings.workdays ?? [1, 2, 3, 4, 5];
  const hours = settings.activeHours ?? { start: "09:00", end: "17:00" };

  return (
    <SettingsPage
      title="Profile"
      description="How you appear to teammates and their assistants."
    >
      <Card
        footer={
          <form.Subscribe selector={(s) => s.isDirty}>
            {(dirty) => (
              <Button
                variant="primary"
                size="sm"
                disabled={!dirty}
                busy={update.isPending}
                onClick={() => {
                  void form.handleSubmit();
                }}
              >
                Save changes
              </Button>
            )}
          </form.Subscribe>
        }
      >
        <div {...stylex.props(settingsStyles.pad, styles.profile)}>
          <form.Subscribe selector={(s) => s.values.avatarUrl}>
            {(draft) => (
              <Avatar
                person={{ ...member, avatarUrl: draft.trim() || null }}
                size={56}
              />
            )}
          </form.Subscribe>
          <div {...stylex.props(styles.fields)}>
            <form.Field name="name">
              {(field) => (
                <Field label="Name">
                  {(id) => (
                    <Input
                      id={id}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  )}
                </Field>
              )}
            </form.Field>
            <form.Field name="title">
              {(field) => (
                <Field
                  label="Role"
                  hint="Shown next to your name, and tells assistants what you do."
                >
                  {(id) => (
                    <Input
                      id={id}
                      placeholder="Backend engineer"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  )}
                </Field>
              )}
            </form.Field>
            <form.Field name="avatarUrl">
              {(field) => (
                <Field
                  label="Picture"
                  hint="A link to an image. Signing in with Google or GitHub fills it in for you."
                >
                  {(id) => (
                    <Input
                      id={id}
                      type="url"
                      inputMode="url"
                      placeholder="https://"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  )}
                </Field>
              )}
            </form.Field>
            <form.Field name="email">
              {(field) => (
                <Field
                  label="Email"
                  hint="Sign-in links and email briefs go here."
                >
                  {(id) => (
                    <Input
                      id={id}
                      type="email"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  )}
                </Field>
              )}
            </form.Field>
            <form.Field name="timezone">
              {(field) => (
                <Field label="Time zone">
                  {(id) => (
                    <Select
                      id={id}
                      value={field.state.value}
                      onValueChange={field.handleChange}
                      options={ZONES.map((z) => ({
                        value: z,
                        label: z.replaceAll("_", " "),
                      }))}
                    />
                  )}
                </Field>
              )}
            </form.Field>
          </div>
        </div>
      </Card>

      <Card
        title="Working hours"
        description="Worklog holds pings outside these hours and sends them when you’re back."
      >
        <Row label="Workdays">
          <fieldset {...stylex.props(styles.days)} aria-label="Workdays">
            {DAYS.map((label, day) => {
              const on = workdays.includes(day);
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    update.mutate({
                      settings: {
                        ...settings,
                        workdays: on
                          ? workdays.filter((d) => d !== day)
                          : [...workdays, day].toSorted((a, b) => a - b),
                      },
                    })
                  }
                  {...stylex.props(styles.day, on && styles.dayOn)}
                >
                  {label}
                </button>
              );
            })}
          </fieldset>
        </Row>
        <Row label="Active hours" description="In your time zone.">
          <TimeSelect
            label="Start"
            value={hours.start}
            onValueChange={(start) =>
              update.mutate({
                settings: { ...settings, activeHours: { ...hours, start } },
              })
            }
          />
          <span {...stylex.props(styles.to)}>to</span>
          <TimeSelect
            label="End"
            value={hours.end}
            onValueChange={(end) =>
              update.mutate({
                settings: { ...settings, activeHours: { ...hours, end } },
              })
            }
          />
        </Row>
      </Card>
    </SettingsPage>
  );
}

export function Notifications() {
  const me = useMe();
  const update = useUpdateMe();
  const metrics = useQuery(q.attentionMetrics(14));
  if (!me) {
    return <Skeleton lines={6} />;
  }
  const { settings } = me.member;
  const notify = settings.notify ?? {};
  const set = (patch: Partial<NonNullable<Settings["notify"]>>) =>
    update.mutate({
      settings: { ...settings, notify: { ...notify, ...patch } },
    });
  const m = metrics.data;

  return (
    <SettingsPage
      title="Notifications"
      description="Worklog interrupts you only for what’s blocked on you, within a budget. Everything else waits for your brief."
    >
      <Card title="Interruption budget">
        <Row
          label="Pings per day"
          description="Beyond this, items wait for your brief or digest."
        >
          <NumberInput
            value={notify.dailyPushCap ?? 4}
            min={0}
            max={50}
            onCommit={(v) => set({ dailyPushCap: v })}
          />
        </Row>
        <Row
          label="Minutes between pings"
          description="So a burst arrives as one interruption."
        >
          <NumberInput
            value={notify.minGapMinutes ?? 90}
            min={0}
            max={1440}
            onCommit={(v) => set({ minGapMinutes: v })}
          />
        </Row>
        <Row label="Hours before the same thread pings again">
          <NumberInput
            value={notify.threadCooldownHours ?? 4}
            min={0}
            max={168}
            onCommit={(v) => set({ threadCooldownHours: v })}
          />
        </Row>
      </Card>

      <DeviceAlerts />

      <Card
        title="How well it’s working"
        description="The last 14 days. How you rate pings in the inbox tunes what gets through."
      >
        {metrics.isPending ? (
          <div {...stylex.props(settingsStyles.pad)}>
            <Skeleton lines={2} />
          </div>
        ) : (
          <>
            <div {...stylex.props(styles.stats)}>
              <Stat label="Pings sent" value={String(m?.pushes ?? 0)} />
              <Stat label="Acted on" value={pct(m?.actedOnRate)} />
              <Stat label="Dismissed" value={pct(m?.dismissalRate)} />
              <Stat label="Rated useful" value={pct(m?.precision)} />
            </div>
            {(m?.mutedKinds.length ?? 0) > 0 && (
              <Row
                label="Held for your digest"
                description="Kinds you’ve dismissed or marked less useful."
              >
                {m?.mutedKinds.map((k) => (
                  <Badge key={k}>{k.replaceAll(/[._]/gu, " ")}</Badge>
                ))}
              </Row>
            )}
          </>
        )}
      </Card>
    </SettingsPage>
  );
}

const DEVICE_NOTE = {
  unsupported:
    "This browser only shows notifications from an installed app. Pings still reach your inbox and your channels.",
  denied:
    "Notifications are blocked for this site. Allow them in the browser’s site settings, then come back.",
  off: "When Worklog is open in a background tab, pings and briefs appear as system notifications, within the same budget.",
  on: "Pings and briefs appear as system notifications while Worklog is in a background tab, within the same budget.",
};

function DeviceAlerts() {
  const state = useDesktopAlerts();
  return (
    <Card title="On this device">
      <Row label="Desktop notifications" description={DEVICE_NOTE[state]}>
        <Switch
          checked={state === "on"}
          disabled={state === "unsupported" || state === "denied"}
          label="Desktop notifications"
          onCheckedChange={(next) => {
            if (next) {
              void enableDesktopAlerts();
            } else {
              disableDesktopAlerts();
            }
          }}
        />
      </Row>
    </Card>
  );
}

function pct(n: number | null | undefined) {
  return n === null || n === undefined ? "—" : `${Math.round(n * 100)}%`;
}

function NumberInput({
  value,
  min,
  max,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  return (
    <Stepper
      value={value}
      min={min}
      max={max}
      onValueCommit={(next) => {
        if (next !== value) {
          onCommit(next);
        }
      }}
    />
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
  profile: { display: "flex", gap: space.xxl, alignItems: "flex-start" },
  fields: {
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
  },
  days: {
    display: "flex",
    gap: space.xs,
    minWidth: 0,
    margin: 0,
    padding: 0,
    borderWidth: 0,
  },
  day: {
    width: 40,
    height: 28,
    borderRadius: radius.sm,
    fontSize: text.meta,
    fontWeight: 500,
    color: color.fgMuted,
    boxShadow: `inset 0 0 0 1px ${color.lineUi}`,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.uiHover },
    },
  },
  // A tint, not a solid fill: five days on in a row is the usual answer and shouldn't shout.
  dayOn: {
    color: color.accentFg,
    boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${color.accent} 40%, transparent)`,
    backgroundColor: {
      default: color.accentSubtle,
      ":hover": { default: null, [media.hover]: color.accentSubtle },
    },
  },
  to: { fontSize: text.meta, color: color.fgMuted },
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
});
