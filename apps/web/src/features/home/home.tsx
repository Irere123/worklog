import {
  ArrowRightIcon,
  ArrowUpIcon,
  ChatsCircleIcon,
  CheckIcon,
  NewspaperIcon,
  RobotIcon,
  TicketIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { q } from "#api/queries";
import { ActivityLine, foldRuns } from "#features/activity/activity-line";
import { STARTERS } from "#features/assistant/conversations";
import { useMe } from "#features/auth/session";
import { roleOf, stageLabel, useMembers } from "#features/cards/card-bits";
import { kindOf } from "#features/inbox/inbox";
import { ago, greeting } from "#lib/time";
import { Avatar } from "#ui/avatar";
import { Badge, Dot } from "#ui/chip";
import type { Tone } from "#ui/chip";
import { EmptyState, Skeleton } from "#ui/feedback";
import { Section, layout } from "#ui/layout";
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

import { SetupChecklist } from "./setup";

export function Home() {
  const me = useMe();
  if (!me) {
    return null;
  }
  const [firstName] = me.member.name.split(" ");
  return (
    <div {...stylex.props(styles.scroll)}>
      <div {...stylex.props(styles.page)}>
        <header {...stylex.props(styles.hero)}>
          <p {...stylex.props(styles.date)}>{todayLabel()}</p>
          <h1 {...stylex.props(styles.greeting)}>
            {greeting()}, {firstName}
          </h1>
          <DaySummary />
          <Ask />
        </header>
        <div {...stylex.props(styles.grid)}>
          <div {...stylex.props(styles.main)}>
            <SetupChecklist meId={me.member.id} />
            <NeedsYou />
            <MyCards />
            <TeamNow selfId={me.member.id} />
          </div>
          <aside {...stylex.props(styles.side)}>
            <MyAgents ownerId={me.member.id} />
            <LatestBrief />
            <Today />
          </aside>
        </div>
      </div>
    </div>
  );
}

/**
 * The day in a sentence, written from the record rather than by a model: what's waiting on you,
 * and what the team got done since yesterday morning.
 */
function DaySummary() {
  // Held in state so the query key is stable, and moved on at midnight for a page left open.
  const [since, setSince] = useState(startOfYesterday);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const atMidnight = () => {
      const midnight = new Date();
      midnight.setHours(24, 0, 5, 0);
      timer = setTimeout(() => {
        setSince(startOfYesterday());
        atMidnight();
      }, midnight.getTime() - Date.now());
    };
    atMidnight();
    return () => clearTimeout(timer);
  }, []);
  const waiting = useQuery(q.attention("open"));
  const recent = useQuery(q.recentActivities({ since, limit: 200 }));
  const { byId } = useMembers();
  if (!waiting.isSuccess || !recent.isSuccess) {
    return <p {...stylex.props(styles.summary)}>&nbsp;</p>;
  }
  const open = waiting.data;
  const decision = open.find((i) => i.kind === "agent.needs_you");
  const asker = decision?.fromId ? byId.get(decision.fromId) : undefined;
  const count = (re: RegExp) =>
    recent.data.filter((a) => re.test(a.kind)).length;
  const done = [
    plural(count(/^card\.closed$/u), "card closed", "cards closed"),
    plural(count(/merged/u), "pull request merged", "pull requests merged"),
    plural(count(/^card\.created$/u), "card added", "cards added"),
  ].filter((part) => part !== null);

  return (
    <p {...stylex.props(styles.summary)}>
      {open.length === 0 ? (
        "Nothing is waiting on you."
      ) : (
        <>
          <Link to="/inbox" {...stylex.props(styles.summaryLink)}>
            {open.length === 1
              ? "One thing needs"
              : `${open.length} things need`}{" "}
            you
          </Link>
          {asker ? `, including a decision for ${asker.name}.` : "."}
        </>
      )}{" "}
      {done.length > 0
        ? `Since yesterday: ${listOf(done)}.`
        : "It’s been quiet since yesterday."}
    </p>
  );
}

function startOfYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function plural(n: number, one: string, many: string) {
  if (n === 0) {
    return null;
  }
  return `${n} ${n === 1 ? one : many}`;
}

function listOf(parts: string[]) {
  return new Intl.ListFormat("en-GB", { type: "conjunction" }).format(parts);
}

function todayLabel() {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
}

