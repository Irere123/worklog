import {
  ChatCircleIcon,
  ChatCircleTextIcon,
  TicketIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { toast } from "sonner";

import { ApiError, api, unwrap } from "#api/client";
import type { Schemas } from "#api/client";
import { q } from "#api/queries";
import { Feed } from "#features/activity/feed";
import { useMe } from "#features/auth/session";
import { providerName, roleOf, useMembers } from "#features/cards/card-bits";
import { NotFound } from "#features/shell/fallbacks";
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
  space,
  text,
} from "#ui/tokens.stylex";

import { AgentRun, isStale, ownerWord, runFace } from "./agent-run";
import { clockOf, useMinute } from "./presence";
import type { Clock } from "./presence";
import { RhythmCalendar, RhythmStrip } from "./rhythm";
import { AgentSessions, sessionsOf } from "./sessions";

type Member = Schemas["Member"];
type Snap = Schemas["TeamNow"][number];

// The window "Last" and "active" lines look back over; the rhythm always covers two weeks.
const RECENT_DAYS = 3;

/** Personal assistants answer for their person and have no work of their own to list. */
function isAssistant(m: Member) {
  return m.agentProvider === "worklog";
}

export function PeopleList() {
  const { list, byId } = useMembers();
  const team = useQuery(q.teamNow(RECENT_DAYS));
  const now = useMinute();
  const snaps = useMemo(
    () => new Map(team.data?.map((row) => [row.memberId, row])),
    [team.data]
  );
  const humans = list.filter((m) => m.kind === "human");
  const agents = list.filter((m) => m.kind === "agent" && !isAssistant(m));
  const teamAgents = agents.filter((a) => !a.ownerId || !byId.has(a.ownerId));
  const scale = Math.max(1, ...(team.data?.flatMap((r) => r.rhythm) ?? []));
  const clocks = new Map(humans.map((m) => [m.id, clockOf(m, now)]));
  const knowHours = [...clocks.values()].some((c) => c?.inHours !== null);
  const inHours = [...clocks.values()].filter((c) => c?.inHours === true);
  const row = (m: Member) => (
    <PersonRow
      key={m.id}
      member={m}
      snap={snaps.get(m.id)}
      pending={team.isPending}
      clock={clocks.get(m.id) ?? clockOf(m, now)}
      today={todayOf(m, now)}
      scale={scale}
      agents={agents.filter((a) => a.ownerId === m.id)}
      snaps={snaps}
    />
  );
  return (
    <>
      <PageHeader
        title="People"
        subtitle={[
          count(humans.length, "person", "people"),
          knowHours && `${inHours.length} in working hours`,
          agents.length > 0 && count(agents.length, "agent", "agents"),
        ]
          .filter(Boolean)
          .join(" · ")}
      />
      <Page>
        <div {...stylex.props(layout.stack, styles.sections)}>
          <div>
            <ColumnHeads />
            <ul {...stylex.props(styles.roster)}>{humans.map(row)}</ul>
            {humans.length === 1 && agents.length === 0 && (
              <p {...stylex.props(styles.alone)}>
                Just you so far.{" "}
                <Link to="/settings/members" {...stylex.props(styles.link)}>
                  Invite your teammates
                </Link>{" "}
                and their work shows up here as their tools record it.
              </p>
            )}
          </div>
          {teamAgents.length > 0 && (
            <Section title="Agents for the whole team">
              <ul {...stylex.props(styles.roster)}>{teamAgents.map(row)}</ul>
            </Section>
          )}
        </div>
      </Page>
    </>
  );
}

