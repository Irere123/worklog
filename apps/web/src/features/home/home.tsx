import { ArrowRightIcon, CheckIcon, TicketIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { q } from "#api/queries";
import { Composer } from "#features/assistant/composer";
import { useMe } from "#features/auth/session";
import { stageLabel, useMembers } from "#features/cards/card-bits";
import { kindOf } from "#features/inbox/kinds";
import { AgentRun, ownerWord, runFace } from "#features/people/agent-run";
import { ago, greeting, startOfYesterday } from "#lib/time";
import { Avatar } from "#ui/avatar";
import { Badge, Dot } from "#ui/chip";
import { ErrorNote, Skeleton } from "#ui/feedback";
import { Section, layout } from "#ui/layout";
import {
  color,
  font,
  leading,
  media,
  radius,
  space,
  text,
} from "#ui/tokens.stylex";

import { SetupChecklist, useSetupSettled } from "./setup";

export function Home() {
  const me = useMe();
  const settled = useSetupSettled();
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
          <Ask meId={me.member.id} />
        </header>
        {settled ? (
          <>
            <SetupChecklist meId={me.member.id} />
            <NeedsYou />
            <YourCards />
            <TeamNow selfId={me.member.id} />
          </>
        ) : (
          <Skeleton lines={4} height={44} />
        )}
      </div>
    </div>
  );
}

function DaySummary() {
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
  const counted = useQuery(q.activityCounts(since));
  const { byId } = useMembers();
  if (!waiting.isSuccess || !counted.isSuccess) {
    return <Skeleton lines={2} height={20} />;
  }
  const open = waiting.data;
  const decision = open.find((i) => i.kind === "agent.needs_you");
  const asker = decision?.fromId ? byId.get(decision.fromId) : undefined;
  const count = (re: RegExp) =>
    counted.data
      .filter((row) => re.test(row.kind))
      .reduce((sum, row) => sum + row.count, 0);
  const done = [
    plural(count(/^card\.closed$/u), "card closed", "cards closed"),
    plural(count(/merged/u), "pull request merged", "pull requests merged"),
    plural(count(/^card\.created$/u), "card added", "cards added"),
  ].filter((part) => part !== null);

  return (
    <p {...stylex.props(styles.summary)}>
      <span {...stylex.props(styles.summaryNow)}>
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
        )}
      </span>
      <span {...stylex.props(styles.summaryLine)}>
        {done.length > 0
          ? `Since yesterday, ${listOf(done)}.`
          : "It’s been quiet since yesterday."}
      </span>
    </p>
  );
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

function Ask({ meId }: { meId: string }) {
  const navigate = useNavigate();
  const router = useRouter();
  const box = useRef<HTMLTextAreaElement>(null);
  useHotkey("/", () => box.current?.focus(), {
    meta: { name: "Write to the assistant", group: "Assistant" },
  });
  const { list } = useMembers();
  const assistant = list.find(
    (m) => m.agentProvider === "worklog" && m.ownerId === meId
  );
  return (
    <div {...stylex.props(styles.ask)}>
      <Composer
        autoFocus={false}
        inputRef={box}
        label="Ask your assistant"
        placeholder="Ask about the team’s work…"
        context={
          assistant && (
            <>
              <Avatar person={assistant} size={16} />
              Your assistant answers from the team’s activity
            </>
          )
        }
        onSend={(question) => {
          void navigate({ to: "/assistant", search: { ask: question } });
        }}
        onStartTyping={() => {
          void router.preloadRoute({ to: "/assistant" });
        }}
      />
    </div>
  );
}

