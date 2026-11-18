import {
  ChatCircleIcon,
  ChatTextIcon,
  CodeIcon,
  CheckCircleIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  HourglassMediumIcon,
  KanbanIcon,
  LightbulbIcon,
  LockIcon,
  NotePencilIcon,
  RadioButtonIcon,
  RocketLaunchIcon,
  TagIcon,
  TicketIcon,
  TrophyIcon,
  UserPlusIcon,
  WarningCircleIcon,
  WebhooksLogoIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useState } from "react";

import type { Schemas } from "#api/client";
import { useMembers } from "#features/cards/card-bits";
import { runMood } from "#features/people/agent-run";
import { ago, exactTime } from "#lib/time";
import { Avatar } from "#ui/avatar";
import { Badge } from "#ui/chip";
import type { Tone } from "#ui/chip";
import { Ghost } from "#ui/ghost";
import { isProduct, ProductMark } from "#ui/product-mark";
import { color, leading, media, radius, space, text } from "#ui/tokens.stylex";

export type Activity = Schemas["Activity"];

const NONE: Activity[] = [];
const FRESH_MS = 10_000;

const arrive = stylex.keyframes({
  from: { backgroundColor: color.accentSubtle },
  to: { backgroundColor: "transparent" },
});

const SOURCES: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  gitea: "Gitea",
  slack: "Slack",
  discord: "Discord",
  worklog: "Worklog",
  webhook: "Webhook",
  api: "API",
  mcp: "MCP",
};

/** The tool's own mark, or a generic one for webhooks and code that pushes events itself. */
export function SourceGlyph({
  source,
  size = 16,
}: {
  source: string;
  size?: number;
}) {
  if (isProduct(source)) {
    return <ProductMark product={source} size={size} />;
  }
  const Mark = source === "webhook" ? WebhooksLogoIcon : CodeIcon;
  return <Mark size={size} weight="fill" aria-hidden />;
}

export function sourceLabel(source: string) {
  return SOURCES[source] ?? source;
}

const IN_APP = new Set(["worklog", "api", "mcp"]);

/** The tool's own mark beside its name. Worklog's own sources and unknown ones are words alone: a mark only helps where it is recognised. */
export function SourceName({
  source,
  size = 12,
}: {
  source: string;
  size?: number;
}) {
  return (
    <span {...stylex.props(styles.source)}>
      {(isProduct(source) || source === "webhook") && (
        <SourceGlyph source={source} size={size} />
      )}
      {sourceLabel(source)}
    </span>
  );
}

type Look = { icon: ReactNode; tone: Tone };

/** The verb decides the icon; the source is a word beside it, so no brand marks are needed. */
export function lookOf(activity: Activity) {
  const { kind } = activity;
  const size = 14;
  if (activity.agentState || kind.startsWith("agent.")) {
    const state = activity.agentState ?? "working";
    return {
      icon: <Ghost mood={runMood(state)} size={size + 2} still tinted />,
      tone: STATE[state]?.tone ?? "blue",
    };
  }
  const table: [RegExp, Look][] = [
    [/merged/u, { icon: <GitMergeIcon size={size} />, tone: "violet" }],
    [
      /^(?:pr|mr|pull_request|merge_request)\./u,
      { icon: <GitPullRequestIcon size={size} />, tone: "green" },
    ],
    [/review/u, { icon: <ChatTextIcon size={size} />, tone: "blue" }],
    [
      /^(?:push|commit)/u,
      { icon: <GitCommitIcon size={size} />, tone: "neutral" },
    ],
    [/branch/u, { icon: <GitBranchIcon size={size} />, tone: "neutral" }],
    [/^issue/u, { icon: <RadioButtonIcon size={size} />, tone: "green" }],
    [/^release/u, { icon: <RocketLaunchIcon size={size} />, tone: "accent" }],
    [/deploy/u, { icon: <RocketLaunchIcon size={size} />, tone: "accent" }],
    [
      /comment|message|reply|thread/u,
      { icon: <ChatCircleIcon size={size} />, tone: "blue" },
    ],
    [/decision/u, { icon: <LightbulbIcon size={size} />, tone: "amber" }],
    [/blocker/u, { icon: <WarningCircleIcon size={size} />, tone: "red" }],
    [/win/u, { icon: <TrophyIcon size={size} />, tone: "gold" }],
    [/^log/u, { icon: <NotePencilIcon size={size} />, tone: "neutral" }],
    [
      /card\.(?:closed|done)/u,
      { icon: <CheckCircleIcon size={size} />, tone: "green" },
    ],
    [
      /card\.(?:postponed|not_now)/u,
      { icon: <HourglassMediumIcon size={size} />, tone: "neutral" },
    ],
    [
      /card\.(?:gilded|golden)/u,
      { icon: <TicketIcon size={size} />, tone: "gold" },
    ],
    [
      /card\.assigned/u,
      { icon: <UserPlusIcon size={size} />, tone: "neutral" },
    ],
    [/^card/u, { icon: <KanbanIcon size={size} />, tone: "neutral" }],
    [/tag/u, { icon: <TagIcon size={size} />, tone: "neutral" }],
  ];
  return (
    table.find(([re]) => re.test(kind))?.[1] ?? {
      icon: <WebhooksLogoIcon size={size} />,
      tone: "neutral",
    }
  );
}

