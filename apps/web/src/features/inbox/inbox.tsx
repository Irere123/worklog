import {
  AlarmIcon,
  ArrowSquareOutIcon,
  CaretLeftIcon,
  ChatCenteredDotsIcon,
  CheckIcon,
  KanbanIcon,
  RobotIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TrayIcon,
  UserPlusIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { Schemas } from "#api/client";
import { api, unwrap } from "#api/client";
import type { AttentionState } from "#api/queries";
import { q } from "#api/queries";
import { ActivityLine, foldRuns } from "#features/activity/activity-line";
import { useMe } from "#features/auth/session";
import { UNDO_MS } from "#features/cards/actions";
import { STAGE_TONE, stageLabel, useMembers } from "#features/cards/card-bits";
import { ago, exactTime, fromNow } from "#lib/time";
import { Avatar, AvatarStack } from "#ui/avatar";
import { Button } from "#ui/button";
import { Badge, Kbd } from "#ui/chip";
import type { Tone } from "#ui/chip";
import { EmptyState, ErrorNote, Skeleton } from "#ui/feedback";
import { Segmented } from "#ui/field";
import { PageHeader, layout } from "#ui/layout";
import { Markdown } from "#ui/markdown";
import { Menu, MenuItem, Tooltip } from "#ui/overlay";
import {
  color,
  leading,
  media,
  motion,
  radius,
  space,
  text,
} from "#ui/tokens.stylex";

type Item = Schemas["AttentionListItem"];

const TABS: { value: AttentionState; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "snoozed", label: "Snoozed" },
  { value: "done", label: "Done" },
  { value: "dismissed", label: "Dismissed" },
];

/** Why an item is here, in the reader's words: every row must be able to explain itself. */
const KINDS: Record<string, { label: string; icon: ReactNode; tone: Tone }> = {
  "agent.needs_you": {
    label: "Agent needs a decision",
    icon: <RobotIcon size={13} />,
    tone: "amber",
  },
  "agent.failed": {
    label: "Agent couldn’t finish",
    icon: <RobotIcon size={13} />,
    tone: "red",
  },
  "agent.finished": {
    label: "Agent finished",
    icon: <RobotIcon size={13} />,
    tone: "green",
  },
  "assistant.approval": {
    label: "Approval",
    icon: <ChatCenteredDotsIcon size={13} />,
    tone: "amber",
  },
  "card.assigned": {
    label: "Assigned to you",
    icon: <UserPlusIcon size={13} />,
    tone: "blue",
  },
  "card.activity": {
    label: "Card you follow",
    icon: <KanbanIcon size={13} />,
    tone: "neutral",
  },
  "card.drifting": {
    label: "Drifting",
    icon: <AlarmIcon size={13} />,
    tone: "amber",
  },
  blocking: {
    label: "Someone is blocked on you",
    icon: <WarningCircleIcon size={13} />,
    tone: "red",
  },
  mention: {
    label: "Mentioned you",
    icon: <ChatCenteredDotsIcon size={13} />,
    tone: "blue",
  },
};

export function kindOf(kind: string) {
  return (
    KINDS[kind] ?? {
      label: kind.replaceAll(/[._]/gu, " "),
      icon: <TrayIcon size={13} />,
      tone: "neutral" as Tone,
    }
  );
}

function tomorrowMorning() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

const SNOOZES: { label: string; at: () => Date }[] = [
  { label: "In 3 hours", at: () => new Date(Date.now() + 3 * 3_600_000) },
  { label: "Tomorrow morning", at: tomorrowMorning },
  {
    label: "Next week",
    at: () => {
      const d = tomorrowMorning();
      // On a Sunday, the coming Monday is tomorrow: a week later is what "next week" means.
      d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
      return d;
    },
  },
];

/** When a snooze ends, so the choice isn't a guess: "21:40", "Mon 09:00", "Mon 9 Nov". */
function wakeLabel(at: Date) {
  const days = Math.round((at.getTime() - Date.now()) / 86_400_000);
  if (at.toDateString() === new Date().toDateString()) {
    return clock.format(at);
  }
  return days < 6
    ? `${weekdayShort.format(at)} ${clock.format(at)}`
    : dayMonth.format(at);
}

const clock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});
const weekdayShort = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const dayMonth = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

