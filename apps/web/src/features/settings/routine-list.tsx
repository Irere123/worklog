import { PlayIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Schemas } from "#api/client";
import { api, unwrap } from "#api/client";
import { q } from "#api/queries";
import { AssistantFace, usePresence } from "#features/assistant/presence";
import { Button } from "#ui/button";
import { Switch } from "#ui/field";
import { Tooltip } from "#ui/overlay";
import { color, leading, radius, space, text } from "#ui/tokens.stylex";

import { routineLast, routineWhen, statusOf } from "./routine-words";

type Automation = Schemas["Automation"];

/**
 * A person's routines, the same wherever they're listed: what each is, when it next runs, what it
 * came to last time, a switch, and Run now. Upkeep (the check, the memory tidy) comes last, after
 * what the assistant does for them. The caller frames it and owns the editor.
 */
export function RoutineList({
  routines,
  onEdit,
}: {
  routines: Automation[];
  onEdit: (routine: Automation) => void;
}) {
  const { agent, presence } = usePresence();
  const { toggle, run } = useRoutineActions();
  const running = new Set(
    presence?.working.flatMap((w) =>
      w.kind === "routine" ? [w.automationId] : []
    )
  );
  const rows = routines.toSorted((a, b) => Number(a.upkeep) - Number(b.upkeep));
  return (
    <ul {...stylex.props(styles.list)}>
      {rows.map((a) => {
        const busy = running.has(a.id);
        const last = routineLast(a);
        return (
          <li key={a.id} {...stylex.props(styles.row)}>
            <Switch
              checked={a.enabled}
              onCheckedChange={() => toggle.mutate(a)}
              label={`${a.name} runs on its own`}
            />
            <button
              type="button"
              onClick={() => onEdit(a)}
              {...stylex.props(styles.main)}
            >
              <span {...stylex.props(styles.name, !a.enabled && styles.off)}>
                {a.name}
              </span>
              <span {...stylex.props(styles.sub)}>{routineWhen(a, busy)}</span>
              {last && (
                <span
                  {...stylex.props(
                    styles.sub,
                    styles.last,
                    last.failing && styles.failing
                  )}
                >
                  {last.text}
                </span>
              )}
            </button>
            {busy ? (
              <Tooltip label="Running now">
                <span {...stylex.props(styles.slot)}>
                  <AssistantFace agent={agent} state="working" size={18} />
                </span>
              </Tooltip>
            ) : (
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
            )}
          </li>
        );
      })}
    </ul>
  );
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
    gap: space.lg,
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: color.line,
  },
  main: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.xxs,
    flexGrow: 1,
    minWidth: 0,
    padding: 0,
    borderWidth: 0,
    borderRadius: radius.sm,
    textAlign: "start",
    color: "inherit",
    backgroundColor: "transparent",
    cursor: "pointer",
    font: "inherit",
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
    outlineOffset: 2,
  },
  name: {
    fontSize: text.label,
    lineHeight: leading.label,
    fontWeight: 500,
    color: color.fg,
  },
  off: { color: color.fgMuted },
  // When it runs is the line people come for, so a phone wraps it rather than cutting it off.
  sub: {
    maxWidth: "100%",
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgMuted,
  },
  last: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: color.fgFaint,
  },
  failing: { color: color.redFg },
  slot: { display: "inline-grid", placeItems: "center", width: 28, height: 28 },
});