function NeedsYou() {
  const items = useQuery(q.attention("open"));
  const { byId } = useMembers();
  const list = items.data ?? [];
  return (
    <Section
      title="Needs you"
      aside={
        <Link to="/inbox" {...stylex.props(styles.more)}>
          Inbox <ArrowRightIcon size={12} />
        </Link>
      }
    >
      {items.isPending && <Skeleton lines={3} height={44} />}
      {items.isSuccess && list.length === 0 && (
        <p {...stylex.props(styles.calm)}>
          <CheckIcon size={14} />
          Nothing is waiting on you. Worklog will tell you when something is.
        </p>
      )}
      <ul {...stylex.props(styles.list)}>
        {list.slice(0, 4).map((item) => {
          const from = item.fromId ? byId.get(item.fromId) : undefined;
          const kind = kindOf(item.kind);
          return (
            <li key={item.id}>
              <Link
                to="/inbox"
                search={{ item: item.id }}
                {...stylex.props(styles.row)}
              >
                {from ? (
                  <Avatar person={from} size={24} />
                ) : (
                  <span {...stylex.props(styles.glyph)}>{kind.icon}</span>
                )}
                <div {...stylex.props(layout.grow)}>
                  <p {...stylex.props(styles.title)}>{item.title}</p>
                  <p {...stylex.props(styles.meta)}>{kind.label}</p>
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

function YourCards() {
  const lists = useQueries({
    queries: [
      q.cards({ assignee: "me", stage: "active" }),
      q.cards({ assignee: "me", stage: "triage" }),
    ],
    combine: (results) => ({
      cards: results.flatMap((r) => r.data ?? []),
      pending: results.some((r) => r.isPending),
      error: results.find((r) => r.isError)?.error ?? null,
      retry: () => {
        for (const r of results) {
          void r.refetch();
        }
      },
    }),
  });
  const boards = useQuery(q.boards());
  const boardName = (id: string) =>
    boards.data?.find((b) => b.id === id)?.name ?? "";
  const { cards } = lists;
  return (
    <Section title="Your cards">
      {lists.pending && <Skeleton lines={3} height={36} />}
      {lists.error && <ErrorNote error={lists.error} retry={lists.retry} />}
      {!lists.pending && !lists.error && cards.length === 0 && (
        <p {...stylex.props(layout.meta)}>
          Nothing assigned to you. Press C to add a card, or M on any card to
          take it.
        </p>
      )}
      {!lists.pending && cards.length > 0 && (
        <ul {...stylex.props(styles.list)}>
          {cards.map((card) => (
            <li key={card.id}>
              <Link
                to="/boards/$boardId"
                params={{ boardId: card.boardId }}
                search={{ card: card.number }}
                {...stylex.props(styles.row)}
              >
                <span {...stylex.props(styles.number)}>#{card.number}</span>
                <div {...stylex.props(layout.grow)}>
                  <p {...stylex.props(styles.title)}>
                    {card.golden && (
                      <TicketIcon size={13} {...stylex.props(styles.gold)} />
                    )}
                    {card.title}
                  </p>
                  <p {...stylex.props(styles.meta)}>
                    {boardName(card.boardId)} ·{" "}
                    {card.columnName ?? stageLabel(card.stage)}
                  </p>
                </div>
                {card.entropy?.postponingSoon === true && (
                  <Badge tone="amber" status="waiting">
                    Drifting
                  </Badge>
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

function TeamNow({ selfId }: { selfId: string }) {
  const { list, byId } = useMembers();
  const people = list.filter((m) => m.kind === "human" && m.id !== selfId);
  const team = useQuery(q.teamNow(3));
  const byMember = new Map(team.data?.map((row) => [row.memberId, row]));
  const agents = list.filter((m) => {
    const state = byMember.get(m.id)?.agent?.state;
    return m.kind === "agent" && (state === "working" || state === "needs_you");
  });
  if (people.length + agents.length === 0) {
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
      <ul {...stylex.props(styles.list)}>
        {people.map((person) => {
          const snap = byMember.get(person.id);
          return (
            <li key={person.id}>
              <Link
                to="/people/$handle"
                params={{ handle: person.handle }}
                {...stylex.props(styles.row)}
              >
                <Avatar person={person} size={24} />
                <div {...stylex.props(layout.grow)}>
                  <p {...stylex.props(styles.title)}>{person.name}</p>
                  <p {...stylex.props(styles.meta)}>
                    <TeammateNow
                      current={snap?.current ?? undefined}
                      recent={snap?.latest ?? undefined}
                    />
                  </p>
                </div>
                {snap?.lastActiveAt && (
                  <span {...stylex.props(styles.time)}>
                    {ago(snap.lastActiveAt)}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
        {agents.map((agent) => {
          const run = byMember.get(agent.id)?.agent;
          const owner = agent.ownerId ? byId.get(agent.ownerId) : undefined;
          return (
            <li key={agent.id}>
              <Link
                to="/people/$handle"
                params={{ handle: agent.handle }}
                {...stylex.props(styles.row)}
              >
                <Avatar person={agent} size={24} {...runFace(run)} />
                <div {...stylex.props(layout.grow)}>
                  <p {...stylex.props(styles.title)}>{agent.name}</p>
                  <p {...stylex.props(styles.meta)}>
                    {run && (
                      <AgentRun run={run} owner={ownerWord(owner, selfId)} />
                    )}
                  </p>
                </div>
                {run && (
                  <span {...stylex.props(styles.time)}>{ago(run.at)}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

const styles = stylex.create({
  scroll: { flexGrow: 1, overflowY: "auto" },
  page: {
    display: "flex",
    flexDirection: "column",
    gap: { default: space.x5, "@media (max-width: 640px)": space.x4 },
    maxWidth: 720,
    marginInline: "auto",
    paddingInline: { default: space.x4, "@media (max-width: 640px)": space.lg },
    paddingTop: { default: 72, "@media (max-width: 640px)": space.x3 },
    paddingBottom: 96,
  },
  hero: { display: "flex", flexDirection: "column" },
  date: {
    fontSize: text.label,
    fontWeight: 500,
    color: color.fgFaint,
  },
  greeting: {
    marginTop: space.xs,
    fontSize: 30,
    lineHeight: "36px",
    fontWeight: 600,
    letterSpacing: "-0.025em",
    color: color.fg,
  },
  summary: {
    display: "flex",
    flexDirection: "column",
    marginTop: space.md,
    fontSize: text.titleSm,
    lineHeight: leading.titleSm,
    textWrap: "pretty",
  },
  summaryNow: { color: color.fg },
  summaryLine: { color: color.fgMuted },
  summaryLink: {
    fontWeight: 500,
    textDecoration: "underline",
    textDecorationColor: {
      default: color.lineStrong,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    textDecorationThickness: 1,
    textUnderlineOffset: 3,
  },
  ask: { marginTop: space.x3 },
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
    gap: space.sm,
    fontSize: text.label,
    color: color.fgMuted,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    marginInline: `calc(-1 * ${space.md})`,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: space.lg,
    minHeight: 52,
    paddingBlock: space.sm,
    paddingInline: space.md,
    borderRadius: radius.md,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.uiHover },
    },
  },
  glyph: {
    display: "grid",
    placeItems: "center",
    width: 24,
    height: 24,
    flexShrink: 0,
    borderRadius: radius.sm,
    color: color.fgMuted,
    backgroundColor: color.ui,
  },
  number: {
    width: 24,
    flexShrink: 0,
    fontFamily: font.mono,
    fontSize: 11.5,
    color: color.fgFaint,
  },
  title: {
    fontSize: text.label,
    fontWeight: 500,
    color: color.fg,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: { default: "nowrap", "@media (max-width: 640px)": "normal" },
  },
  meta: {
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgMuted,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  gold: {
    display: "inline",
    verticalAlign: -2,
    marginInlineEnd: space.xs,
    color: color.goldFg,
  },
  time: {
    fontSize: text.meta,
    color: color.fgFaint,
    fontVariantNumeric: "tabular-nums",
    flexShrink: 0,
  },
  nowLabel: { color: color.fgFaint, fontWeight: 500, marginInlineEnd: 2 },
});
