import {
  ArrowsClockwiseIcon,
  CalendarBlankIcon,
  TicketIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import type { Schemas } from "#api/client";
import { q } from "#api/queries";
import { useMe } from "#features/auth/session";
import { isStale, ownerWord } from "#features/people/agent-run";
import { ago, shortDay } from "#lib/time";
import { Avatar, AvatarStack } from "#ui/avatar";
import type { Status, Tone } from "#ui/chip";
import { addDays, localDay } from "#ui/date-picker";
import { Ghost } from "#ui/ghost";
import {
  color,
  font,
  leading,
  media,
  motion,
  radius,
  shadow,
  space,
  text,
} from "#ui/tokens.stylex";

export type Card = Schemas["Card"];
export type Member = Schemas["Member"];

const HUES: Record<string, number> = {
  gray: -1,
  red: 25,
  orange: 50,
  amber: 75,
  yellow: 95,
  lime: 125,
  green: 150,
  teal: 185,
  cyan: 210,
  blue: 250,
  indigo: 268,
  violet: 295,
  purple: 310,
  pink: 350,
};

export const COLUMN_COLORS = Object.keys(HUES);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Column colours are names; unknown ones fall back to gray rather than failing. */
export function hueOfColor(name: string | null | undefined) {
  return HUES[name ?? "gray"] ?? -1;
}

const ROLES: Record<Schemas["Member"]["role"], string> = {
  owner: "Workspace owner",
  admin: "Admin",
  member: "Member",
};

/** What someone does, or failing a title, what they are here: never a filler like "Teammate". */
export function roleOf(member: Schemas["Member"]) {
  return (
    member.title ?? (member.kind === "agent" ? "Agent" : ROLES[member.role])
  );
}

const PROVIDERS: Record<string, string> = {
  worklog: "Worklog",
  "claude-code": "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
  devin: "Devin",
  copilot: "GitHub Copilot",
};

/** Where an agent runs, as people write it: "Claude Code", not "claude-code". */
export function providerName(id: string) {
  return (
    PROVIDERS[id] ??
    id.replaceAll("-", " ").replace(/^\w/u, (c) => c.toUpperCase())
  );
}

export function useMembers() {
  const { data } = useQuery(q.members());
  return useMemo(() => {
    const byId = new Map<string, Member>();
    for (const m of data ?? []) {
      byId.set(m.id, m);
    }
    return { list: data ?? [], byId };
  }, [data]);
}

export function CardTile({
  card,
  columnColor,
  showBoard,
  boardName,
  sx,
}: {
  card: Card;
  columnColor?: string | null;
  showBoard?: boolean;
  boardName?: string;
  sx?: StyleXStyles;
}) {
  const { byId } = useMembers();
  const assignees = card.assigneeIds
    .map((id) => byId.get(id))
    .filter((m) => m !== undefined);
  const creator = card.createdById ? byId.get(card.createdById) : undefined;
  const hue = hueOfColor(columnColor);
  const drifting = card.entropy?.postponingSoon === true;
  const closed = card.stage === "done" || card.stage === "not_now";

  return (
    <Link
      to="."
      search={(prev: Record<string, unknown>) => ({
        ...prev,
        card: card.number,
      })}
      draggable={false}
      {...stylex.props(
        styles.tile,
        card.golden && styles.golden,
        drifting && styles.drifting,
        closed && styles.closed,
        sx
      )}
    >
      <div {...stylex.props(styles.top)}>
        <span {...stylex.props(styles.tag, styles.tagTint(hue))}>
          <span {...stylex.props(styles.number)}>#{card.number}</span>
          {showBoard === true &&
            (boardName ?? card.columnName ?? stageLabel(card.stage))}
        </span>
        {card.golden && (
          <span title="Golden ticket" {...stylex.props(styles.ticket)}>
            <TicketIcon size={13} weight="bold" />
          </span>
        )}
      </div>
      <p {...stylex.props(styles.title)}>{card.title}</p>
      {(card.tags.length > 0 || card.dueOn) && (
        <div {...stylex.props(styles.tags)}>
          {card.dueOn && <DueChip on={card.dueOn} done={closed} />}
          {card.tags.slice(0, 3).map((tag) => (
            <span key={tag} {...stylex.props(styles.tagText)}>
              #{tag}
            </span>
          ))}
        </div>
      )}
      {!closed && <CardRun number={card.number} />}
      <TileMeta card={card} creator={creator} assignees={assignees} />
      {drifting && card.entropy && (
        <DriftBubble at={card.entropy.autoPostponeAt} />
      )}
      {closed && <Stamp card={card} />}
    </Link>
  );
}

/**
 * An agent at work on a card says so on the card, as a person at the desk would. Only runs that
 * are moving or waiting on someone show: a finished run is in the history, and a stalled one is
 * on People.
 */
export function CardRun({ number, full }: { number: number; full?: boolean }) {
  const { data: on } = useQuery({
    ...q.teamNow(3),
    select: (rows) =>
      rows.find(
        (row) =>
          row.agent?.cardNumber === number &&
          (row.agent.state === "needs_you" ||
            (row.agent.state === "working" && !isStale(row.agent)))
      ),
  });
  const { byId } = useMembers();
  const me = useMe();
  const agent = on ? byId.get(on.memberId) : undefined;
  if (!on?.agent || !agent) {
    return null;
  }
  const owner = agent.ownerId ? byId.get(agent.ownerId) : undefined;
  const waiting = on.agent.state === "needs_you";
  const who = ownerWord(owner, me?.member.id) ?? "a person";
  return (
    <p {...stylex.props(styles.run, full === true && styles.runFull)}>
      <Ghost
        mood={waiting ? "waiting" : "thinking"}
        size={full === true ? 16 : 14}
      />
      <span {...stylex.props(full !== true && styles.runText)}>
        <span {...stylex.props(styles.runName)}>{agent.name}</span>{" "}
        {waiting ? (
          <span {...stylex.props(styles.runWaiting)}>needs {who}:</span>
        ) : (
          <span {...stylex.props(styles.runWorking)}>is on it:</span>
        )}{" "}
        {on.agent.title}
      </span>
    </p>
  );
}

function TileMeta({
  card,
  creator,
  assignees,
}: {
  card: Card;
  creator: Member | undefined;
  assignees: Member[];
}) {
  const closed = card.stage === "done" || card.stage === "not_now";
  return (
    <div {...stylex.props(styles.meta, closed && styles.stampedMeta)}>
      {creator && <Avatar person={creator} size={16} labelled />}
      <span title="Added">{ago(card.createdAt)}</span>
      {/* Untouched since it was added, the second time would only repeat the first. */}
      {ago(card.lastActiveAt) !== ago(card.createdAt) && (
        <>
          <span {...stylex.props(styles.sep)} />
          <ArrowsClockwiseIcon size={10} aria-hidden />
          <span title="Last activity">{ago(card.lastActiveAt)}</span>
        </>
      )}
      {assignees.length > 0 && (
        <span
          title={`Assigned to ${assignees.map((m) => m.name).join(", ")}`}
          {...stylex.props(styles.assignees)}
        >
          <AvatarStack people={assignees} size={18} />
        </span>
      )}
    </div>
  );
}

const dueFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

/** Due dates are plain calendar days; overdue only matters while the card is still open. */
export function DueChip({ on, done }: { on: string; done: boolean }) {
  const today = localDay(new Date(useHourlyNow()));
  const overdue = !done && on < today;
  const soon = !done && !overdue && on <= addDays(today, 2);
  return (
    <span
      title={overdue ? "Overdue" : "Due"}
      {...stylex.props(
        styles.due,
        overdue && styles.dueLate,
        soon && styles.dueSoon
      )}
    >
      <CalendarBlankIcon size={11} aria-hidden />
      {on === today ? "Today" : dueFormat.format(new Date(`${on}T00:00:00`))}
    </span>
  );
}

/** One color per stage wherever a card's place is shown as a badge. */
export const STAGE_TONE: Record<Card["stage"], Tone> = {
  triage: "violet",
  active: "blue",
  not_now: "neutral",
  done: "green",
};

export const STAGE_STATUS: Record<Card["stage"], Status> = {
  triage: "maybe",
  active: "working",
  not_now: "paused",
  done: "done",
};

export function stageLabel(stage: Card["stage"]) {
  return {
    triage: "Maybe?",
    active: "Active",
    not_now: "Not now",
    done: "Done",
  }[stage];
}

/** The last quarter of a card's drift window, counted down so it can't be missed. */
function DriftBubble({ at }: { at: string }) {
  const now = useHourlyNow();
  const days = Math.max(0, Math.ceil((Date.parse(at) - now) / DAY));
  return (
    <span
      title="No activity lately: this card moves to Not now unless someone touches it"
      {...stylex.props(styles.bubble)}
    >
      <span {...stylex.props(styles.bubbleSmall)}>
        {days === 0 ? "drifts" : "drifts in"}
      </span>
      <span {...stylex.props(styles.bubbleNumber)}>
        {days === 0 ? "!" : days}
      </span>
      <span {...stylex.props(styles.bubbleSmall)}>{driftUnit(days)}</span>
    </span>
  );
}

// A board can stay open for days, so the countdown refreshes on its own rather than only when
// the card happens to re-render.
function useHourlyNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), HOUR);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function driftUnit(days: number) {
  if (days === 0) {
    return "today";
  }
  return days === 1 ? "day" : "days";
}

