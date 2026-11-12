import * as stylex from "@stylexjs/stylex";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { q } from "#api/queries";
import { useMembers } from "#features/cards/card-bits";
import type { Member } from "#features/cards/card-bits";
import { clockTime, ribbonSince } from "#lib/time";
import { Avatar } from "#ui/avatar";
import { color, media, radius, space, text } from "#ui/tokens.stylex";

import { lookOf } from "./activity-line";
import type { Activity } from "./activity-line";

const HOUR = 3_600_000;
const SPAN = 24 * HOUR;
const LANES = 8;
const LANE_HEIGHT = 24;

type Lane = { member: Member; events: Activity[] };

export type Ribbon = ReturnType<typeof useRibbon>;

/** The ribbon's data, held by the page so the feed below can wait for it instead of jumping. */
export function useRibbon() {
  // Held in state so the query key is stable; the window slides along every ten minutes.
  const [end, setEnd] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setEnd(Date.now()), 10 * 60_000);
    return () => clearInterval(timer);
  }, []);
  const recent = useQuery({
    ...q.recentActivities({ since: ribbonSince(end), limit: 500 }),
    // A slide shouldn't blank the lanes while the next window loads.
    placeholderData: keepPreviousData,
  });
  return { end, recent };
}

/**
 * The team's last day as lanes, one per person or agent, a tick for each thing they did: when work
 * happens and who's carrying it, at a glance, before reading a single line. A lane is a filter.
 */