const STATE: Record<string, { label: string; tone: Tone }> = {
  working: { label: "Working", tone: "blue" },
  needs_you: { label: "Needs you", tone: "amber" },
  finished: { label: "Finished", tone: "green" },
  failed: { label: "Couldn’t finish", tone: "red" },
};

const CARD_VERBS: Record<string, string> = {
  "card.created": "Added this card",
  "card.closed": "Marked it done",
  "card.reopened": "Reopened it",
  "card.postponed": "Moved it to Not now",
  "card.gilded": "Gave it a golden ticket",
};

const RUN_MS = 60 * 60 * 1000;

/** Whether two events, newer first, read as one line: same person, same card, close together. */
export function sameRun(newer: Activity, older: Activity) {
  return (
    newer.cardId !== null &&
    newer.cardId === older.cardId &&
    newer.actorId === older.actorId &&
    !newer.agentState &&
    !older.agentState &&
    Date.parse(newer.occurredAt) - Date.parse(older.occurredAt) < RUN_MS
  );
}

/** Folds a newest-first list into runs: each row keeps its newest event and the ones before it. */
export function foldRuns(activities: Activity[]) {
  const rows: { activity: Activity; earlier: Activity[] }[] = [];
  for (const activity of activities) {
    const previous = rows.at(-1);
    if (previous && sameRun(previous.activity, activity)) {
      previous.earlier.push(activity);
    } else {
      rows.push({ activity, earlier: [] });
    }
  }
  return rows;
}

function stepsOf(activity: Activity, earlier: Activity[]) {
  return [...earlier.toReversed(), activity]
    .map(bodyOrVerb)
    .filter((step) => step !== null && step !== "")
    .filter((step, i, all) => step !== all[i - 1])
    .join(" · ");
}

function bodyOrVerb(activity: Activity) {
  if (activity.body !== null && activity.body !== "") {
    return activity.body;
  }
  return CARD_VERBS[activity.kind] ?? null;
}

export function ActivityLine({
  activity,
  earlier = NONE,
  compact = false,
  hideCard = false,
  hideActor = false,
}: {
  activity: Activity;
  /** Older events by the same person on the same card, folded into this row, newest first. */
  earlier?: Activity[];
  compact?: boolean;
  hideCard?: boolean;
  hideActor?: boolean;
}) {
  const { byId } = useMembers();
  const actor = activity.actorId ? byId.get(activity.actorId) : undefined;
  const look = lookOf(activity);
  const cardBody =
    hideCard && /^#\d+\s/u.test(activity.title)
      ? stepsOf(activity, earlier)
      : null;
  const aboutCard = cardBody !== null && cardBody !== "";
  const [fresh, setFresh] = useState(
    () => Date.now() - Date.parse(activity.occurredAt) < FRESH_MS
  );

  return (
    <article
      {...stylex.props(
        styles.line,
        compact && styles.compact,
        fresh && styles.fresh
      )}
      onAnimationEnd={() => setFresh(false)}
    >
      <span {...stylex.props(styles.icon, iconTones[look.tone])}>
        {look.icon}
      </span>
      <div {...stylex.props(styles.main)}>
        <div {...stylex.props(styles.head)}>
          {!hideActor && (
            <span {...stylex.props(styles.actor)}>
              {actor && <Avatar person={actor} size={16} />}
              {actor ? (
                <Link
                  to="/people/$handle"
                  params={{ handle: actor.handle }}
                  {...stylex.props(styles.actorLink)}
                >
                  {actor.name}
                </Link>
              ) : (
                <span>Someone</span>
              )}
            </span>
          )}
          <span {...stylex.props(styles.title)}>
            <ActivityTitle
              activity={activity}
              headline={aboutCard ? cardBody : activity.title}
              hideCard={hideCard}
            />
          </span>
        </div>
        {!aboutCard && (
          <ActivityBody
            activity={activity}
            earlier={earlier}
            compact={compact}
          />
        )}
        <ActivityMeta activity={activity} />
      </div>
      <time
        dateTime={activity.occurredAt}
        title={exactTime(activity.occurredAt)}
        {...stylex.props(styles.time)}
      >
        {ago(activity.occurredAt)}
      </time>
    </article>
  );
}