function Stamp({ card }: { card: Card }) {
  const done = card.stage === "done";
  const at = done ? card.closedAt : card.postponedAt;
  const system = !done && card.autoPostponed;
  // Pressed only when it has just happened: a column of stamps landing on every page load is noise.
  const [fresh, setFresh] = useState(
    () => at !== null && Date.now() - Date.parse(at) < FRESH_MS
  );
  return (
    <span
      {...stylex.props(
        styles.stamp,
        done ? styles.stampDone : styles.stampLater,
        system && styles.stampSystem,
        fresh && styles.stampPressed
      )}
      onAnimationEnd={() => setFresh(false)}
    >
      <span {...stylex.props(styles.stampWord)}>
        {done ? "Done" : "Not now"}
      </span>
      {at && (
        <span {...stylex.props(styles.stampDate)}>
          {shortDay(at)}
          {system ? " · drifted" : ""}
        </span>
      )}
    </span>
  );
}

const FRESH_MS = 15_000;

// Overshoots below its size before settling, the way a rubber stamp squashes into paper.
const press = stylex.keyframes({
  "0%": { opacity: 0, transform: "scale(1.8)" },
  "55%": { opacity: 1, transform: "scale(0.92)" },
  "100%": { opacity: 1, transform: "scale(1)" },
});

