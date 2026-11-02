import {
  ChatCircleIcon,
  ChatCircleTextIcon,
  ClockIcon,
  TicketIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { toast } from "sonner";

import { api, unwrap } from "#api/client";
import type { Schemas } from "#api/client";
import { q } from "#api/queries";
import { Feed } from "#features/activity/feed";
import { useMe } from "#features/auth/session";
import { providerName, roleOf, useMembers } from "#features/cards/card-bits";
import { ago, agoPhrase } from "#lib/time";
import { Avatar } from "#ui/avatar";
import { Button } from "#ui/button";
import { Badge } from "#ui/chip";
import { ErrorNote, Skeleton } from "#ui/feedback";
import { Page, PageHeader, Section, layout } from "#ui/layout";
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

import { AgentRun, isStale, ownerWord } from "./agent-run";
import { AgentSessions, sessionsOf } from "./sessions";

type Member = Schemas["Member"];

function localTime(zone: string | null) {
  if (!zone) {
    return null;
  }
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeStyle: "short",
      timeZone: zone,
    }).format(new Date());
  } catch {
    return null;
  }
}

export function PeopleList() {
  const { list } = useMembers();
  const humans = list.filter((m) => m.kind === "human");
  const agents = list.filter((m) => m.kind === "agent");
  return (
    <>
      <PageHeader
        title="People"
        icon={<UsersIcon size={16} />}
        subtitle={`${count(humans.length, "person", "people")} · ${count(agents.length, "agent", "agents")}`}
      />
      <Page>
        <div {...stylex.props(layout.stack, styles.sections)}>
          <Section title="People">
            <PeopleGrid members={humans} />
          </Section>
          <Section title="Agents">
            <p {...stylex.props(layout.meta)}>
              Agents work on behalf of a person, who stays accountable for them.
              Each one reports what it’s doing and asks when it needs a
              decision.
            </p>
            <PeopleGrid members={agents} />
          </Section>
        </div>
      </Page>
    </>
  );
}