function ActivityBody({
  activity,
  earlier,
  compact,
}: {
  activity: Activity;
  earlier: Activity[];
  compact: boolean;
}) {
  const steps = stepsOf(activity, earlier);
  if (steps === "" || steps === activity.title) {
    return null;
  }
  return (
    <p {...stylex.props(styles.body, compact && styles.bodyOneLine)}>{steps}</p>
  );
}

function ActivityTitle({
  activity,
  headline,
  hideCard,
}: {
  activity: Activity;
  headline: string;
  hideCard: boolean;
}) {
  if (activity.url) {
    return (
      <a
        href={activity.url}
        target="_blank"
        rel="noreferrer"
        {...stylex.props(styles.titleLink)}
      >
        {headline}
      </a>
    );
  }
  const cardNumber = hideCard ? null : activity.cardNumber;
  if (cardNumber !== null) {
    return (
      <Link
        to="."
        search={(prev: Record<string, unknown>) => ({
          ...prev,
          card: cardNumber,
        })}
        {...stylex.props(styles.titleLink)}
      >
        {headline}
      </Link>
    );
  }
  return <span>{headline}</span>;
}

function ActivityMeta({ activity }: { activity: Activity }) {
  const { byId } = useMembers();
  const behalf = activity.onBehalfOfId
    ? byId.get(activity.onBehalfOfId)
    : undefined;
  const state = activity.agentState ? STATE[activity.agentState] : undefined;
  const external = !IN_APP.has(activity.source);
  const isPrivate = activity.visibility === "private";
  if (!external && !behalf && activity.count <= 1 && !isPrivate && !state) {
    return null;
  }
  return (
    <div {...stylex.props(styles.meta)}>
      {external && <SourceName source={activity.source} />}
      {behalf && <span>for {behalf.name}</span>}
      {activity.count > 1 && <span>×{activity.count}</span>}
      {isPrivate && (
        <span title="Only you can see this" {...stylex.props(styles.private)}>
          <LockIcon size={10} /> Private
        </span>
      )}
      {state && <Badge tone={state.tone}>{state.label}</Badge>}
    </div>
  );
}

const styles = stylex.create({
  source: { display: "inline-flex", alignItems: "center", gap: 4 },
  line: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.md,
    paddingBlock: space.md,
    fontSize: text.label,
    lineHeight: leading.label,
  },
  compact: { paddingBlock: space.xs },
  fresh: {
    marginInline: `calc(-1 * ${space.sm})`,
    paddingInline: space.sm,
    borderRadius: radius.sm,
    animationName: arrive,
    animationDuration: "1.8s",
    animationTimingFunction: "ease-out",
  },
  icon: {
    display: "grid",
    placeItems: "center",
    width: 24,
    height: 24,
    flexShrink: 0,
    borderRadius: radius.sm,
  },
  main: {
    flexGrow: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  head: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: space.sm,
  },
  actorLink: {
    color: color.fg,
    textDecoration: {
      default: "none",
      ":hover": { default: null, [media.hover]: "underline" },
    },
    textUnderlineOffset: 2,
  },
  actor: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    fontWeight: 600,
    color: color.fg,
    alignSelf: "center",
  },
  title: { color: color.fg, overflowWrap: "anywhere", minWidth: 0 },
  titleLink: {
    color: color.fg,
    textDecoration: {
      default: "none",
      ":hover": { default: null, [media.hover]: "underline" },
    },
    textDecorationColor: color.lineStrong,
    textUnderlineOffset: 2,
  },
  body: {
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgMuted,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  bodyOneLine: { WebkitLineClamp: 1 },
  meta: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.md,
    fontSize: 11.5,
    color: color.fgFaint,
  },
  private: { display: "inline-flex", alignItems: "center", gap: 3 },
  time: {
    flexShrink: 0,
    fontSize: text.meta,
    color: color.fgFaint,
    fontVariantNumeric: "tabular-nums",
    paddingTop: 2,
  },
});

const iconTones = stylex.create({
  neutral: { color: color.fgMuted, backgroundColor: color.ui },
  accent: { color: color.accentFg, backgroundColor: color.accentSubtle },
  gold: { color: color.goldFg, backgroundColor: color.goldSubtle },
  green: { color: color.greenFg, backgroundColor: color.greenSubtle },
  amber: { color: color.amberFg, backgroundColor: color.amberSubtle },
  red: { color: color.redFg, backgroundColor: color.redSubtle },
  violet: { color: color.violetFg, backgroundColor: color.violetSubtle },
  blue: { color: color.blueFg, backgroundColor: color.blueSubtle },
});