function TeammateNow({
  current,
  recent,
}: {
  current?: { number: number; title: string };
  recent?: { title: string };
}) {
  if (current) {
    return (
      <>
        <span {...stylex.props(styles.nowLabel)}>On</span> #{current.number}{" "}
        {current.title}
      </>
    );
  }
  if (recent) {
    return (
      <>
        <span {...stylex.props(styles.nowLabel)}>Last</span> {recent.title}
      </>
    );
  }
  return <span {...stylex.props(layout.faint)}>Quiet lately</span>;
}

function Ask() {
  const [value, setValue] = useState("");
  const navigate = useNavigate();
  const ask = (question: string) => {
    void navigate({ to: "/assistant", search: { ask: question } });
  };
  return (
    <div {...stylex.props(styles.askWrap)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) {
            ask(value.trim());
          }
        }}
        {...stylex.props(styles.ask)}
      >
        <ChatsCircleIcon size={16} {...stylex.props(styles.askIcon)} />
        <input
          aria-label="Ask your assistant"
          placeholder="Ask about the team’s work…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          {...stylex.props(styles.askInput)}
        />
        <button
          type="submit"
          aria-label="Ask"
          disabled={!value.trim()}
          {...stylex.props(styles.askSend)}
        >
          <ArrowUpIcon size={15} />
        </button>
      </form>
      <div {...stylex.props(styles.suggestions)}>
        {STARTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => ask(s)}
            {...stylex.props(styles.suggestion)}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function NeedsYou() {
  const items = useQuery(q.attention("open"));
  const { byId } = useMembers();
  const list = items.data ?? [];
  return (
    <Section
      title={
        <span {...stylex.props(layout.rowTight)}>
          Needs you{" "}
          {list.length > 0 && (
            <span {...stylex.props(styles.count)}>{list.length}</span>
          )}
        </span>
      }
      aside={
        <Link to="/inbox" {...stylex.props(styles.more)}>
          Inbox <ArrowRightIcon size={12} />
        </Link>
      }
    >
      {items.isPending && <Skeleton lines={3} height={44} />}
      {items.isSuccess && list.length === 0 && (
        <div {...stylex.props(styles.calm)}>
          <CheckIcon size={16} />
          Nothing is waiting on you. Worklog will tell you when something is.
        </div>
      )}
      <ul {...stylex.props(styles.panel)}>
        {list.slice(0, 4).map((item) => {
          const from = item.fromId ? byId.get(item.fromId) : undefined;
          const kind = kindOf(item.kind);
          return (
            <li key={item.id}>
              <Link
                to="/inbox"
                search={{ item: item.id }}
                {...stylex.props(styles.needRow)}
              >
                {from ? (
                  <Avatar person={from} size={24} />
                ) : (
                  <span {...stylex.props(styles.needIcon)}>{kind.icon}</span>
                )}
                <div {...stylex.props(layout.grow)}>
                  <p {...stylex.props(styles.needTitle)}>{item.title}</p>
                  <p {...stylex.props(styles.needMeta, toneText[kind.tone])}>
                    {kind.label}
                  </p>
                </div>
                {item.priority === "high" && <Dot tone="amber" />}
                <span {...stylex.props(styles.time)}>
                  {ago(item.updatedAt)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function MyCards() {
  const [active, triage] = useQueries({
    queries: [
      q.cards({ assignee: "me", stage: "active" }),
      q.cards({ assignee: "me", stage: "triage" }),
    ],
  });
  const boards = useQuery(q.boards());
  const boardName = (id: string) =>
    boards.data?.find((b) => b.id === id)?.name ?? "";
  const cards = [...(active.data ?? []), ...(triage.data ?? [])];
  return (
    <Section title="Your cards">
      {active.isPending && <Skeleton lines={3} height={36} />}
      {active.isSuccess && cards.length === 0 && (
        <p {...stylex.props(layout.meta)}>
          Nothing assigned to you. Press C to add a card, or M on any card to
          take it.
        </p>
      )}
      {cards.length > 0 && (
        <ul {...stylex.props(styles.panel)}>
          {cards.map((card) => (
            <li key={card.id}>
              <Link
                to="/boards/$boardId"
                params={{ boardId: card.boardId }}
                search={{ card: card.number }}
                {...stylex.props(styles.cardRow)}
              >
                <span {...stylex.props(styles.cardNumber)}>#{card.number}</span>
                {card.golden && (
                  <TicketIcon size={13} {...stylex.props(styles.gold)} />
                )}
                <span {...stylex.props(styles.cardTitle)}>{card.title}</span>
                <span {...stylex.props(styles.cardWhere)}>
                  {boardName(card.boardId)} ·{" "}
                  {card.columnName ?? stageLabel(card.stage)}
                </span>
                {card.entropy?.postponingSoon === true && (
                  <Badge tone="amber">Drifting</Badge>
                )}
                <span {...stylex.props(styles.time)}>
                  {ago(card.lastActiveAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

const STATE: Record<string, { label: string; tone: Tone }> = {
  working: { label: "Working", tone: "blue" },
  needs_you: { label: "Needs you", tone: "amber" },
  finished: { label: "Finished", tone: "green" },
  failed: { label: "Stuck", tone: "red" },
};

function MyAgents({ ownerId }: { ownerId: string }) {
  const { list } = useMembers();
  const agents = list.filter(
    (m) => m.kind === "agent" && m.ownerId === ownerId
  );
  const latest = useQueries({
    queries: agents.map((a) =>
      q.recentActivities({ actor: a.handle, limit: 1 })
    ),
  });
  if (agents.length === 0) {
    return null;
  }
  return (
    <Section title="Your agents">
      <ul {...stylex.props(styles.panel)}>
        {agents.map((agent, i) => {
          const last = latest[i]?.data?.[0];
          const loading = latest[i]?.isPending === true;
          const state = last?.agentState ? STATE[last.agentState] : undefined;
          return (
            <li key={agent.id}>
              <Link
                to="/people/$handle"
                params={{ handle: agent.handle }}
                {...stylex.props(styles.agentRow)}
              >
                <Avatar person={agent} size={28} />
                <div {...stylex.props(layout.grow)}>
                  <div {...stylex.props(layout.row)}>
                    <span {...stylex.props(styles.agentName)}>
                      {agent.name}
                    </span>
                    {state && <Badge tone={state.tone}>{state.label}</Badge>}
                  </div>
                  {/* "No activity yet" while it loads would be a claim, not a placeholder. */}
                  {loading ? (
                    <Skeleton lines={1} height={12} />
                  ) : (
                    <p {...stylex.props(styles.agentLast)}>
                      {last ? last.title : "No activity yet"}
                    </p>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function LatestBrief() {
  const briefs = useQuery(q.briefs());
  const brief = briefs.data?.[0];
  return (
    <Section
      title="Latest brief"
      aside={
        <Link to="/briefs" {...stylex.props(styles.more)}>
          All <ArrowRightIcon size={12} />
        </Link>
      }
    >
      {briefs.isPending && <Skeleton lines={3} />}
      {brief && (
        <Link
          to="/briefs"
          search={{ id: brief.id }}
          {...stylex.props(styles.brief)}
        >
          <span {...stylex.props(styles.briefKicker)}>
            <NewspaperIcon size={12} />{" "}
            {brief.period === "daily" ? "Daily" : "Weekly"} ·{" "}
            {ago(brief.createdAt)}
          </span>
          <span {...stylex.props(styles.briefTitle)}>{brief.title}</span>
          <span {...stylex.props(styles.briefBody)}>{excerpt(brief.body)}</span>
        </Link>
      )}
      {briefs.isSuccess && !brief && (
        <p {...stylex.props(layout.meta)}>
          Your first brief arrives on schedule, or make one on the Briefs page.
        </p>
      )}
    </Section>
  );
}

function excerpt(markdown: string) {
  return (
    markdown
      .split("\n")
      // A section heading flattened into the preview reads as part of the first sentence.
      .filter((line) => !/^\s*#{1,6}\s/u.test(line))
      .map((line) =>
        line
          .replace(/^\s*(?:[-*+]|\d+\.)\s+/u, "")
          .replaceAll(/\[(?<label>[^\]]*)\]\([^)]*\)/gu, "$<label>")
          .replaceAll(/[*_`>]/gu, "")
          .trim()
      )
      .filter(Boolean)
      // List items carry no full stops, so joined with spaces they run into each other.
      .join(" · ")
      .slice(0, 400)
  );
}

function TeamNow({ selfId }: { selfId: string }) {
  const { list } = useMembers();
  const people = list.filter((m) => m.kind === "human" && m.id !== selfId);
  const snapshots = useQueries({
    queries: people.map((p) => q.now(p.handle, 3)),
  });
  if (people.length === 0) {
    return null;
  }
  return (
    <Section
      title="Team right now"
      aside={
        <Link to="/people" {...stylex.props(styles.more)}>
          People <ArrowRightIcon size={12} />
        </Link>
      }
    >
      <ul {...stylex.props(styles.team)}>
        {people.map((person, i) => {
          const snap = snapshots[i]?.data;
          const current = snap?.inProgress[0];
          const recent = snap?.recent[0];
          return (
            <li key={person.id}>
              <Link
                to="/people/$handle"
                params={{ handle: person.handle }}
                {...stylex.props(styles.person)}
              >
                <div {...stylex.props(layout.row)}>
                  <Avatar person={person} size={28} />
                  <div {...stylex.props(layout.grow)}>
                    <p {...stylex.props(styles.personName)}>{person.name}</p>
                    <p {...stylex.props(styles.personTitle)}>
                      {roleOf(person)}
                    </p>
                  </div>
                  {snap?.lastActiveAt && (
                    <span {...stylex.props(styles.time)}>
                      {ago(snap.lastActiveAt)}
                    </span>
                  )}
                </div>
                <p {...stylex.props(styles.personNow)}>
                  <TeammateNow current={current} recent={recent} />
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Today() {
  const recent = useQuery(q.recentActivities({ limit: 8 }));
  return (
    <Section
      title="Latest"
      aside={
        <Link to="/activity" {...stylex.props(styles.more)}>
          Activity <ArrowRightIcon size={12} />
        </Link>
      }
    >
      {recent.isPending && <Skeleton lines={5} />}
      {recent.data?.length === 0 && (
        <EmptyState icon={<RobotIcon size={18} />} title="Quiet so far" />
      )}
      <div {...stylex.props(styles.latest)}>
        {foldRuns(recent.data ?? []).map(({ activity, earlier }) => (
          <ActivityLine
            key={activity.id}
            activity={activity}
            earlier={earlier}
            compact
          />
        ))}
      </div>
    </Section>
  );
}

const styles = stylex.create({
  scroll: { flexGrow: 1, overflowY: "auto" },
  page: {
    maxWidth: 1120,
    marginInline: "auto",
    paddingInline: { default: space.x4, "@media (max-width: 640px)": space.lg },
    paddingTop: { default: space.x5, "@media (max-width: 640px)": space.x3 },
    paddingBottom: 96,
  },
  hero: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    marginBottom: space.x4,
  },
  date: { fontSize: text.label, color: color.fgMuted },
  greeting: {
    fontSize: 28,
    lineHeight: "34px",
    fontWeight: 600,
    letterSpacing: "-0.02em",
    color: color.fg,
  },
  askWrap: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    marginTop: space.lg,
    maxWidth: 680,
  },
  ask: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    height: 48,
    paddingInlineStart: space.lg,
    paddingInlineEnd: space.sm,
    borderRadius: radius.lg,
    backgroundColor: color.raised,
    boxShadow: {
      default: shadow.card,
      ":focus-within": `0 0 0 1px ${color.accent}, 0 0 0 4px ${color.accentSubtle}`,
    },
    transitionProperty: "box-shadow",
    transitionDuration: motion.fast,
  },
  askIcon: { color: color.accentFg, flexShrink: 0 },
  askInput: {
    flexGrow: 1,
    height: "100%",
    borderWidth: 0,
    backgroundColor: "transparent",
    fontSize: { default: text.copy, "@media (max-width: 640px)": 16 },
    outline: "none",
    "::placeholder": { color: color.fgFaint },
  },
  askSend: {
    display: "grid",
    placeItems: "center",
    width: 32,
    height: 32,
    borderRadius: radius.md,
    color: color.fgOnSolid,
    backgroundColor: { default: color.accent, ":disabled": color.uiActive },
    cursor: { default: "pointer", ":disabled": "default" },
  },
  suggestions: { display: "flex", flexWrap: "wrap", gap: space.sm },
  suggestion: {
    height: 28,
    paddingInline: space.md,
    borderRadius: radius.full,
    fontSize: text.meta,
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.ui },
    },
    boxShadow: `inset 0 0 0 1px ${color.line}`,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr) 320px",
      "@media (max-width: 1100px)": "minmax(0, 1fr)",
    },
    gap: space.x4,
    alignItems: "start",
  },
  main: {
    display: "flex",
    flexDirection: "column",
    gap: space.x4,
    minWidth: 0,
  },
  side: {
    display: "flex",
    flexDirection: "column",
    gap: space.x4,
    minWidth: 0,
  },
  count: {
    minWidth: 18,
    height: 18,
    paddingInline: 5,
    display: "inline-grid",
    placeItems: "center",
    borderRadius: radius.full,
    fontSize: 11,
    fontWeight: 600,
    color: color.fgOnSolid,
    backgroundColor: color.accent,
  },
  more: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    fontSize: text.meta,
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
  },
  calm: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    paddingBlock: space.lg,
    paddingInline: space.lg,
    borderRadius: radius.md,
    fontSize: text.label,
    color: color.greenFg,
    backgroundColor: color.greenSubtle,
  },
  panel: {
    display: "flex",
    flexDirection: "column",
    borderRadius: radius.md,
    backgroundColor: color.raised,
    boxShadow: shadow.card,
    overflow: "hidden",
  },
  needRow: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: { default: color.line, ":first-child": "transparent" },
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.surface },
    },
  },
  needIcon: {
    display: "grid",
    placeItems: "center",
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    color: color.fgMuted,
    backgroundColor: color.ui,
  },
  needTitle: {
    fontSize: text.label,
    fontWeight: 500,
    color: color.fg,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  needMeta: { fontSize: text.meta },
  time: {
    fontSize: text.meta,
    color: color.fgFaint,
    fontVariantNumeric: "tabular-nums",
    flexShrink: 0,
  },
  cardRow: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    height: 40,
    paddingInline: space.lg,
    fontSize: text.label,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.surface },
    },
  },
  cardNumber: {
    fontFamily: font.mono,
    fontSize: 11.5,
    color: color.fgFaint,
    width: 28,
    flexShrink: 0,
  },
  gold: { color: color.goldFg, flexShrink: 0 },
  cardTitle: {
    flexGrow: 1,
    minWidth: 0,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  cardWhere: {
    display: { default: null, "@media (max-width: 640px)": "none" },
    fontSize: text.meta,
    color: color.fgMuted,
    whiteSpace: "nowrap",
  },
  agentRow: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    paddingBlock: space.md,
    paddingInline: space.lg,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.surface },
    },
  },
  agentName: { fontSize: text.label, fontWeight: 600 },
  agentLast: {
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgMuted,
    marginTop: 2,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  brief: {
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.raised,
    boxShadow: {
      default: shadow.card,
      ":hover": { default: null, [media.hover]: shadow.float },
    },
    transitionProperty: "box-shadow",
    transitionDuration: motion.fast,
  },
  briefKicker: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    fontSize: text.caption,
    fontWeight: 500,
    color: color.fgFaint,
  },
  briefTitle: { fontSize: text.label, fontWeight: 600, color: color.fg },
  summary: {
    marginTop: space.xs,
    maxWidth: 680,
    fontSize: text.titleSm,
    lineHeight: leading.titleSm,
    color: color.fgMuted,
    textWrap: "pretty",
  },
  summaryLink: {
    fontWeight: 500,
    color: color.fg,
    textDecoration: "underline",
    textDecorationColor: color.lineStrong,
    textUnderlineOffset: 3,
  },
  briefBody: {
    display: "-webkit-box",
    WebkitLineClamp: 4,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgMuted,
  },
  team: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
    gap: space.md,
  },
  person: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.raised,
    boxShadow: {
      default: shadow.card,
      ":hover": { default: null, [media.hover]: shadow.float },
    },
    transitionProperty: "box-shadow",
    transitionDuration: motion.fast,
    height: "100%",
  },
  personName: { fontSize: text.label, fontWeight: 600 },
  personTitle: { fontSize: text.meta, color: color.fgMuted },
  personNow: {
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fg,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  nowLabel: { color: color.fgFaint, fontWeight: 500, marginInlineEnd: 2 },
  latest: { display: "flex", flexDirection: "column" },
});

const toneText = stylex.create({
  neutral: { color: color.fgMuted },
  accent: { color: color.accentFg },
  gold: { color: color.goldFg },
  green: { color: color.greenFg },
  amber: { color: color.amberFg },
  red: { color: color.redFg },
  violet: { color: color.violetFg },
  blue: { color: color.blueFg },
});