export function Inbox({
  state,
  onState,
  initialItem,
}: {
  state: AttentionState;
  onState: (s: AttentionState) => void;
  /** An item to open straight away, from a link on Home or a live toast. */
  initialItem?: string;
}) {
  const items = useQuery(q.attention(state));
  const open = useQuery(q.attention("open"));
  const [selectedId, setSelectedId] = useState<string | null>(
    initialItem ?? null
  );
  // Phones show one pane: the detail opens over the list when a row is tapped.
  const [opened, setOpened] = useState(initialItem !== undefined);
  const actions = useInboxActions(state);
  const groups = useMemo(
    () => groupOf(items.data ?? [], state),
    [items.data, state]
  );
  const list = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const index = Math.max(
    0,
    list.findIndex((i) => i.id === selectedId)
  );
  const selected = list[index];
  const navigate = useNavigate();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-id="${selected?.id ?? ""}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected?.id]);

  const move = (delta: number) => {
    const next = list[Math.min(list.length - 1, Math.max(0, index + delta))];
    if (next) {
      setSelectedId(next.id);
    }
  };
  const after = () => {
    const next = list[index + 1] ?? list[index - 1];
    setSelectedId(next?.id ?? null);
  };
  const run = (fn: (item: Item) => void) => () => {
    if (selected) {
      fn(selected);
      after();
    }
  };
  const approve = (label: RegExp) => () => {
    const action = selected?.actions?.find(
      (a) => label.test(a.label) || label.test(a.id)
    );
    if (selected && action) {
      actions.act(selected, action.id, action.label);
      after();
    }
  };

  // A card opened from here sits on top with its own keys (E edits it, D closes it): the inbox
  // underneath must not act on the same keypress.
  const free = useSearch({ from: "/_app" }).card === undefined;
  useHotkey("J", () => move(1), { enabled: free });
  useHotkey("K", () => move(-1), { enabled: free });
  useHotkey("ArrowDown", () => move(1), { enabled: free });
  useHotkey("ArrowUp", () => move(-1), { enabled: free });
  useHotkey(
    "E",
    run((item) => actions.update(item, "done")),
    { enabled: free && state !== "done" }
  );
  useHotkey(
    "X",
    run((item) => actions.update(item, "dismissed")),
    { enabled: free && state !== "dismissed" }
  );
  useHotkey(
    "H",
    run((item) => actions.update(item, "snoozed", tomorrowMorning())),
    { enabled: free }
  );
  useHotkey("Y", approve(/allow|approve|yes/iu), { enabled: free });
  useHotkey("N", approve(/deny|reject|no/iu), { enabled: free });
  useHotkey("Z", () => actions.undo(), { enabled: free });
  useHotkey(
    "Enter",
    () => {
      if (selected?.url) {
        window.open(selected.url, "_blank", "noopener");
      } else if (
        selected?.cardNumber !== undefined &&
        selected.cardNumber !== null
      ) {
        const card = selected.cardNumber;
        void navigate({
          to: ".",
          search: (prev: Record<string, unknown>) => ({ ...prev, card }),
        });
      }
    },
    { enabled: free }
  );

  return (
    <>
      <PageHeader
        title="Inbox"
        icon={<TrayIcon size={16} />}
        subtitle={<Budget />}
        actions={
          <Segmented
            label="Show"
            value={state}
            onChange={(s) => {
              setSelectedId(null);
              onState(s);
            }}
            options={TABS.map((t) => ({
              ...t,
              count: t.value === "open" ? open.data?.length : undefined,
            }))}
          />
        }
      />
      <div {...stylex.props(styles.split)}>
        <div {...stylex.props(styles.listPane)}>
          {items.isPending && (
            <div {...stylex.props(styles.pad)}>
              <Skeleton lines={6} height={40} />
            </div>
          )}
          {items.isError && (
            <div {...stylex.props(styles.pad)}>
              <ErrorNote
                error={items.error}
                retry={() => {
                  void items.refetch();
                }}
              />
            </div>
          )}
          {items.isSuccess && list.length === 0 && <Empty state={state} />}
          <div ref={listRef} {...stylex.props(styles.list)}>
            {groups.map((group) => (
              <section key={group.title} aria-label={group.title}>
                {groups.length > 1 && (
                  <h2 {...stylex.props(styles.group)}>
                    {group.title}
                    <span {...stylex.props(styles.groupCount)}>
                      {group.items.length}
                    </span>
                  </h2>
                )}
                <ul>
                  {group.items.map((item) => (
                    <Row
                      key={item.id}
                      item={item}
                      selected={item.id === selected?.id}
                      onSelect={() => {
                        setSelectedId(item.id);
                        setOpened(true);
                      }}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {list.length > 0 && <Legend state={state} />}
        </div>
        <div {...stylex.props(styles.detailPane, opened && styles.detailOpen)}>
          <button
            type="button"
            onClick={() => setOpened(false)}
            {...stylex.props(styles.back)}
          >
            <CaretLeftIcon size={16} /> Inbox
          </button>
          {selected ? (
            <Detail
              key={selected.id}
              item={selected}
              state={state}
              actions={actions}
              onDone={() => {
                after();
                setOpened(false);
              }}
            />
          ) : (
            list.length > 0 && (
              <p {...stylex.props(styles.hint)}>Select an item, or press J.</p>
            )
          )}
        </div>
      </div>
    </>
  );
}

const DECISIONS = new Set([
  "agent.needs_you",
  "assistant.approval",
  "blocking",
]);
const FOR_YOU = new Set([
  "card.assigned",
  "mention",
  "agent.failed",
  "review.requested",
]);

/**
 * Open items in the order they deserve: decisions first, then what's addressed to you, then
 * updates. Other tabs are history and stay in time order.
 */
function groupOf(items: Item[], state: AttentionState) {
  if (state !== "open") {
    return [{ title: "All", items }];
  }
  const groups = [
    {
      title: "Needs a decision",
      items: items.filter((i) => DECISIONS.has(i.kind)),
    },
    {
      title: "For you",
      items: items.filter((i) => !DECISIONS.has(i.kind) && FOR_YOU.has(i.kind)),
    },
    {
      title: "Updates",
      items: items.filter(
        (i) => !DECISIONS.has(i.kind) && !FOR_YOU.has(i.kind)
      ),
    },
  ];
  return groups.filter((g) => g.items.length > 0);
}

/**
 * The interruption budget, in view: how many of today's pings Worklog has spent. Beyond the cap,
 * items wait for the brief instead of pinging.
 */
function Budget() {
  const me = useMe();
  const today = useQuery(q.attentionMetrics(1));
  const cap = me?.member.settings.notify?.dailyPushCap ?? 4;
  if (!today.data) {
    return "Only what’s waiting on you.";
  }
  const sent = today.data.pushes;
  if (sent >= cap) {
    return `Only what’s waiting on you · ${cap} pings sent today, so the rest waits for your brief`;
  }
  return sent === 0
    ? `Only what’s waiting on you · no pings yet today, ${cap} at most`
    : `Only what’s waiting on you · pinged you ${sent} of ${cap} times today`;
}

function Row({
  item,
  selected,
  onSelect,
}: {
  item: Item;
  selected: boolean;
  onSelect: () => void;
}) {
  const { byId } = useMembers();
  const from = item.fromId ? byId.get(item.fromId) : undefined;
  const kind = kindOf(item.kind);
  return (
    <li data-id={item.id}>
      <button
        type="button"
        aria-current={selected || undefined}
        onClick={onSelect}
        {...stylex.props(styles.row, selected && styles.rowSelected)}
      >
        <span {...stylex.props(styles.rowAvatar)}>
          {from ? (
            <Avatar person={from} size={28} />
          ) : (
            <span {...stylex.props(styles.systemIcon)}>{kind.icon}</span>
          )}
        </span>
        <span {...stylex.props(layout.grow)}>
          <span {...stylex.props(styles.rowTitle)}>{item.title}</span>
          <span {...stylex.props(styles.rowMeta)}>
            <span {...stylex.props(kindText[kind.tone])}>{kind.label}</span>
            {item.count > 1 && <span>· {item.count} updates</span>}
            {item.state === "snoozed" && item.snoozedUntil && (
              <span>· back {fromNow(item.snoozedUntil)}</span>
            )}
          </span>
        </span>
        <time
          title={exactTime(item.updatedAt)}
          {...stylex.props(styles.rowTime)}
        >
          {item.priority === "high" && (
            <span
              aria-label="High priority"
              {...stylex.props(styles.priority)}
            />
          )}
          {ago(item.updatedAt)}
        </time>
      </button>
    </li>
  );
}

function Detail({
  item,
  state,
  actions,
  onDone,
}: {
  item: Item;
  state: AttentionState;
  actions: ReturnType<typeof useInboxActions>;
  onDone: () => void;
}) {
  const { byId } = useMembers();
  const from = item.fromId ? byId.get(item.fromId) : undefined;
  const kind = kindOf(item.kind);
  const cardNumber = item.cardNumber ?? undefined;
  const [rated, setRated] = useState<string | null>(null);
  const feedback = useMutation({
    mutationFn: async (signal: "useful" | "not_useful" | "less_like_this") =>
      await unwrap(
        api.POST("/v1/attention/{id}/feedback", {
          params: { path: { id: item.id } },
          body: { signal },
        })
      ),
    onSuccess: (result, signal) => {
      setRated(signal);
      toast(
        result.muted
          ? `Got it: fewer “${kindOf(result.kind).label.toLowerCase()}” pings from now on`
          : "Thanks, Worklog learns from this"
      );
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <article {...stylex.props(styles.detail)}>
      <div {...stylex.props(layout.row)}>
        <Badge tone={kind.tone} icon={kind.icon}>
          {kind.label}
        </Badge>
        {item.priority === "high" && <Badge tone="amber">High priority</Badge>}
        <span {...stylex.props(layout.grow)} />
        <span title={exactTime(item.createdAt)} {...stylex.props(layout.meta)}>
          {fromNow(item.createdAt)}
        </span>
      </div>
      <h2 {...stylex.props(styles.detailTitle)}>{item.title}</h2>
      {from && (
        <Link
          to="/people/$handle"
          params={{ handle: from.handle }}
          {...stylex.props(styles.from)}
        >
          <Avatar person={from} size={20} />
          <span>{from.name}</span>
          {from.title && (
            <span {...stylex.props(layout.faint)}>· {from.title}</span>
          )}
        </Link>
      )}
      {item.body && (
        <div {...stylex.props(styles.bodyBox)}>
          <Markdown size="label">{item.body}</Markdown>
        </div>
      )}

      {(item.actions?.length ?? 0) > 0 && state === "open" && (
        <div {...stylex.props(styles.approval)}>
          <p {...stylex.props(styles.approvalTitle)}>Your answer</p>
          <div {...stylex.props(layout.row)}>
            {item.actions?.map((a, i) => (
              <Button
                key={a.id}
                variant={i === 0 ? "primary" : "secondary"}
                onClick={() => {
                  actions.act(item, a.id, a.label);
                  onDone();
                }}
                trailing={
                  <Kbd sx={styles.btnKbd}>
                    {/deny|reject|no/iu.test(a.label) ? "N" : "Y"}
                  </Kbd>
                }
              >
                {a.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div {...stylex.props(styles.links)}>
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            {...stylex.props(styles.linkChip)}
          >
            <ArrowSquareOutIcon size={13} /> Open source
          </a>
        )}
      </div>

      {item.reason && (
        <p {...stylex.props(styles.reason)}>
          <span {...stylex.props(styles.reasonLabel)}>
            Why you’re seeing this
          </span>
          {item.reason}
          {item.disposition === "digest" ? " Held for your digest." : ""}
        </p>
      )}

      <div {...stylex.props(styles.toolbar)}>
        {state !== "done" && (
          <Button
            icon={<CheckIcon size={14} />}
            trailing={<Kbd sx={styles.btnKbd}>E</Kbd>}
            onClick={() => {
              actions.update(item, "done");
              onDone();
            }}
          >
            Done
          </Button>
        )}
        <Menu
          trigger={
            <Button
              icon={<AlarmIcon size={14} />}
              trailing={<Kbd sx={styles.btnKbd}>H</Kbd>}
            >
              Snooze
            </Button>
          }
        >
          {SNOOZES.map((s) => (
            <MenuItem
              key={s.label}
              detail={wakeLabel(s.at())}
              onClick={() => {
                actions.update(item, "snoozed", s.at());
                onDone();
              }}
            >
              {s.label}
            </MenuItem>
          ))}
        </Menu>
        {state !== "dismissed" && (
          <Button
            variant="ghost"
            icon={<XIcon size={14} />}
            trailing={<Kbd sx={styles.btnKbd}>X</Kbd>}
            onClick={() => {
              actions.update(item, "dismissed");
              onDone();
            }}
          >
            Dismiss
          </Button>
        )}
        {state !== "open" && (
          <Button variant="ghost" onClick={() => actions.update(item, "open")}>
            Move back to open
          </Button>
        )}
      </div>

      <div {...stylex.props(styles.feedback)}>
        <span>Was this worth your attention?</span>
        <Tooltip label="Useful">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Useful"
            aria-pressed={rated === "useful"}
            icon={<ThumbsUpIcon size={14} />}
            onClick={() => feedback.mutate("useful")}
          />
        </Tooltip>
        <Tooltip label="Not useful">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Not useful"
            aria-pressed={rated === "not_useful"}
            icon={<ThumbsDownIcon size={14} />}
            onClick={() => feedback.mutate("not_useful")}
          />
        </Tooltip>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => feedback.mutate("less_like_this")}
        >
          Less like this
        </Button>
      </div>
      {cardNumber !== undefined && (
        <CardContext number={cardNumber} raisedBy={item.activityId} />
      )}
    </article>
  );
}

/**
 * Where the card stands and what last happened on it, so most decisions can be made from the
 * inbox without opening the card.
 */
function CardContext({
  number,
  raisedBy,
}: {
  number: number;
  /** The event behind the item, already shown above it. */
  raisedBy: string | null;
}) {
  const card = useQuery(q.card(number));
  const recent = useQuery(q.recentActivities({ card: number, limit: 5 }));
  const others = (recent.data ?? []).filter((a) => a.id !== raisedBy);
  const { byId } = useMembers();
  if (!card.data) {
    return null;
  }
  const { title, stage, columnName, assigneeIds } = card.data;
  const people = assigneeIds
    .map((id) => byId.get(id))
    .filter((m) => m !== undefined);
  return (
    <section aria-label="On the card" {...stylex.props(styles.context)}>
      <p {...stylex.props(styles.contextLabel)}>On the card</p>
      <Link
        to="."
        search={(prev: Record<string, unknown>) => ({ ...prev, card: number })}
        {...stylex.props(styles.contextCard)}
      >
        <KanbanIcon size={14} {...stylex.props(styles.contextIcon)} />
        <span {...stylex.props(styles.contextNumber)}>#{number}</span>
        <span {...stylex.props(styles.contextTitle)}>{title}</span>
        <Badge tone={STAGE_TONE[stage]}>
          {stage === "active" ? (columnName ?? "Active") : stageLabel(stage)}
        </Badge>
        {people.length > 0 && <AvatarStack people={people} size={20} />}
      </Link>
      {others.length > 0 && (
        <ol {...stylex.props(styles.contextList)}>
          {foldRuns(others).map(({ activity, earlier }) => (
            <li key={activity.id}>
              <ActivityLine
                activity={activity}
                earlier={earlier}
                compact
                hideCard
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Legend({ state }: { state: AttentionState }) {
  return (
    <div {...stylex.props(styles.legend)}>
      <span>
        <Kbd>J K</Kbd> move
      </span>
      {state !== "done" && (
        <span>
          <Kbd>E</Kbd> done
        </span>
      )}
      <span>
        <Kbd>H</Kbd> snooze
      </span>
      <span>
        <Kbd>X</Kbd> dismiss
      </span>
      <span>
        <Kbd>Z</Kbd> undo
      </span>
    </div>
  );
}

function Empty({ state }: { state: AttentionState }) {
  const snoozed = useQuery({
    ...q.attention("snoozed"),
    enabled: state === "open",
  });
  const next = useMemo(
    () =>
      (snoozed.data ?? [])
        .map((i) => i.snoozedUntil)
        .filter((at): at is string => at !== null)
        .toSorted()[0],
    [snoozed.data]
  );
  if (state === "open") {
    return (
      <EmptyState
        icon={<CheckIcon size={20} />}
        title="Nothing is waiting on you"
      >
        {next
          ? `The next snoozed item comes back ${fromNow(next)}.`
          : "When something is blocked on you, it shows up here. Everything else waits for your brief."}
      </EmptyState>
    );
  }
  return <EmptyState title={`Nothing ${state}`} />;
}

type Undo = { item: Item; from: AttentionState; toast?: string | number };

/** Inbox writes are optimistic and the last one can be undone with Z. */
function useInboxActions(state: AttentionState) {
  const client = useQueryClient();
  const last = useRef<Undo | null>(null);
  const key = q.attention(state).queryKey;

  const remove = (item: Item) => {
    client.setQueryData<Item[]>(key, (list) =>
      list?.filter((i) => i.id !== item.id)
    );
  };
  const restore = (item: Item) => {
    client.setQueryData<Item[]>(key, (list) =>
      list?.some((i) => i.id === item.id) === true
        ? list
        : [...(list ?? []), item]
    );
  };
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["attention"] });
  };

  const updateMutation = useMutation({
    mutationFn: async ({
      item,
      next,
      until,
    }: {
      item: Item;
      next: AttentionState;
      until?: Date;
    }) =>
      await unwrap(
        api.PATCH("/v1/attention/{id}", {
          params: { path: { id: item.id } },
          body: { state: next, snoozedUntil: until?.toISOString() },
        })
      ),
    // Undo puts the row back before the server answers: the live feed then sees an item it
    // already holds, instead of announcing it as a new ping.
    onMutate: ({ item, next }) => {
      if (next === state) {
        restore(item);
      } else {
        remove(item);
      }
    },
    onError: (error) => {
      toast.error(error.message);
      refresh();
    },
    onSettled: refresh,
  });

  const actMutation = useMutation({
    mutationFn: async ({
      item,
      actionId,
    }: {
      item: Item;
      actionId: string;
      label: string;
    }) =>
      await unwrap(
        api.POST("/v1/attention/{id}/actions/{actionId}", {
          params: { path: { id: item.id, actionId } },
        })
      ),
    onMutate: ({ item }) => remove(item),
    onSuccess: (_r, { label }) => toast.success(`${label}: done`),
    onError: (error) => {
      toast.error(error.message);
      refresh();
    },
    onSettled: refresh,
  });

  const MESSAGES: Partial<Record<AttentionState, string>> = {
    done: "Marked done",
    dismissed: "Dismissed",
    snoozed: "Snoozed",
    open: "Moved back to open",
  };

  const undo = () => {
    const previous = last.current;
    if (!previous) {
      return;
    }
    last.current = null;
    toast.dismiss(previous.toast);
    updateMutation.mutate({ item: previous.item, next: previous.from });
  };

  return {
    update(item: Item, next: AttentionState, until?: Date) {
      updateMutation.mutate({ item, next, until });
      last.current = {
        item,
        from: item.state,
        toast: toast(MESSAGES[next], {
          duration: UNDO_MS,
          description: item.title,
          action: { label: "Undo", onClick: undo },
        }),
      };
    },
    act(item: Item, actionId: string, label: string) {
      last.current = null;
      actMutation.mutate({ item, actionId, label });
    },
    undo,
  };
}

const styles = stylex.create({
  split: {
    flexGrow: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(340px, 440px) minmax(0, 1fr)",
      "@media (max-width: 860px)": "minmax(0, 1fr)",
    },
    position: "relative",
  },
  listPane: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    borderRightWidth: { default: 1, "@media (max-width: 860px)": 0 },
    borderRightStyle: "solid",
    borderRightColor: color.line,
  },
  pad: { padding: space.xl },
  list: { flexGrow: 1, overflowY: "auto", padding: space.sm },
  row: {
    position: "relative",
    width: "100%",
    textAlign: "left",
    display: "flex",
    alignItems: "flex-start",
    gap: space.md,
    paddingBlock: space.md,
    paddingInlineStart: space.lg,
    paddingInlineEnd: space.md,
    borderRadius: radius.md,
    cursor: "default",
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.ui },
    },
    transitionProperty: "background-color",
    transitionDuration: motion.fast,
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
  },
  rowSelected: {
    backgroundColor: {
      default: color.uiActive,
      ":hover": { default: null, [media.hover]: color.uiActive },
    },
  },
  priority: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    backgroundColor: color.amber,
  },
  rowAvatar: { paddingTop: 2 },
  systemIcon: {
    display: "grid",
    placeItems: "center",
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    color: color.fgMuted,
    backgroundColor: color.ui,
  },
  rowTitle: {
    fontSize: text.label,
    lineHeight: leading.label,
    fontWeight: 500,
    color: color.fg,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  rowMeta: {
    display: "flex",
    gap: space.xs,
    marginTop: 2,
    fontSize: text.meta,
    color: color.fgFaint,
  },
  rowTime: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    flexShrink: 0,
    fontSize: text.meta,
    color: color.fgFaint,
    fontVariantNumeric: "tabular-nums",
    paddingTop: 2,
  },
  group: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    paddingInline: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xs,
    fontSize: text.caption,
    fontWeight: 600,
    color: color.fgFaint,
  },
  groupCount: { fontVariantNumeric: "tabular-nums", fontWeight: 500 },
  legend: {
    display: {
      default: "flex",
      "@media (hover: none) and (pointer: coarse)": "none",
    },
    flexWrap: "wrap",
    gap: space.lg,
    paddingBlock: space.md,
    paddingInline: space.xl,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: color.line,
    fontSize: text.meta,
    color: color.fgFaint,
  },
  detailPane: {
    minHeight: 0,
    overflowY: "auto",
    display: { default: "block", "@media (max-width: 860px)": "none" },
    position: { default: "static", "@media (max-width: 860px)": "absolute" },
    inset: 0,
    zIndex: 2,
    backgroundColor: color.bg,
  },
  detailOpen: {
    display: { default: "block", "@media (max-width: 860px)": "block" },
  },
  back: {
    display: { default: "none", "@media (max-width: 860px)": "flex" },
    alignItems: "center",
    gap: space.xs,
    height: 44,
    paddingInline: space.lg,
    fontSize: text.label,
    fontWeight: 500,
    color: color.accentFg,
  },
  hint: { padding: space.x4, color: color.fgFaint, fontSize: text.label },
  detail: {
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
    maxWidth: 680,
    paddingInline: space.x4,
    paddingBlock: space.x3,
  },
  detailTitle: {
    fontSize: text.title,
    lineHeight: leading.title,
    fontWeight: 600,
    letterSpacing: "-0.01em",
  },
  from: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    alignSelf: "flex-start",
    fontSize: text.label,
    fontWeight: 500,
    color: color.fg,
    textDecoration: {
      default: "none",
      ":hover": { default: null, [media.hover]: "underline" },
    },
  },
  bodyBox: {
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    boxShadow: `inset 0 0 0 1px ${color.line}`,
  },
  approval: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.amberSubtle,
  },
  approvalTitle: { fontSize: text.meta, fontWeight: 600, color: color.amberFg },
  links: { display: "flex", flexWrap: "wrap", gap: space.sm },
  context: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    paddingTop: space.xl,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: color.line,
  },
  contextLabel: {
    fontSize: text.caption,
    fontWeight: 500,
    color: color.fgFaint,
  },
  contextCard: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    minHeight: 44,
    paddingInline: space.lg,
    borderRadius: radius.md,
    color: color.fg,
    backgroundColor: {
      default: color.surface,
      ":hover": { default: null, [media.hover]: color.ui },
    },
    boxShadow: `inset 0 0 0 1px ${color.line}`,
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
  },
  contextIcon: { flexShrink: 0, color: color.fgFaint },
  contextNumber: {
    fontSize: text.meta,
    color: color.fgFaint,
    fontVariantNumeric: "tabular-nums",
  },
  contextTitle: {
    flexGrow: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: text.label,
    fontWeight: 500,
  },
  contextList: { display: "flex", flexDirection: "column" },
  linkChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    height: 28,
    paddingInline: space.md,
    borderRadius: radius.sm,
    fontSize: text.label,
    fontWeight: 500,
    color: color.fg,
    backgroundColor: {
      default: color.ui,
      ":hover": { default: null, [media.hover]: color.uiHover },
    },
  },
  reason: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgMuted,
  },
  reasonLabel: {
    fontWeight: 600,
    color: color.fgFaint,
    fontSize: text.caption,
  },
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    gap: space.sm,
    paddingTop: space.lg,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: color.line,
  },
  btnKbd: { marginInlineStart: space.xs },
  feedback: {
    display: "flex",
    alignItems: "center",
    gap: space.xs,
    fontSize: text.meta,
    color: color.fgFaint,
  },
});

const kindText = stylex.create({
  neutral: { color: color.fgMuted },
  accent: { color: color.accentFg },
  gold: { color: color.goldFg },
  green: { color: color.greenFg },
  amber: { color: color.amberFg },
  red: { color: color.redFg },
  violet: { color: color.violetFg },
  blue: { color: color.blueFg },
});