function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function todayOf(m: Member, now: Date) {
  return clockOf(m, now)?.date ?? localDate(now);
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function localDate(now: Date) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function ColumnHeads() {
  return (
    <div aria-hidden {...stylex.props(styles.grid, styles.heads)}>
      <span {...stylex.props(styles.whoHead)}>Person</span>
      <span {...stylex.props(styles.nowHead)}>On now</span>
      <span {...stylex.props(styles.rhythmCell)}>Two weeks</span>
      <span {...stylex.props(styles.clock)}>Their time</span>
    </div>
  );
}

function PersonRow({
  member: m,
  snap,
  pending,
  clock,
  today,
  scale,
  agents,
  snaps,
  nested = false,
}: {
  member: Member;
  snap: Snap | undefined;
  pending: boolean;
  clock: Clock | null;
  today: string;
  scale: number;
  agents: Member[];
  snaps: Map<string, Snap>;
  nested?: boolean;
}) {
  const now = useMinute();
  const agent = m.kind === "agent";
  return (
    <li {...stylex.props(nested ? styles.nestedItem : styles.item)}>
      <div
        {...stylex.props(styles.grid, styles.row, nested && styles.rowNested)}
      >
        <div {...stylex.props(styles.who, nested && styles.whoNested)}>
          <Avatar
            person={m}
            size={nested ? 24 : 32}
            {...runFace(snap?.agent)}
          />
          <div {...stylex.props(layout.grow)}>
            <Link
              to="/people/$handle"
              params={{ handle: m.handle }}
              {...stylex.props(styles.name, styles.stretch)}
            >
              {m.name}
            </Link>
            <p {...stylex.props(styles.sub, layout.truncate)}>
              {agent && m.agentProvider
                ? `${roleOf(m)} · ${providerName(m.agentProvider)}`
                : roleOf(m)}
            </p>
          </div>
        </div>
        <div {...stylex.props(styles.now, nested && styles.nowNested)}>
          {pending ? (
            <Skeleton lines={1} height={12} />
          ) : (
            <NowCell member={m} snap={snap} />
          )}
        </div>
        <div {...stylex.props(styles.rhythmCell, styles.above, styles.passTap)}>
          <RhythmStrip
            counts={snap?.rhythm ?? []}
            today={today}
            workdays={workdaysOf(m)}
            scale={scale}
            name={firstName(m)}
          />
        </div>
        <div {...stylex.props(styles.clock)}>
          {clock ? <ClockCell clock={clock} /> : null}
        </div>
      </div>
      {agents.length > 0 && (
        <ul>
          {agents.map((a) => (
            <PersonRow
              key={a.id}
              member={a}
              snap={snaps.get(a.id)}
              pending={pending}
              clock={null}
              today={todayOf(a, now)}
              scale={scale}
              agents={[]}
              snaps={snaps}
              nested
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** What they're on, in the order a teammate asks: a run waiting on someone, their card, their last move. */
function NowCell({ member: m, snap }: { member: Member; snap?: Snap }) {
  const { byId } = useMembers();
  const me = useMe();
  const run = snap?.agent;
  if (
    run &&
    (run.state === "needs_you" || (run.state === "working" && !isStale(run)))
  ) {
    const owner = m.ownerId ? byId.get(m.ownerId) : undefined;
    return (
      <p {...stylex.props(styles.nowLine, styles.clamp)}>
        <AgentRun run={run} owner={ownerWord(owner, me?.member.id)} />
      </p>
    );
  }
  const current = snap?.current;
  const latest = snap?.latest;
  const meta = [
    current?.column,
    latest &&
      (current ? `active ${agoPhrase(latest.at)}` : agoPhrase(latest.at)),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      {current ? (
        <CardLink number={current.number}>
          {current.golden && (
            <TicketIcon
              size={12}
              aria-label="Golden ticket"
              {...stylex.props(styles.gold)}
            />
          )}{" "}
          {current.title}
        </CardLink>
      ) : (
        <p
          {...stylex.props(
            styles.nowLine,
            layout.truncate,
            !latest && styles.quiet
          )}
        >
          {latest ? latest.title : `Nothing in the last ${RECENT_DAYS} days`}
        </p>
      )}
      {meta && <p {...stylex.props(styles.sub, layout.truncate)}>{meta}</p>}
    </>
  );
}

function CardLink({
  number,
  children,
}: {
  number: number;
  children: ReactNode;
}) {
  return (
    <Link
      to="."
      search={(prev: Record<string, unknown>) => ({ ...prev, card: number })}
      {...stylex.props(
        styles.nowLine,
        layout.truncate,
        styles.cardLink,
        styles.above
      )}
    >
      <span {...stylex.props(styles.number)}>#{number}</span>
      {children}
    </Link>
  );
}

function ClockCell({ clock }: { clock: Clock }) {
  return (
    <>
      <p {...stylex.props(styles.time)}>
        {clock.time} <span {...stylex.props(styles.place)}>{clock.place}</span>
      </p>
      <p {...stylex.props(styles.sub, styles.hoursLine)}>
        {clock.inHours === true && (
          <>
            <span {...stylex.props(styles.hoursDot)} />
            Working hours
          </>
        )}
        {clock.inHours === false && (clock.back ? `Back ${clock.back}` : "Off")}
      </p>
    </>
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
      <PersonError
        error={member.error}
        retry={() => {
          void member.refetch();
        }}
      />
    );
  }
  const m = member.data;
  const self = me?.member.id === m.id;
  const first = m.name.split(" ")[0] ?? m.name;

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
              {self ? "Your assistant" : `Ask ${first}'s assistant`}
            </Button>
          )
        }
      />
      <div {...stylex.props(styles.personSplit)}>
        <aside {...stylex.props(styles.profile)}>
          <Profile member={m} self={self} rhythm={snap.data?.rhythm} />
        </aside>
        <div {...stylex.props(styles.personMain)}>
          <div {...stylex.props(styles.nowBlock)}>
            <NowList
              title="Working on"
              empty={
                m.kind === "agent"
                  ? "No cards in progress."
                  : `${self ? "You have" : `${first} has`} no cards in progress.`
              }
              items={snap.data?.inProgress.map((c) => ({
                number: c.number,
                title: c.title,
                meta: c.column ?? undefined,
                at: c.lastActiveAt,
                golden: c.golden,
              }))}
            />
            <NowList
              title="Up next"
              empty="Nothing queued."
              items={snap.data?.upNext.map((c) => ({
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
                  emptyText={`Nothing from ${m.name} yet. Their work shows up here as their tools record it.`}
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

function Profile({
  member: m,
  self,
  rhythm,
}: {
  member: Member;
  self: boolean;
  rhythm?: number[];
}) {
  const now = useMinute();
  const clock = clockOf(m, now);
  const first = firstName(m);
  // The same query as the People list, so arriving from there costs nothing.
  const team = useQuery(q.teamNow(RECENT_DAYS));
  const row = team.data?.find((r) => r.memberId === m.id);

  return (
    <>
      <div {...stylex.props(styles.identity)}>
        {/* Its own page is the one place an agent's face moves with nothing under way. */}
        <Avatar person={m} size={72} mood={runFace(row?.agent).mood} live />
        <p {...stylex.props(styles.handle)}>
          @{m.handle} · {roleOf(m)}
        </p>
      </div>

      {clock && (
        <p {...stylex.props(styles.sentence)}>
          <span {...stylex.props(styles.time)}>{clock.time}</span> in{" "}
          {clock.place}
        </p>
      )}

      {row && <LiveRun member={m} row={row} />}

      {rhythm && (
        <Fact label="Activity">
          <RhythmCalendar
            counts={rhythm}
            today={clock?.date ?? localDate(now)}
            workdays={workdaysOf(m)}
            name={self ? "you" : first}
          />
        </Fact>
      )}

      {m.kind === "human" && <AnswersFor member={m} self={self} />}
      {m.kind === "agent" && <WorksFor member={m} />}

      {m.kind === "human" && !self && (
        <p {...stylex.props(styles.askNote)}>
          <ChatCircleIcon size={13} {...stylex.props(styles.askIcon)} />
          <span>
            {first}’s assistant answers from their team-visible work only.
            Private notes stay private.
          </span>
        </p>
      )}

      <p {...stylex.props(styles.since)}>
        In Worklog since{" "}
        {new Date(m.createdAt).toLocaleDateString("en-GB", {
          month: "long",
          year: "numeric",
        })}
      </p>
    </>
  );
}

function firstName(m: { name: string }) {
  return m.name.split(" ")[0] ?? m.name;
}

function workdaysOf(m: Member) {
  return m.settings.workdays ?? [0, 1, 2, 3, 4, 5, 6];
}

/** An agent mid-run or waiting on someone says so first, as on Home and its card. */
function LiveRun({ member: m, row }: { member: Member; row: Snap }) {
  const { byId } = useMembers();
  const me = useMe();
  const run = row.agent;
  if (
    !run ||
    !(run.state === "needs_you" || (run.state === "working" && !isStale(run)))
  ) {
    return null;
  }
  const owner = m.ownerId ? byId.get(m.ownerId) : undefined;
  return (
    <Fact label="Right now">
      <AgentRun run={run} owner={ownerWord(owner, me?.member.id)} />
    </Fact>
  );
}

function AnswersFor({ member: m, self }: { member: Member; self: boolean }) {
  const { list } = useMembers();
  const agents = list.filter(
    (a) => a.kind === "agent" && a.ownerId === m.id && !isAssistant(a)
  );
  if (agents.length === 0) {
    return null;
  }
  return (
    <Fact
      label={
        self ? "Agents you answer for" : `Agents ${firstName(m)} answers for`
      }
    >
      <ul {...stylex.props(styles.agentList)}>
        {agents.map((a) => (
          <li key={a.id}>
            <Link
              to="/people/$handle"
              params={{ handle: a.handle }}
              {...stylex.props(styles.agentRow)}
            >
              <Avatar person={a} size={20} />
              <span {...stylex.props(layout.truncate, layout.grow)}>
                {a.name}
              </span>
              {a.agentProvider && (
                <span {...stylex.props(styles.sub)}>
                  {providerName(a.agentProvider)}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Fact>
  );
}

function WorksFor({ member: m }: { member: Member }) {
  const { byId } = useMembers();
  const owner = m.ownerId ? byId.get(m.ownerId) : undefined;
  return (
    <Fact label="Works for">
      {owner ? (
        <Link
          to="/people/$handle"
          params={{ handle: owner.handle }}
          {...stylex.props(styles.ownerLink)}
        >
          <Avatar person={owner} size={20} />
          {owner.name}
        </Link>
      ) : (
        "The whole team"
      )}
      {m.agentProvider && !isAssistant(m) && (
        <p {...stylex.props(styles.sub)}>
          Runs on {providerName(m.agentProvider)}.{" "}
          {owner ? firstName(owner) : "The team"} answers for what it does.
        </p>
      )}
    </Fact>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section {...stylex.props(styles.fact)}>
      <h3 {...stylex.props(styles.factLabel)}>{label}</h3>
      <div>{children}</div>
    </section>
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
    number: number;
    title: string;
    meta?: string;
    at?: string;
    golden?: boolean;
  }[];
}) {
  return (
    <section {...stylex.props(styles.nowList)}>
      <h3 {...stylex.props(styles.factLabel)}>{title}</h3>
      {items === undefined && <Skeleton lines={2} />}
      {items?.length === 0 && <p {...stylex.props(layout.meta)}>{empty}</p>}
      <ul>
        {items?.map((item) => (
          <li key={item.number}>
            <Link
              to="."
              search={(prev: Record<string, unknown>) => ({
                ...prev,
                card: item.number,
              })}
              {...stylex.props(styles.nowRow)}
            >
              <span {...stylex.props(styles.number)}>#{item.number}</span>
              <span {...stylex.props(styles.nowTitle)}>
                {item.golden === true && (
                  <TicketIcon
                    size={12}
                    aria-label="Golden ticket"
                    {...stylex.props(styles.gold, styles.inlineIcon)}
                  />
                )}
                {item.title}
              </span>
              {(item.meta !== undefined || item.at !== undefined) && (
                <span {...stylex.props(styles.nowMeta)}>
                  {item.meta && <Badge>{item.meta}</Badge>}
                  {item.at && (
                    <span {...stylex.props(styles.ago)}>{ago(item.at)}</span>
                  )}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const PHONE = "@media (max-width: 640px)";

/** Nobody with that handle is a wrong address, not a failure: it gets the not-found page. */
function PersonError({ error, retry }: { error: Error; retry: () => void }) {
  if (error instanceof ApiError && error.status === 404) {
    return <NotFound />;
  }
  return (
    <Page>
      <ErrorNote error={error} retry={retry} />
    </Page>
  );
}

const styles = stylex.create({
  sections: { gap: space.x4 },
  grid: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(200px, 1.1fr) minmax(0, 2fr) 138px 128px",
      [PHONE]: "minmax(0, 1fr) auto",
    },
    gridTemplateAreas: {
      default: '"who now rhythm clock"',
      [PHONE]: '"who clock" "now now"',
    },
    columnGap: space.x3,
    rowGap: space.sm,
    alignItems: "center",
  },
  heads: {
    display: { default: "grid", [PHONE]: "none" },
    paddingInline: space.lg,
    paddingBottom: space.sm,
    fontSize: text.caption,
    fontWeight: 500,
    color: color.fgFaint,
  },
  roster: {
    display: "flex",
    flexDirection: "column",
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: color.line,
  },
  item: {
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
  },
  nestedItem: {},
  row: {
    position: "relative",
    minHeight: 64,
    paddingBlock: space.lg,
    paddingInline: space.lg,
    borderRadius: radius.md,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.surface },
    },
    transitionProperty: "background-color",
    transitionDuration: motion.fast,
  },
  rowNested: {
    minHeight: 44,
    paddingTop: 0,
    paddingBottom: space.lg,
  },
  whoHead: { gridArea: "who" },
  nowHead: { gridArea: "now" },
  who: {
    gridArea: "who",
    display: "flex",
    alignItems: "center",
    gap: space.lg,
    minWidth: 0,
  },
  // Only the person cell indents, so an agent's other cells stay in their owner's columns.
  whoNested: { paddingLeft: { default: 44, [PHONE]: 20 } },
  name: {
    display: "block",
    fontSize: text.label,
    lineHeight: leading.label,
    fontWeight: 600,
    color: color.fg,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    outline: "none",
  },
  // The whole row opens the person; links inside it sit above this layer.
  stretch: {
    "::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      borderRadius: radius.md,
      boxShadow: {
        default: null,
        ":focus-visible": `0 0 0 2px ${color.focus}`,
      },
    },
  },
  above: { position: "relative", zIndex: 1 },
  sub: {
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgMuted,
  },
  now: {
    gridArea: "now",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    paddingLeft: { default: null, [PHONE]: 44 },
  },
  nowNested: { paddingLeft: { default: null, [PHONE]: 64 } },
  nowLine: {
    fontSize: text.label,
    lineHeight: leading.label,
    color: color.fg,
  },
  clamp: {
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  quiet: { color: color.fgFaint },
  // Taller than its line so a thumb that lands just off the title still opens the card.
  cardLink: {
    display: "block",
    paddingBlock: 4,
    marginBlock: -4,
    textDecoration: {
      default: "none",
      ":hover": { default: null, [media.hover]: "underline" },
    },
    textDecorationColor: color.fgFaint,
    textUnderlineOffset: 3,
  },
  number: {
    fontFamily: font.mono,
    fontSize: 11.5,
    color: {
      default: color.fgFaint,
      ":hover": { default: null, [media.hover]: color.accentFg },
    },
    marginRight: space.xs,
    flexShrink: 0,
  },
  gold: {
    display: "inline-block",
    color: color.goldFg,
    flexShrink: 0,
    verticalAlign: "-1px",
  },
  inlineIcon: { marginRight: space.xs },
  rhythmCell: {
    gridArea: "rhythm",
    display: { default: "flex", [PHONE]: "none" },
    alignItems: "center",
  },
  // Its tooltip needs hover, so on touch a tap opens the person, whose page shows the calendar.
  passTap: { pointerEvents: { default: null, "@media (hover: none)": "none" } },
  clock: {
    gridArea: "clock",
    textAlign: "right",
    whiteSpace: "nowrap",
  },
  time: {
    fontSize: text.label,
    lineHeight: leading.label,
    fontWeight: 500,
    fontVariantNumeric: "tabular-nums",
    color: color.fg,
  },
  place: { fontWeight: 400, color: color.fgMuted },
  hoursLine: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: space.sm,
  },
  hoursDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: color.green,
  },
  alone: {
    paddingInline: space.lg,
    paddingTop: space.xl,
    fontSize: text.label,
    color: color.fgMuted,
  },
  link: {
    color: color.accentFg,
    textDecoration: {
      default: "none",
      ":hover": { default: null, [media.hover]: "underline" },
    },
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
    gap: space.xxl,
    paddingBlock: space.x3,
    paddingInline: { default: space.x3, [PHONE]: space.lg },
    overflowY: { default: "auto", "@media (max-width: 860px)": "visible" },
    borderRightWidth: { default: 1, "@media (max-width: 860px)": 0 },
    borderBottomWidth: { default: 0, "@media (max-width: 860px)": 1 },
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderStyle: "solid",
    borderColor: color.line,
  },
  identity: { display: "flex", flexDirection: "column", gap: space.md },
  handle: { fontSize: text.label, color: color.fgMuted },
  sentence: {
    fontSize: text.label,
    lineHeight: leading.label,
    color: color.fgMuted,
    textWrap: "pretty",
  },
  fact: { display: "flex", flexDirection: "column", gap: space.sm },
  factLabel: { fontSize: text.caption, fontWeight: 500, color: color.fgFaint },
  agentList: { display: "flex", flexDirection: "column" },
  agentRow: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
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
  ownerLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    fontSize: text.label,
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
  askIcon: { flexShrink: 0, marginTop: 2 },
  since: { fontSize: text.meta, color: color.fgFaint, marginTop: "auto" },
  personMain: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    minWidth: 0,
    containerType: "inline-size",
  },
  nowBlock: {
    display: "grid",
    // The pane's width, not the window's: beside the sidebar and profile a laptop leaves it
    // too narrow for titles next to their stage and date.
    gridTemplateColumns: {
      default: "minmax(0, 3fr) minmax(0, 2fr)",
      "@container (max-width: 680px)": "minmax(0, 1fr)",
    },
    gap: space.x3,
    paddingInline: { default: space.x3, [PHONE]: space.lg },
    paddingTop: space.x3,
    paddingBottom: space.xl,
    flexShrink: 0,
  },
  nowList: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    minWidth: 0,
  },
  nowRow: {
    display: "flex",
    alignItems: "baseline",
    gap: space.md,
    minHeight: 32,
    paddingBlock: space.sm,
    paddingInline: space.sm,
    marginInline: -6,
    borderRadius: radius.sm,
    fontSize: text.label,
    lineHeight: leading.label,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.ui },
    },
  },
  nowTitle: {
    flexGrow: 1,
    minWidth: 0,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  nowMeta: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    flexShrink: 0,
    alignSelf: "center",
  },
  ago: {
    fontSize: text.meta,
    color: color.fgFaint,
    fontVariantNumeric: "tabular-nums",
    minWidth: 24,
    textAlign: "right",
  },
  feedTitle: {
    paddingInline: { default: space.x3, [PHONE]: space.lg },
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
