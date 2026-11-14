import {
  ArchiveIcon,
  BellSimpleIcon,
  CalendarCheckIcon,
  DotsThreeIcon,
  PauseIcon,
  PencilSimpleIcon,
  PlayIcon,
  RepeatIcon,
  StackIcon,
  SunHorizonIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { toast } from "sonner";

import type { Schemas } from "#api/client";
import { api, unwrap } from "#api/client";
import { q } from "#api/queries";
import { AssistantFace, usePresence } from "#features/assistant/presence";
import { useMe } from "#features/auth/session";
import { Button } from "#ui/button";
import { Badge } from "#ui/chip";
import { Menu, MenuItem, MenuSeparator } from "#ui/overlay";
import { color, leading, media, radius, space, text } from "#ui/tokens.stylex";

import {
  describeSchedule,
  KINDS,
  routineLast,
  routineState,
  statusOf,
} from "./routine-words";
import type { RoutineState } from "./routine-words";

type Automation = Schemas["Automation"];

const KIND_ICONS: Record<Automation["kind"], ReactNode> = {
  "brief.daily": <SunHorizonIcon size={16} />,
  "brief.weekly": <CalendarCheckIcon size={16} />,
  digest: <StackIcon size={16} />,
  check: <BellSimpleIcon size={16} />,
  consolidate: <ArchiveIcon size={16} />,
  custom: <RepeatIcon size={16} />,
};

/**
 * A person's routines read as what's coming up: soonest first, each with the clock it next runs
 * at, and paused ones last. A row is something it does for them, not a setting, so pausing and
 * running now sit in its menu rather than a switch on every line. Upkeep (the check, the memory
 * tidy) comes after what it does for them. The caller frames it and owns the editor.
 */
export function RoutineList({
  routines,
  onEdit,
}: {
  routines: Automation[];
  onEdit: (routine: Automation) => void;
}) {
  const { presence } = usePresence();
  const zone = useMe()?.member.timezone ?? undefined;
  const { toggle, run } = useRoutineActions();
  const running = new Set(
    presence?.working.flatMap((w) =>
      w.kind === "routine" ? [w.automationId] : []
    )
  );
  const rows = routines.toSorted(
    (a, b) =>
      Number(a.upkeep) - Number(b.upkeep) ||
      Number(!a.enabled) - Number(!b.enabled) ||
      (a.nextRunAt ?? "~").localeCompare(b.nextRunAt ?? "~")
  );
  return (
    <ul {...stylex.props(styles.list)}>
      {rows.map((a) => {
        const state = routineState(a, running.has(a.id), zone);
        const last = routineLast(a);
        return (
          <li key={a.id} {...stylex.props(styles.row)}>
            <button
              type="button"
              onClick={() => onEdit(a)}
              {...stylex.props(styles.main)}
            >
              <span
                title={KINDS[a.kind]}
                {...stylex.props(styles.tile, !a.enabled && styles.tileOff)}
              >
                {KIND_ICONS[a.kind]}
              </span>
              <span {...stylex.props(styles.words)}>
                <span {...stylex.props(styles.name, !a.enabled && styles.off)}>
                  {a.name}
                </span>
                <span {...stylex.props(styles.sub)}>
                  {describeSchedule(a.schedule)}
                  {last && ` · ${last}`}
                </span>
              </span>
              <Where state={state} />
            </button>
            <Menu
              align="end"
              trigger={
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`${a.name} options`}
                  icon={<DotsThreeIcon size={16} weight="bold" />}
                  busy={run.isPending && run.variables?.id === a.id}
                  sx={styles.more}
                />
              }
            >
              <MenuItem
                icon={<PlayIcon size={14} />}
                disabled={state.kind === "running"}
                onClick={() => run.mutate(a)}
              >
                Run now
              </MenuItem>
              <MenuItem
                icon={
                  a.enabled ? <PauseIcon size={14} /> : <PlayIcon size={14} />
                }
                onClick={() => toggle.mutate(a)}
              >
                {a.enabled ? "Pause" : "Resume"}
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                icon={<PencilSimpleIcon size={14} />}
                onClick={() => onEdit(a)}
              >
                Edit…
              </MenuItem>
            </Menu>
          </li>
        );
      })}
    </ul>
  );
}

function Where({ state }: { state: RoutineState }) {
  if (state.kind === "running") {
    return (
      <span {...stylex.props(styles.when)}>
        <AssistantFace mood="thinking" size={16} />
        Running
      </span>
    );
  }
  if (state.kind === "failing") {
    return (
      <Badge tone="red" status="failed">
        {state.label}
      </Badge>
    );
  }
  if (state.kind === "paused") {
    return <Badge status="paused">Paused</Badge>;
  }
  return state.kind === "next" ? (
    <span {...stylex.props(styles.when)}>{state.label}</span>
  ) : null;
}

// The switch answers at once and steps back if the server refuses; a run says how it went.
function useRoutineActions() {
  const client = useQueryClient();
  const key = q.automations().queryKey;
  const refresh = () => {
    void client.invalidateQueries({ queryKey: key });
  };
  const toggle = useMutation({
    mutationFn: async (a: Automation) =>
      await unwrap(
        api.PATCH("/v1/automations/{id}", {
          params: { path: { id: a.id } },
          body: { enabled: !a.enabled },
        })
      ),
    onMutate: async (a) => {
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData(key);
      client.setQueryData(key, (list) =>
        list?.map((r) => (r.id === a.id ? { ...r, enabled: !a.enabled } : r))
      );
      return { before };
    },
    onError: (error, _a, context) => {
      client.setQueryData(key, context?.before);
      toast.error(error.message);
    },
    onSettled: refresh,
  });
  const run = useMutation({
    mutationFn: async (a: Automation) =>
      await unwrap(
        api.POST("/v1/automations/{id}/run", { params: { path: { id: a.id } } })
      ),
    onSuccess: (result, a) => {
      toast(
        result.status === "delivered"
          ? `${a.name} is in your assistant’s thread`
          : `${a.name}: ${statusOf(result.status).label.toLowerCase()}`,
        { description: result.summary ?? undefined }
      );
    },
    onError: (error) => toast.error(error.message),
    onSettled: refresh,
  });
  return { toggle, run };
}

const styles = stylex.create({
  list: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: space.xs,
    paddingInlineEnd: space.md,
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: color.line,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.surface },
    },
  },
  main: {
    display: "flex",
    alignItems: "center",
    gap: space.lg,
    flexGrow: 1,
    minWidth: 0,
    paddingBlock: space.md,
    paddingInlineStart: space.lg,
    paddingInlineEnd: space.xs,
    borderWidth: 0,
    textAlign: "start",
    color: "inherit",
    backgroundColor: "transparent",
    cursor: "pointer",
    font: "inherit",
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
    outlineOffset: -2,
  },
  tile: {
    display: "inline-grid",
    placeItems: "center",
    flexShrink: 0,
    width: 32,
    height: 32,
    borderRadius: radius.md,
    color: color.fgMuted,
    backgroundColor: color.ui,
    boxShadow: `inset 0 0 0 1px ${color.line}`,
  },
  tileOff: { color: color.fgFaint, backgroundColor: "transparent" },
  words: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minWidth: 0,
  },
  name: {
    fontSize: text.label,
    lineHeight: leading.label,
    fontWeight: 500,
    color: color.fg,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  off: { color: color.fgMuted },
  sub: {
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgMuted,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  when: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    flexShrink: 0,
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgMuted,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  more: { flexShrink: 0, color: color.fgFaint },
});