const inkIn = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

const styles = stylex.create({
  tile: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.raised,
    boxShadow: {
      default: shadow.card,
      ":hover": { default: null, [media.hover]: shadow.float },
    },
    color: color.fg,
    textDecoration: "none",
    transitionProperty: "box-shadow, opacity, transform",
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.out,
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
    outlineOffset: 2,
    cursor: "pointer",
  },
  golden: {
    backgroundColor: color.goldSubtle,
    backgroundImage: `linear-gradient(115deg, color-mix(in oklch, ${color.gold} 26%, transparent), transparent 40%, transparent 70%, color-mix(in oklch, ${color.gold} 18%, transparent))`,
    boxShadow: {
      default: `0 0 0 1px ${color.gold}, 0 0 0 4px color-mix(in oklch, ${color.gold} 18%, transparent), 0 6px 18px color-mix(in oklch, ${color.gold} 22%, transparent)`,
      ":hover": {
        default: null,
        [media.hover]: `0 0 0 1px ${color.gold}, 0 0 0 4px color-mix(in oklch, ${color.gold} 28%, transparent), 0 8px 24px color-mix(in oklch, ${color.gold} 30%, transparent)`,
      },
    },
  },
  drifting: {
    opacity: { default: 0.72, ":hover": { default: null, [media.hover]: 1 } },
  },
  closed: {
    opacity: { default: 0.62, ":hover": { default: null, [media.hover]: 0.9 } },
  },
  // The stamp is taller than the footer it sits beside; on a card with no tags it would reach up
  // over the title, so the footer grows to hold it.
  stampedMeta: { minHeight: 40 },
  top: { display: "flex", alignItems: "center", gap: space.sm, minWidth: 0 },
  tag: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    height: 18,
    paddingInline: space.sm,
    borderRadius: radius.xs,
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: "0.03em",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "100%",
  },
  tagTint: (hue: number) => ({
    color:
      hue < 0
        ? color.fgMuted
        : `light-dark(oklch(0.45 0.12 ${hue}), oklch(0.85 0.09 ${hue}))`,
    backgroundColor:
      hue < 0
        ? color.ui
        : `light-dark(oklch(0.95 0.035 ${hue}), oklch(0.3 0.06 ${hue}))`,
  }),
  number: {
    fontFamily: font.mono,
    fontWeight: 500,
    letterSpacing: 0,
    opacity: 0.8,
  },
  ticket: { marginInlineStart: "auto", color: color.goldFg, display: "grid" },
  title: {
    fontSize: text.label,
    lineHeight: leading.label,
    fontWeight: 500,
    textWrap: "pretty",
    overflowWrap: "anywhere",
  },
  tags: { display: "flex", flexWrap: "wrap", gap: space.sm },
  run: {
    display: "flex",
    alignItems: "center",
    gap: space.xs,
    fontSize: text.meta,
    color: color.fgMuted,
    minWidth: 0,
  },
  runText: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  runFull: {
    alignItems: "flex-start",
    fontSize: text.label,
    lineHeight: leading.label,
  },
  runName: { fontWeight: 500, color: color.fg },
  runWorking: { color: color.blueFg },
  runWaiting: { color: color.amberFg, fontWeight: 500 },
  tagText: { fontSize: text.meta, color: color.fgMuted },
  due: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    fontSize: text.meta,
    fontWeight: 500,
    color: color.fgMuted,
    fontVariantNumeric: "tabular-nums",
  },
  dueSoon: { color: color.amberFg },
  dueLate: { color: color.redFg },
  meta: {
    display: "flex",
    alignItems: "center",
    gap: space.xs,
    minHeight: 18,
    fontSize: 11.5,
    color: color.fgFaint,
    fontVariantNumeric: "tabular-nums",
  },
  sep: { width: 2 },
  assignees: { display: "inline-flex", marginInlineStart: "auto" },
  bubble: {
    position: "absolute",
    top: -10,
    right: -8,
    width: 46,
    height: 46,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "56% 44% 58% 42% / 52% 48% 52% 48%",
    color: color.amberFg,
    backgroundColor: color.amberSubtle,
    boxShadow: `0 0 0 1.5px color-mix(in oklch, ${color.amber} 55%, transparent), 0 2px 6px color-mix(in oklch, ${color.amber} 20%, transparent)`,
    rotate: "-6deg",
    lineHeight: 1,
    pointerEvents: "auto",
  },
  bubbleSmall: {
    fontSize: 7.5,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  bubbleNumber: {
    fontSize: 16,
    // design-allow: the drift countdown is a printed badge, heavier than any interface text
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
  },
  stamp: {
    position: "absolute",
    right: 10,
    bottom: 8,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingBlock: 2,
    paddingInline: space.sm,
    borderWidth: 2,
    borderStyle: "solid",
    borderRadius: radius.xs,
    rotate: "-7deg",
    lineHeight: 1.1,
    pointerEvents: "none",
    backgroundColor: color.raised,
  },
  stampDone: { color: color.greenFg, borderColor: color.green },
  stampLater: { color: color.fgMuted, borderColor: color.lineStrong },
  stampSystem: { borderStyle: "dashed" },
  stampPressed: {
    animationName: {
      default: press,
      "@media (prefers-reduced-motion: reduce)": inkIn,
    },
    animationDuration: "320ms",
    animationTimingFunction: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    animationFillMode: "both",
  },
  stampWord: {
    fontSize: 11,
    // design-allow: a rubber stamp, like Fizzy's, reads as ink rather than interface
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  stampDate: { fontSize: 9, fontWeight: 600 },
});