export function DayRibbon({
  ribbon,
  selected,
  onSelect,
}: {
  ribbon: Ribbon;
  /** Handle of the person the feed is narrowed to, if any. */
  selected?: string;
  onSelect: (handle: string | undefined) => void;
}) {
  const { end, recent } = ribbon;
  const { byId } = useMembers();

  const lanes = useMemo(() => {
    const byActor = new Map<string, Activity[]>();
    for (const activity of recent.data ?? []) {
      if (activity.actorId) {
        byActor.set(activity.actorId, [
          ...(byActor.get(activity.actorId) ?? []),
          activity,
        ]);
      }
    }
    return [...byActor.entries()]
      .map(([id, events]) => ({ member: byId.get(id), events }))
      .filter((lane): lane is Lane => lane.member !== undefined)
      .toSorted((a, b) => b.events.length - a.events.length);
  }, [recent.data, byId]);

  if (lanes.length === 0) {
    return null;
  }
  const shown = lanes.slice(0, LANES);
  const hidden = lanes.length - shown.length;
  const marks = hourMarks(end);
  const at = (iso: string) => ((Date.parse(iso) - (end - SPAN)) / SPAN) * 100;

  return (
    <section aria-label="The last 24 hours" {...stylex.props(styles.ribbon)}>
      <div {...stylex.props(styles.head)}>
        <span>Last 24 hours</span>
        {selected && (
          <button
            type="button"
            onClick={() => onSelect(undefined)}
            {...stylex.props(styles.clear)}
          >
            Show everyone
          </button>
        )}
      </div>
      <ul {...stylex.props(styles.lanes)}>
        {shown.map(({ member, events }) => {
          const on = selected === member.handle;
          const dim = selected !== undefined && !on;
          return (
            <li key={member.id}>
              <button
                type="button"
                aria-pressed={on}
                aria-label={`${member.name}: ${events.length} in the last day`}
                onClick={() => onSelect(on ? undefined : member.handle)}
                {...stylex.props(
                  styles.lane,
                  on && styles.laneOn,
                  dim && styles.dim
                )}
              >
                <span {...stylex.props(styles.who)}>
                  <Avatar person={member} size={16} />
                  <span {...stylex.props(styles.name)}>
                    {member.name.split(" ")[0]}
                  </span>
                </span>
                <span aria-hidden {...stylex.props(styles.track)}>
                  {marks.map((m) => (
                    <span
                      key={m.at}
                      {...stylex.props(styles.grid, styles.left(m.x))}
                    />
                  ))}
                  {events.map((e) => (
                    <span
                      key={e.id}
                      title={`${clockTime(e.occurredAt)} ${e.title}`}
                      {...stylex.props(
                        styles.tick,
                        ticks[lookOf(e).tone],
                        styles.left(at(e.occurredAt))
                      )}
                    />
                  ))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div aria-hidden {...stylex.props(styles.axis)}>
        <span />
        <span {...stylex.props(styles.axisTrack)}>
          {marks.map((m) => (
            <span
              key={m.at}
              {...stylex.props(styles.axisLabel, styles.left(m.x))}
            >
              {m.label}
            </span>
          ))}
          <span {...stylex.props(styles.axisNow)}>now</span>
        </span>
      </div>
      {hidden > 0 && (
        <p {...stylex.props(styles.more)}>
          and {hidden} more, in the feed below
        </p>
      )}
    </section>
  );
}

/** Midnight, 06:00, noon and 18:00 inside the window, placed as percentages along it. */
function hourMarks(end: number) {
  const start = end - SPAN;
  const first = new Date(start);
  first.setMinutes(0, 0, 0);
  first.setHours(Math.ceil(first.getHours() / 6) * 6);
  const marks: { at: number; x: number; label: string }[] = [];
  // Five hours clear of the right edge: on a phone's 230px track, three left "18:00now".
  for (let t = first.getTime(); t < end - 5 * HOUR; t += 6 * HOUR) {
    if (t > start + HOUR) {
      marks.push({
        at: t,
        x: ((t - start) / SPAN) * 100,
        label: clockTime(new Date(t).toISOString()),
      });
    }
  }
  return marks;
}

const styles = stylex.create({
  ribbon: {
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
    paddingTop: space.xl,
    paddingBottom: space.md,
  },
  head: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 20,
    fontSize: text.meta,
    fontWeight: 600,
    color: color.fgMuted,
  },
  clear: {
    fontSize: text.meta,
    fontWeight: 500,
    color: {
      default: color.accentFg,
      ":hover": { default: null, [media.hover]: color.fg },
    },
  },
  lanes: { display: "flex", flexDirection: "column" },
  lane: {
    display: "grid",
    gridTemplateColumns: "96px 1fr",
    alignItems: "center",
    width: "100%",
    height: LANE_HEIGHT,
    paddingInline: space.xs,
    borderRadius: radius.sm,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.ui },
    },
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
    outlineOffset: -2,
    transitionProperty: "opacity",
    transitionDuration: "120ms",
  },
  laneOn: { backgroundColor: color.ui },
  dim: { opacity: 0.4 },
  who: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    minWidth: 0,
  },
  name: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: text.meta,
    color: color.fg,
  },
  // A thin baseline gives empty stretches of the day a shape, so quiet hours read as quiet.
  track: {
    position: "relative",
    height: "100%",
    backgroundImage: `linear-gradient(${color.line}, ${color.line})`,
    backgroundSize: "100% 1px",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  },
  grid: {
    position: "absolute",
    top: 3,
    bottom: 3,
    width: 1,
    backgroundColor: color.line,
  },
  tick: {
    position: "absolute",
    top: 6,
    bottom: 6,
    width: 3,
    marginInlineStart: -1.5,
    borderRadius: 2,
  },
  left: (x: number) => ({ left: `${x}%` }),
  axis: {
    display: "grid",
    gridTemplateColumns: "96px 1fr",
    paddingInline: space.xs,
    height: 16,
  },
  axisTrack: { position: "relative" },
  axisLabel: {
    position: "absolute",
    transform: "translateX(-50%)",
    fontSize: text.caption,
    color: color.fgFaint,
    fontVariantNumeric: "tabular-nums",
  },
  axisNow: {
    position: "absolute",
    right: 0,
    fontSize: text.caption,
    color: color.fgFaint,
  },
  more: { fontSize: text.caption, color: color.fgFaint },
});

const ticks = stylex.create({
  neutral: { backgroundColor: color.lineStrong },
  accent: { backgroundColor: color.accent },
  gold: { backgroundColor: color.gold },
  green: { backgroundColor: color.green },
  amber: { backgroundColor: color.amber },
  red: { backgroundColor: color.red },
  violet: { backgroundColor: color.violet },
  blue: { backgroundColor: color.blue },
});
