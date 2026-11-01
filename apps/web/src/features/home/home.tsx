import {
  ArrowRightIcon,
  ArrowUpIcon,
  CheckIcon,
  TicketIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { q } from "#api/queries";
import { useMe } from "#features/auth/session";
import { stageLabel, useMembers } from "#features/cards/card-bits";
import { kindOf } from "#features/inbox/inbox";
import { ago, greeting } from "#lib/time";
import { Avatar } from "#ui/avatar";
import { Badge, Dot } from "#ui/chip";
import { Skeleton } from "#ui/feedback";
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
          <Ask meId={me.member.id} />
        </header>
        <SetupChecklist meId={me.member.id} />
        <NeedsYou />
        <MyCards />
        <TeamNow selfId={me.member.id} />
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
    return <Skeleton lines={2} height={20} />;
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

function Ask({ meId }: { meId: string }) {
  const [value, setValue] = useState("");
  const navigate = useNavigate();
  const { list } = useMembers();
  const assistant = list.find(
    (m) => m.agentProvider === "worklog" && m.ownerId === meId
  );
  const question = value.trim();
  const ask = () => {
    if (question) {
      void navigate({ to: "/assistant", search: { ask: question } });
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        ask();
      }}
      {...stylex.props(styles.ask)}
    >
      <textarea
        rows={1}
        aria-label="Ask your assistant"
        placeholder="Ask about the team’s work…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            ask();
          }
        }}
        {...stylex.props(styles.askInput)}
      />
      <div {...stylex.props(styles.askFoot)}>
        {assistant && (
          <span {...stylex.props(styles.askWho)}>
            <Avatar person={assistant} size={16} />
            Your assistant answers from the team’s activity
          </span>
        )}
        <button
          type="submit"
          aria-label="Ask"
          disabled={!question}
          {...stylex.props(styles.askSend)}
        >
          <ArrowUpIcon size={14} weight="bold" />
        </button>
      </div>
    </form>
  );
}

function NeedsYou() {
  const items = useQuery(q.attention("open"));
  const { byId } = useMembers();
  const list = items.data ?? [];
  return (
    <Section
      // The inbox badge carries the count; a second number here would make it louder, not clearer.
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
      <ul {...stylex.props(styles.list)}>
        {people.map((person, i) => {
          const snap = snapshots[i]?.data;
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
                      current={snap?.inProgress[0]}
                      recent={snap?.recent[0]}
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
      </ul>
    </Section>
  );
}

const styles = stylex.create({
  scroll: { flexGrow: 1, overflowY: "auto" },
  // One column, as on Things' Today: the page reads top to bottom in the order it matters.
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
    textWrap: "balance",
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
  ask: {
    display: "flex",
    flexDirection: "column",
    marginTop: space.x3,
    borderRadius: 14,
    backgroundColor: color.raised,
    boxShadow: {
      default: shadow.card,
      ":focus-within": shadow.float,
    },
    cursor: "text",
    transitionProperty: "box-shadow",
    transitionDuration: motion.fast,
  },
  askInput: {
    minHeight: 48,
    maxHeight: 200,
    paddingTop: space.lg,
    paddingBottom: space.xs,
    paddingInline: space.xl,
    borderWidth: 0,
    backgroundColor: "transparent",
    resize: "none",
    fontSize: { default: text.copy, "@media (max-width: 640px)": 16 },
    lineHeight: leading.copy,
    color: color.fg,
    outline: "none",
    fieldSizing: "content",
    "::placeholder": { color: color.fgFaint },
  },
  askFoot: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    paddingBottom: space.sm,
    paddingInlineStart: space.xl,
    paddingInlineEnd: space.sm,
  },
  askWho: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    flexGrow: 1,
    minWidth: 0,
    fontSize: text.meta,
    color: color.fgFaint,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  askSend: {
    display: "grid",
    placeItems: "center",
    width: 28,
    height: 28,
    flexShrink: 0,
    borderRadius: radius.full,
    color: { default: color.fgOnSolid, ":disabled": color.fgFaint },
    backgroundColor: {
      default: color.accent,
      ":hover": { default: null, [media.hover]: color.accentHover },
      ":disabled": color.ui,
    },
    cursor: { default: "pointer", ":disabled": "default" },
    transitionProperty: "background-color, color",
    transitionDuration: motion.fast,
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
    gap: space.sm,
    fontSize: text.label,
    color: color.fgMuted,
  },
  // Rows sit on the page rather than in a box; the hover fill bleeds past the text so titles
  // line up with the section heading above them.
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
    // A phone fits a few words per line; cutting there hides what the row is about.
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