function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function PeopleGrid({ members }: { members: Member[] }) {
  const team = useQuery(q.teamNow(3));
  const byMember = new Map(team.data?.map((row) => [row.memberId, row]));
  const { byId } = useMembers();
  const me = useMe();
  return (
    <ul {...stylex.props(styles.grid)}>
      {members.map((m) => {
        const snap = byMember.get(m.id);
        const current = snap?.current ?? undefined;
        const owner = m.ownerId ? byId.get(m.ownerId) : undefined;
        const time = localTime(m.timezone);
        return (
          <li key={m.id}>
            <Link
              to="/people/$handle"
              params={{ handle: m.handle }}
              {...stylex.props(styles.card)}
            >
              <div {...stylex.props(layout.row)}>
                <Avatar person={m} size={36} />
                <div {...stylex.props(layout.grow)}>
                  <p {...stylex.props(styles.name)}>{m.name}</p>
                  <p {...stylex.props(styles.sub)}>
                    {roleOf(m)}
                    {owner ? ` · for ${owner.name.split(" ")[0]}` : ""}
                  </p>
                </div>
              </div>
              {team.isPending ? (
                <Skeleton lines={1} height={12} />
              ) : (
                <p {...stylex.props(styles.now)}>
                  {snap?.agent ? (
                    <AgentRun
                      run={snap.agent}
                      owner={ownerWord(owner, me?.member.id)}
                    />
                  ) : (
                    <NowLine
                      current={current}
                      recent={snap?.latest ?? undefined}
                    />
                  )}
                </p>
              )}
              <div {...stylex.props(styles.foot)}>
                <span>@{m.handle}</span>
                {time && (
                  <span {...stylex.props(layout.rowTight)}>
                    <ClockIcon size={11} /> {time}
                  </span>
                )}
                {snap?.lastActiveAt && (
                  <span>active {ago(snap.lastActiveAt)}</span>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function Person({ handle }: { handle: string }) {
  const member = useQuery(q.member(handle));
  const snap = useQuery(q.now(handle, 7));
  const inSessions = useSessionSteps(handle);
  const me = useMe();
  const navigate = useNavigate();
  const ask = useMutation({
    mutationFn: async () =>
      await unwrap(api.POST("/v1/conversations", { body: { to: handle } })),
    onSuccess: (reply) => {
      void navigate({
        to: "/assistant/$conversationId",
        params: { conversationId: reply.conversation.id },
      });
    },
    onError: (error) => toast.error(error.message),
  });

  if (member.isPending) {
    return (
      <Page>
        <Skeleton lines={6} />
      </Page>
    );
  }
  if (member.isError) {
    return (
      <Page>
        <ErrorNote error={member.error} />
      </Page>
    );
  }
  const m = member.data;
  const self = me?.member.id === m.id;

  return (
    <>
      <PageHeader
        title={m.name}
        icon={<Avatar person={m} size={20} />}
        subtitle={m.title ?? undefined}
        actions={
          m.kind === "human" && (
            <Button
              size="sm"
              variant={self ? "secondary" : "primary"}
              icon={<ChatCircleTextIcon size={14} />}
              busy={ask.isPending}
              onClick={() => {
                if (self) {
                  void navigate({ to: "/assistant" });
                } else {
                  ask.mutate();
                }
              }}
            >
              {self
                ? "Your assistant"
                : `Ask ${m.name.split(" ")[0]}'s assistant`}
            </Button>
          )
        }
      />
      <div {...stylex.props(styles.personSplit)}>
        <aside {...stylex.props(styles.profile)}>
          <Avatar person={m} size={64} />
          <div>
            <h2 {...stylex.props(styles.profileName)}>{m.name}</h2>
            <p {...stylex.props(styles.sub)}>@{m.handle}</p>
          </div>
          <PersonFacts member={m} lastActiveAt={snap.data?.lastActiveAt} />
          {m.kind === "human" && !self && (
            <p {...stylex.props(styles.askNote)}>
              <ChatCircleIcon size={13} /> Their assistant answers from{" "}
              {m.name.split(" ")[0]}’s team-visible work only. Private notes
              stay private.
            </p>
          )}
        </aside>
        <div {...stylex.props(styles.personMain)}>
          <div {...stylex.props(styles.nowBlock)}>
            <NowList
              title="Working on"
              empty="Nothing in progress."
              items={snap.data?.inProgress.map((c) => ({
                key: c.number,
                number: c.number,
                title: c.title,
                meta: c.column ?? undefined,
                golden: c.golden,
              }))}
            />
            <NowList
              title="Up next"
              empty="Nothing queued."
              items={snap.data?.upNext.map((c) => ({
                key: c.number,
                number: c.number,
                title: c.title,
              }))}
            />
          </div>
          {m.kind === "agent" && <AgentSessions handle={handle} />}
          {/* An agent's sessions already show each thread's latest step; the log below holds the
              rest, and goes when there is no rest. */}
          {(m.kind === "human" || inSessions.hasMore) && (
            <>
              <h3 {...stylex.props(styles.feedTitle)}>
                {m.kind === "agent" ? "Earlier steps" : "Activity"}
              </h3>
              <div {...stylex.props(styles.feedWrap)}>
                <Feed
                  filter={{ actor: handle }}
                  hideActor
                  skip={m.kind === "agent" ? inSessions.has : undefined}
                  emptyText={`Nothing from ${m.name} yet.`}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** Which of an agent's events its sessions already show, and whether anything is left over. */
function useSessionSteps(handle: string) {
  // The same query AgentSessions reads, so this costs no extra request.
  const recent = useQuery(q.recentActivities({ actor: handle, limit: 60 }));
  return useMemo(() => {
    const all = recent.data ?? [];
    const shown = new Set(sessionsOf(all).map((s) => s.latest.id));
    return {
      has: (activity: { id: string }) => shown.has(activity.id),
      hasMore: all.some((a) => !shown.has(a.id)),
    };
  }, [recent.data]);
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div {...stylex.props(styles.fact)}>
      <dt {...stylex.props(styles.factLabel)}>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function NowLine({
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
  return <span {...stylex.props(layout.faint)}>Nothing recent</span>;
}

function PersonFacts({
  member: m,
  lastActiveAt,
}: {
  member: Member;
  lastActiveAt?: string | null;
}) {
  const { byId } = useMembers();
  const me = useMe();
  const owner = m.ownerId ? byId.get(m.ownerId) : undefined;
  const time = localTime(m.timezone);
  // An agent mid-run or waiting on someone says so first, as on Home and its card; a finished
  // run is already in Sessions.
  const { data: run } = useQuery({
    ...q.teamNow(3),
    select: (rows) => {
      const agent = rows.find((row) => row.memberId === m.id)?.agent;
      return agent &&
        (agent.state === "needs_you" ||
          (agent.state === "working" && !isStale(agent)))
        ? agent
        : null;
    },
  });
  return (
    <dl {...stylex.props(styles.facts)}>
      {run && (
        <Fact label="Right now">
          <AgentRun run={run} owner={ownerWord(owner, me?.member.id)} />
        </Fact>
      )}
      <Fact label="Role">{roleOf(m)}</Fact>
      {m.kind === "agent" && (
        <Fact label="Works for">
          {owner ? (
            <Link
              to="/people/$handle"
              params={{ handle: owner.handle }}
              {...stylex.props(styles.link)}
            >
              {owner.name}
            </Link>
          ) : (
            "The team"
          )}
        </Fact>
      )}
      {m.agentProvider && (
        <Fact label="Runs on">{providerName(m.agentProvider)}</Fact>
      )}
      {time && (
        <Fact label="Local time">
          {time} · {m.timezone}
        </Fact>
      )}
      {lastActiveAt && (
        <Fact label="Last active">{agoPhrase(lastActiveAt)}</Fact>
      )}
      <Fact label="Member since">
        {new Date(m.createdAt).toLocaleDateString("en-GB", {
          month: "long",
          year: "numeric",
        })}
      </Fact>
    </dl>
  );
}

function NowList({
  title,
  items,
  empty,
}: {
  title: string;
  empty: string;
  items?: {
    key: number;
    number: number;
    title: string;
    meta?: string;
    golden?: boolean;
  }[];
}) {
  return (
    <section {...stylex.props(styles.nowList)}>
      <h3 {...stylex.props(styles.nowTitle)}>{title}</h3>
      {items === undefined && <Skeleton lines={2} />}
      {items?.length === 0 && <p {...stylex.props(layout.meta)}>{empty}</p>}
      <ul>
        {items?.map((item) => (
          <li key={item.key}>
            <Link
              to="."
              search={(prev: Record<string, unknown>) => ({
                ...prev,
                card: item.number,
              })}
              {...stylex.props(styles.nowRow)}
            >
              <span {...stylex.props(styles.number)}>#{item.number}</span>
              {item.golden === true && (
                <TicketIcon size={12} {...stylex.props(styles.gold)} />
              )}
              <span {...stylex.props(layout.truncate, layout.grow)}>
                {item.title}
              </span>
              {item.meta && <Badge>{item.meta}</Badge>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
const styles = stylex.create({
  sections: { gap: space.x4 },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: space.md,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    height: "100%",
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
  name: { fontSize: text.label, fontWeight: 600, color: color.fg },
  sub: { fontSize: text.meta, color: color.fgMuted },
  now: {
    flexGrow: 1,
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fg,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  nowLabel: { color: color.fgFaint, fontWeight: 500 },
  foot: {
    display: "flex",
    flexWrap: "wrap",
    gap: space.md,
    fontSize: 11.5,
    color: color.fgFaint,
  },
  personSplit: {
    flexGrow: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: {
      default: "300px minmax(0, 1fr)",
      "@media (max-width: 860px)": "minmax(0, 1fr)",
    },
    overflowY: { default: null, "@media (max-width: 860px)": "auto" },
  },
  profile: {
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
    padding: space.x3,
    overflowY: { default: "auto", "@media (max-width: 860px)": "visible" },
    borderRightWidth: { default: 1, "@media (max-width: 860px)": 0 },
    borderBottomWidth: { default: 0, "@media (max-width: 860px)": 1 },
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderStyle: "solid",
    borderColor: color.line,
  },
  profileName: {
    fontSize: text.title,
    lineHeight: leading.title,
    fontWeight: 600,
  },
  facts: { display: "flex", flexDirection: "column", gap: space.md },
  fact: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    fontSize: text.label,
  },
  factLabel: { fontSize: text.caption, fontWeight: 500, color: color.fgFaint },
  link: {
    color: color.accentFg,
    textDecoration: {
      default: "none",
      ":hover": { default: null, [media.hover]: "underline" },
    },
  },
  askNote: {
    display: "flex",
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgMuted,
    backgroundColor: color.surface,
  },
  personMain: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    minWidth: 0,
  },
  nowBlock: {
    display: "grid",
    gridTemplateColumns: {
      default: "1fr 1fr",
      "@media (max-width: 640px)": "1fr",
    },
    gap: space.xl,
    paddingInline: space.x3,
    paddingTop: space.x3,
    paddingBottom: space.lg,
    flexShrink: 0,
  },
  nowList: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    minWidth: 0,
  },
  nowTitle: { fontSize: text.caption, fontWeight: 500, color: color.fgFaint },
  nowRow: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    height: 32,
    paddingInline: space.sm,
    marginInline: -6,
    borderRadius: radius.sm,
    fontSize: text.label,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.ui },
    },
  },
  number: {
    fontFamily: font.mono,
    fontSize: 11.5,
    color: color.fgFaint,
    flexShrink: 0,
  },
  gold: { color: color.goldFg, flexShrink: 0 },
  feedTitle: {
    paddingInline: space.x3,
    fontSize: text.caption,
    fontWeight: 500,
    color: color.fgFaint,
  },
  feedWrap: {
    flexGrow: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
});
