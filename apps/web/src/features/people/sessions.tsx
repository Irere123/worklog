import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";

import type { Schemas } from "#api/client";
import { q } from "#api/queries";
import { ago, exactTime } from "#lib/time";
import { Badge } from "#ui/chip";
import type { Tone } from "#ui/chip";
import { Skeleton } from "#ui/feedback";
import { color, leading, media, radius, space, text } from "#ui/tokens.stylex";

type Activity = Schemas["Activity"];

const STATES: Record<string, { label: string; tone: Tone; order: number }> = {
  needs_you: { label: "Needs a decision", tone: "amber", order: 0 },
  working: { label: "Working", tone: "blue", order: 1 },
  failed: { label: "Stuck", tone: "red", order: 2 },
  finished: { label: "Finished", tone: "green", order: 3 },
};

type Session = { thread: string; latest: Activity; steps: number };

/**
 * An agent's work as sessions rather than a stream: one row per thread, showing where it stands
 * now. Waiting on a person comes first, then work in flight, then what's done.
 */
export function AgentSessions({ handle }: { handle: string }) {
  const recent = useQuery(q.recentActivities({ actor: handle, limit: 60 }));
  const sessions = useMemo(() => sessionsOf(recent.data ?? []), [recent.data]);
  if (recent.isPending) {
    return (
      <div {...stylex.props(styles.wrap)}>
        <Skeleton lines={3} />
      </div>
    );
  }
  if (sessions.length === 0) {
    return null;
  }
  return (
    <section aria-label="Sessions" {...stylex.props(styles.wrap)}>
      <h3 {...stylex.props(styles.title)}>Sessions</h3>
      <ul {...stylex.props(styles.list)}>
        {sessions.map(({ thread, latest, steps }) => {
          const state = STATES[latest.agentState ?? ""] ?? STATES.working;
          const card = /^#(?<n>\d+)\s/u.exec(latest.title)?.groups?.n;
          return (
            <li key={thread} {...stylex.props(styles.row)}>
              {state && <Badge tone={state.tone}>{state.label}</Badge>}
              <div {...stylex.props(styles.main)}>
                <p {...stylex.props(styles.what)}>{latest.title}</p>
                {latest.body && (
                  <p {...stylex.props(styles.body)}>{latest.body}</p>
                )}
              </div>
              {card && (
                <Link
                  to="."
                  search={(prev: Record<string, unknown>) => ({
                    ...prev,
                    card: Number(card),
                  })}
                  {...stylex.props(styles.card)}
                >
                  #{card}
                </Link>
              )}
              <span
                {...stylex.props(styles.meta)}
                title={exactTime(latest.occurredAt)}
              >
                {steps > 1 ? `${steps} updates · ` : ""}
                {ago(latest.occurredAt)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function sessionsOf(activities: Activity[]): Session[] {
  const byThread = new Map<string, Session>();
  for (const activity of activities) {
    if (!activity.agentState) {
      continue;
    }
    const thread = activity.threadKey ?? activity.id;
    const known = byThread.get(thread);
    if (known) {
      known.steps += 1;
    } else {
      byThread.set(thread, { thread, latest: activity, steps: 1 });
    }
  }
  return [...byThread.values()].toSorted(
    (a, b) =>
      (STATES[a.latest.agentState ?? ""]?.order ?? 9) -
        (STATES[b.latest.agentState ?? ""]?.order ?? 9) ||
      Date.parse(b.latest.occurredAt) - Date.parse(a.latest.occurredAt)
  );
}

const styles = stylex.create({
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    paddingInline: { default: space.x3, "@media (max-width: 640px)": space.lg },
    paddingBottom: space.lg,
  },
  title: { fontSize: text.caption, fontWeight: 500, color: color.fgFaint },
  list: {
    display: "flex",
    flexDirection: "column",
    borderRadius: radius.md,
    boxShadow: `inset 0 0 0 1px ${color.line}`,
  },
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.md,
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: { default: color.line, ":first-child": "transparent" },
  },
  main: { flexGrow: 1, minWidth: 0 },
  what: {
    fontSize: text.label,
    lineHeight: leading.label,
    fontWeight: 500,
    color: color.fg,
  },
  body: {
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgMuted,
    marginTop: 2,
  },
  card: {
    flexShrink: 0,
    fontSize: text.meta,
    fontWeight: 500,
    color: color.accentFg,
    textDecoration: {
      default: "none",
      ":hover": { default: null, [media.hover]: "underline" },
    },
  },
  meta: {
    flexShrink: 0,
    fontSize: text.meta,
    color: color.fgFaint,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
});
