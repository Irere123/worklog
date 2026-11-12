import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  ArrowsLeftRightIcon,
  CardsIcon,
  ChatsCircleIcon,
  CalendarBlankIcon,
  CheckIcon,
  ClockIcon,
  DotsThreeIcon,
  EyeIcon,
  HashIcon,
  HourglassMediumIcon,
  LinkSimpleIcon,
  MicrophoneIcon,
  PencilSimpleIcon,
  PlusIcon,
  PushPinIcon,
  TicketIcon,
  UserPlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useHotkey, useHotkeys } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { Schemas } from "#api/client";
import { ApiError, api, unwrap } from "#api/client";
import { q } from "#api/queries";
import { ActivityLine, sameRun } from "#features/activity/activity-line";
import { useDictation } from "#features/assistant/dictation";
import { useMe } from "#features/auth/session";
import { useTouch } from "#lib/pointer";
import { ago, exactTime, fromNow } from "#lib/time";
import { Avatar } from "#ui/avatar";
import { Button } from "#ui/button";
import { Badge, Kbd, MOD } from "#ui/chip";
import { DatePicker } from "#ui/date-picker";
import { EmptyState, ErrorNote, Skeleton } from "#ui/feedback";
import { Textarea } from "#ui/field";
import { layout } from "#ui/layout";
import { Markdown } from "#ui/markdown";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Tooltip,
} from "#ui/overlay";
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

import { useCardActions } from "./actions";
import type { CardAction } from "./actions";
import {
  CardRun,
  DueChip,
  hueOfColor,
  stageLabel,
  useMembers,
} from "./card-bits";
import { useCardRefs } from "./card-refs";
import { usePins } from "./pins";

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

type CardDetail = Schemas["CardDetail"];

export function CardPanel({ number }: { number: number }) {
  const navigate = useNavigate();
  const close = () => {
    void navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({ ...prev, card: undefined }),
    });
  };
  const card = useQuery(q.card(number));
  const panel = useRef<HTMLDivElement>(null);

  return (
    <BaseDialog.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop {...stylex.props(styles.backdrop)} />
        <BaseDialog.Popup
          ref={panel}
          // Focus starts on the panel, not its first button: opening a card shouldn't light a
          // focus ring on the golden ticket as if it had been chosen.
          initialFocus={panel}
          {...stylex.props(styles.panel)}
          aria-label={`Card ${number}`}
        >
          {card.isPending && (
            <div {...stylex.props(styles.pad)}>
              <Skeleton lines={6} />
            </div>
          )}
          {card.isError && (
            <div {...stylex.props(styles.pad)}>
              {/* Trying again can't bring back a card that isn't there; closing is the way on. */}
              {card.error instanceof ApiError && card.error.status === 404 ? (
                <EmptyState
                  icon={<CardsIcon size={20} />}
                  title={`There’s no card #${number}`}
                  action={<Button onClick={close}>Close</Button>}
                >
                  It may have been deleted, or it’s on a board you can’t see.
                </EmptyState>
              ) : (
                <ErrorNote
                  error={card.error}
                  retry={() => {
                    void card.refetch();
                  }}
                />
              )}
            </div>
          )}
          {card.data && <CardBody card={card.data} />}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

function CardBody({ card }: { card: CardDetail }) {
  const me = useMe();
  const board = useQuery(q.board(card.boardId));
  const columns = useMemo(
    () => new Map((board.data?.columns ?? []).map((c) => [c.id, c.name])),
    [board.data]
  );
  const actions = useCardActions(columns);
  const act: Act = (action) => actions.mutate({ card, action });
  const pins = usePins();
  const column = board.data?.columns.find((c) => c.id === card.columnId);

  useHotkey("Shift+G", () => act({ type: card.golden ? "ungild" : "gild" }));
  // Triage by number, as in Linear: 1 sends a card in Maybe? to the first column, 2 the second.
  useHotkeys(
    (board.data?.columns ?? []).slice(0, DIGITS.length).map((c, i) => ({
      hotkey: DIGITS[i] ?? "1",
      callback: () => act({ type: "move", columnId: c.id }),
      // The shell's 1–3 stand down while a card is open, so sharing the keys is on purpose.
      options: { enabled: card.stage === "triage", conflictBehavior: "allow" },
    }))
  );
  useHotkey("M", () => {
    if (me && !card.assigneeIds.includes(me.member.id)) {
      act({ type: "assign", memberId: me.member.id });
    }
  });
  useHotkey("[", () =>
    act({ type: card.stage === "not_now" ? "resume" : "later" })
  );
  useHotkey("]", () =>
    act({ type: card.stage === "done" ? "reopen" : "close" })
  );
  // Fizzy's card keys. E, T and A press the control itself, so a key does exactly what a click does.
  useHotkey("D", () =>
    act({ type: card.stage === "done" ? "reopen" : "close" })
  );
  useHotkey("E", () => pressCardControl("title"));
  useHotkey("T", () => pressCardControl("tags"));
  useHotkey("A", () => pressCardControl("assign"));
  useHotkey("Shift+P", () => pins.toggle(card.number));
  useHotkey("Shift+N", () => {
    if (me) {
      act({
        type: card.watcherIds.includes(me.member.id) ? "unwatch" : "watch",
      });
    }
  });

  return (
    <>
      <CardHeader card={card} act={act} />

      <div {...stylex.props(styles.scroll)}>
        <div {...stylex.props(styles.content)}>
          <EditableTitle
            card={card}
            onSave={(title) => act({ type: "edit", set: { title } })}
          />

          {card.stage !== "done" && card.stage !== "not_now" && (
            <CardRun number={card.number} full />
          )}

          <StageBar
            card={card}
            columns={board.data?.columns ?? []}
            onAct={act}
            columnColor={column?.color}
          />

          <CardFields card={card} act={act} />

          <Description
            card={card}
            onSave={(body) => act({ type: "edit", set: { body } })}
          />

          {card.externalUrl && (
            <a
              href={card.externalUrl}
              target="_blank"
              rel="noreferrer"
              {...stylex.props(styles.external)}
            >
              <LinkSimpleIcon size={13} /> {card.externalUrl}
            </a>
          )}

          <Timeline card={card} />
        </div>
      </div>
      <Composer number={card.number} />
    </>
  );
}

type Act = (action: CardAction) => void;

function CardHeader({ card, act }: { card: CardDetail; act: Act }) {
  const board = useQuery(q.board(card.boardId));
  const boards = useQuery(q.boards());
  const navigate = useNavigate();
  return (
    <header {...stylex.props(styles.header)}>
      <span {...stylex.props(styles.number)}>#{card.number}</span>
      <span {...stylex.props(styles.crumb)}>{board.data?.name ?? "…"}</span>
      <span {...stylex.props(styles.grow)} />
      <Tooltip
        label={
          card.golden ? "Remove golden ticket" : "Golden ticket: put it on top"
        }
        shortcut="⇧ G"
      >
        <Button
          variant="ghost"
          size="sm"
          aria-label="Golden ticket"
          aria-pressed={card.golden}
          icon={<TicketIcon size={15} />}
          onClick={() => act({ type: card.golden ? "ungild" : "gild" })}
          sx={card.golden ? styles.goldOn : undefined}
        />
      </Tooltip>
      <PinButton number={card.number} />
      <WatchButton card={card} act={act} />
      <Menu
        align="end"
        trigger={
          <Button
            variant="ghost"
            size="sm"
            aria-label="More"
            icon={<DotsThreeIcon size={15} />}
          />
        }
      >
        {board.data && board.data.columns.length > 0 && (
          <MenuLabel>Move to</MenuLabel>
        )}
        {card.stage !== "triage" && (
          <MenuItem
            icon={<ArrowCounterClockwiseIcon size={14} />}
            onClick={() => act({ type: "triage" })}
          >
            Maybe? (back to triage)
          </MenuItem>
        )}
        {board.data?.columns.map((c) => (
          <MenuItem
            key={c.id}
            icon={<ColumnDot color={c.color} />}
            disabled={c.id === card.columnId && card.stage === "active"}
            onClick={() => act({ type: "move", columnId: c.id })}
          >
            {c.name}
          </MenuItem>
        ))}
        <MenuSeparator />
        {card.stage === "not_now" ? (
          <MenuItem
            icon={<ArrowCounterClockwiseIcon size={14} />}
            shortcut="["
            onClick={() => act({ type: "resume" })}
          >
            Bring back
          </MenuItem>
        ) : (
          <MenuItem
            icon={<HourglassMediumIcon size={14} />}
            shortcut="["
            onClick={() => act({ type: "later" })}
          >
            Not now
          </MenuItem>
        )}
        {card.stage === "done" ? (
          <MenuItem
            icon={<ArrowCounterClockwiseIcon size={14} />}
            shortcut="]"
            onClick={() => act({ type: "reopen" })}
          >
            Reopen
          </MenuItem>
        ) : (
          <MenuItem
            icon={<CheckIcon size={14} />}
            shortcut="]"
            onClick={() => act({ type: "close" })}
          >
            Mark done
          </MenuItem>
        )}
        {(boards.data?.length ?? 0) > 1 && (
          <>
            <MenuSeparator />
            <MenuLabel>Move to board</MenuLabel>
            {boards.data
              ?.filter((b) => b.id !== card.boardId && !b.archived)
              .map((b) => (
                <MenuItem
                  key={b.id}
                  icon={<ArrowsLeftRightIcon size={14} />}
                  onClick={() => act({ type: "edit", set: { boardId: b.id } })}
                >
                  {b.name}
                </MenuItem>
              ))}
          </>
        )}
        <MenuSeparator />
        <MenuItem
          icon={<ChatsCircleIcon size={14} />}
          onClick={() => {
            void navigate({
              to: "/assistant",
              search: {
                ask: `Where does #${card.number} stand, and what's next for it?`,
              },
            });
          }}
        >
          Ask your assistant about it
        </MenuItem>
        <MenuItem
          icon={<LinkSimpleIcon size={14} />}
          onClick={() => {
            void navigator.clipboard.writeText(
              `${location.origin}/boards/${card.boardId}?card=${card.number}`
            );
            toast.success("Link copied");
          }}
        >
          Copy link
        </MenuItem>
      </Menu>
      <BaseDialog.Close
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label="Close"
            icon={<XIcon size={16} />}
          />
        }
      />
    </header>
  );
}

function CardFields({ card, act }: { card: CardDetail; act: Act }) {
  const me = useMe();
  const { byId, list: members } = useMembers();
  const assignees = useRef<HTMLElement>(null);
  return (
    <dl {...stylex.props(styles.fields)}>
      <dt {...stylex.props(styles.fieldLabel)}>Assignees</dt>
      <dd ref={assignees} {...stylex.props(styles.fieldValue)}>
        {card.assigneeIds.map((id) => {
          const m = byId.get(id);
          return (
            <span key={id} {...stylex.props(styles.person)}>
              <Avatar person={m} size={18} />
              {m?.name ?? "Someone"}
              <button
                type="button"
                aria-label={`Unassign ${m?.name ?? ""}`}
                onClick={() => act({ type: "unassign", memberId: id })}
                {...stylex.props(styles.remove)}
              >
                <XIcon size={12} />
              </button>
            </span>
          );
        })}
        <Menu
          trigger={
            <button
              type="button"
              data-card-edit="assign"
              aria-label="Assign"
              {...stylex.props(styles.add)}
            >
              <UserPlusIcon size={13} />{" "}
              {card.assigneeIds.length === 0 ? "Assign" : ""}
            </button>
          }
          anchor={assignees}
          search="Assign someone…"
          empty="No one on the team by that name."
        >
          {me && (
            <MenuCheckboxItem
              icon={<Avatar person={me.member} size={16} />}
              label={`Me ${me.member.name}`}
              shortcut="M"
              checked={card.assigneeIds.includes(me.member.id)}
              onCheckedChange={(on) =>
                act({
                  type: on ? "assign" : "unassign",
                  memberId: me.member.id,
                })
              }
            >
              Me
            </MenuCheckboxItem>
          )}
          {members
            .filter((m) => m.id !== me?.member.id)
            .map((m) => (
              <MenuCheckboxItem
                key={m.id}
                icon={<Avatar person={m} size={16} />}
                label={m.kind === "agent" ? `${m.name} agent` : m.name}
                checked={card.assigneeIds.includes(m.id)}
                onCheckedChange={(on) =>
                  act({ type: on ? "assign" : "unassign", memberId: m.id })
                }
              >
                {m.name}
                {m.kind === "agent" ? " · agent" : ""}
              </MenuCheckboxItem>
            ))}
        </Menu>
      </dd>

      <dt {...stylex.props(styles.fieldLabel)}>Due</dt>
      <dd {...stylex.props(styles.fieldValue)}>
        <DueField
          card={card}
          onChange={(dueOn) => act({ type: "edit", set: { dueOn } })}
        />
      </dd>

      <dt {...stylex.props(styles.fieldLabel)}>Tags</dt>
      <dd {...stylex.props(styles.fieldValue)}>
        <TagEditor
          tags={card.tags}
          onSave={(tags) => act({ type: "edit", set: { tags } })}
        />
      </dd>

      <dt {...stylex.props(styles.fieldLabel)}>Added</dt>
      <dd {...stylex.props(styles.fieldValue, styles.sentence, layout.muted)}>
        {card.createdById && (
          <span {...stylex.props(styles.sentenceIcon)}>
            <Avatar person={byId.get(card.createdById)} size={16} />
          </span>
        )}
        <span title={exactTime(card.createdAt)}>
          {card.createdById
            ? `${byId.get(card.createdById)?.name ?? "Someone"}, `
            : ""}
          {fromNow(card.createdAt)}
        </span>
        {card.source !== "worklog" && <Badge>{card.source}</Badge>}
      </dd>

      <dt {...stylex.props(styles.fieldLabel)}>Activity</dt>
      <dd {...stylex.props(styles.fieldValue, styles.sentence, layout.muted)}>
        <ClockIcon size={13} {...stylex.props(styles.sentenceIcon)} />
        <span title={exactTime(card.lastActiveAt)}>
          Last touched {fromNow(card.lastActiveAt)}
        </span>
      </dd>

      {card.entropy && (
        <>
          <dt {...stylex.props(styles.fieldLabel)}>Drift</dt>
          <dd
            {...stylex.props(
              styles.fieldValue,
              styles.sentence,
              card.entropy.postponingSoon ? styles.warn : layout.muted
            )}
          >
            <ArchiveIcon size={13} {...stylex.props(styles.sentenceIcon)} />
            <span>
              Moves to Not now {fromNow(card.entropy.autoPostponeAt)} unless
              there’s activity
            </span>
          </dd>
        </>
      )}
    </dl>
  );
}

function ColumnDot({ color: name }: { color: string }) {
  return (
    <span
      {...stylex.props(styles.columnDot, styles.columnHue(hueOfColor(name)))}
    />
  );
}

function EditableTitle({
  card,
  onSave,
}: {
  card: CardDetail;
  onSave: (title: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <h2 {...stylex.props(styles.title)}>
        <button
          type="button"
          data-card-edit="title"
          onClick={() => setDraft(card.title)}
          {...stylex.props(styles.titleButton)}
        >
          {card.title}
        </button>
      </h2>
    );
  }
  const save = () => {
    const title = draft.trim();
    if (title && title !== card.title) {
      onSave(title);
    }
    setDraft(null);
  };
  return (
    <Textarea
      autoFocus
      aria-label="Title"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          save();
        }
        if (e.key === "Escape") {
          e.stopPropagation();
          setDraft(null);
        }
      }}
      sx={styles.titleInput}
    />
  );
}

/** Where the card sits in its life: triage asks "where does this go?", active shows the column. */
function StageBar({
  card,
  columns,
  onAct,
  columnColor,
}: {
  card: CardDetail;
  columns: Schemas["Column"][];
  onAct: (action: CardAction) => void;
  columnColor?: string;
}) {
  if (card.stage === "triage") {
    return (
      <div {...stylex.props(styles.stage, styles.stageTriage)}>
        <span {...stylex.props(styles.stageLabel)}>
          Maybe? Where does it go:
        </span>
        {columns.map((c, i) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onAct({ type: "move", columnId: c.id })}
            {...stylex.props(styles.chip)}
          >
            <ColumnDot color={c.color} />
            {c.name}
            {i < DIGITS.length && <Kbd>{String(i + 1)}</Kbd>}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onAct({ type: "later" })}
          {...stylex.props(styles.chip)}
        >
          <HourglassMediumIcon size={12} /> Not now
        </button>
      </div>
    );
  }
  if (card.stage === "done" || card.stage === "not_now") {
    const done = card.stage === "done";
    const at = done ? card.closedAt : card.postponedAt;
    return (
      <div
        {...stylex.props(
          styles.stage,
          done ? styles.stageDone : styles.stageLater
        )}
      >
        {done ? <CheckIcon size={14} /> : <HourglassMediumIcon size={14} />}
        <span>
          {stoppedLabel(card)}
          {at ? ` · ${fromNow(at)}` : ""}
        </span>
        <span {...stylex.props(styles.grow)} />
        <Button
          size="sm"
          variant="ghost"
          icon={<ArrowCounterClockwiseIcon size={13} />}
          onClick={() => onAct({ type: done ? "reopen" : "resume" })}
        >
          {done ? "Reopen" : "Bring back"}
        </Button>
      </div>
    );
  }
  return (
    <div {...stylex.props(styles.stage)}>
      <ColumnDot color={columnColor ?? "gray"} />
      <span {...stylex.props(styles.stageName)}>
        {card.columnName ?? stageLabel(card.stage)}
      </span>
      <span {...stylex.props(styles.grow)} />
      <Button
        size="sm"
        variant="ghost"
        icon={<HourglassMediumIcon size={13} />}
        onClick={() => onAct({ type: "later" })}
      >
        Not now
      </Button>
      <Button
        size="sm"
        icon={<CheckIcon size={13} />}
        onClick={() => onAct({ type: "close" })}
      >
        Done
      </Button>
    </div>
  );
}

function TagEditor({
  tags,
  onSave,
}: {
  tags: string[];
  onSave: (tags: string[]) => void;
}) {
  const known = useKnownTags();
  const row = useRef<HTMLSpanElement>(null);
  const [query, setQuery] = useState("");
  const typed = query.trim().replace(/^#/u, "").replaceAll(/\s+/gu, "-");
  const fresh = typed.toLowerCase();
  const options = [...new Set([...tags, ...known])];
  return (
    <span ref={row} {...stylex.props(styles.tagRow)}>
      <Menu
        anchor={row}
        search="Find or create a tag…"
        empty="No tags yet. Type one to create it."
        onSearchChange={setQuery}
        trigger={
          <button
            type="button"
            data-card-edit="tags"
            {...stylex.props(styles.tagButton)}
          >
            {tags.length > 0 ? (
              tags.map((t) => <span key={t}>#{t}</span>)
            ) : (
              <span {...stylex.props(layout.faint)}>Add tags</span>
            )}
            <PencilSimpleIcon size={11} {...stylex.props(styles.pencil)} />
          </button>
        }
      >
        {options.map((t) => (
          <MenuCheckboxItem
            key={t}
            icon={<HashIcon size={13} />}
            checked={tags.includes(t)}
            onCheckedChange={(on) =>
              onSave(on ? [...tags, t] : tags.filter((x) => x !== t))
            }
          >
            {t}
          </MenuCheckboxItem>
        ))}
        {fresh !== "" && !options.includes(fresh) && (
          <MenuItem
            icon={<PlusIcon size={13} />}
            label={fresh}
            onClick={() => onSave([...tags, fresh])}
          >
            Create #{fresh}
          </MenuItem>
        )}
      </Menu>
    </span>
  );
}

/** The team's tags, most used first, from recent cards: there's no list of tags to ask for. */
function useKnownTags() {
  const recent = useQuery(q.cards({ limit: 100 }));
  const counts = new Map<string, number>();
  for (const card of recent.data ?? []) {
    for (const tag of card.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts].toSorted((a, b) => b[1] - a[1]).map(([tag]) => tag);
}

function Description({
  card,
  onSave,
}: {
  card: CardDetail;
  onSave: (body: string | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const refs = useCardRefs({
    value: draft ?? "",
    onChange: setDraft,
    exclude: card.number,
  });
  if (draft !== null) {
    const save = () => {
      onSave(draft.trim() || null);
      setDraft(null);
    };
    return (
      <div {...stylex.props(styles.descEdit)}>
        <Textarea
          autoFocus
          aria-label="Description"
          value={draft}
          placeholder="Context, links, what done looks like… Markdown works, and # links a card."
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (refs.onKeyDown(e)) {
              return;
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              save();
            }
            if (e.key === "Escape") {
              e.stopPropagation();
              setDraft(null);
            }
          }}
          sx={styles.descArea}
        />
        {refs.list}
        <div {...stylex.props(layout.row)}>
          <span {...stylex.props(layout.meta, layout.grow)}>
            <Kbd>⌘ ↵</Kbd> to save
          </span>
          <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={save}>
            Save
          </Button>
        </div>
      </div>
    );
  }
  return card.body ? (
    <div {...stylex.props(styles.desc)}>
      <Markdown>{card.body}</Markdown>
      <button
        type="button"
        aria-label="Edit description"
        onClick={() => setDraft(card.body ?? "")}
        {...stylex.props(styles.descEditButton)}
      >
        <PencilSimpleIcon size={13} />
      </button>
    </div>
  ) : (
    <button
      type="button"
      onClick={() => setDraft("")}
      {...stylex.props(styles.descEmpty)}
    >
      Add a description…
    </button>
  );
}

type Entry =
  | { kind: "comment"; at: string; comment: Schemas["Comment"] }
  | {
      kind: "activity";
      at: string;
      activity: Schemas["Activity"];
      earlier: Schemas["Activity"][];
    };

/** Comments and what happened to the card, in one thread, oldest first like a conversation. */
function Timeline({ card }: { card: CardDetail }) {
  const { byId } = useMembers();
  const activities = useQuery(
    q.recentActivities({ card: card.number, limit: 50 })
  );
  const entries = useMemo(() => {
    const all: Entry[] = [
      ...card.comments.map((comment) => ({
        kind: "comment" as const,
        at: comment.createdAt,
        comment,
      })),
      ...(activities.data ?? [])
        // Comments come from the card itself, with their full text; skip their activity echo.
        .filter((a) => !a.kind.startsWith("comment."))
        .map((activity) => ({
          kind: "activity" as const,
          at: activity.occurredAt,
          activity,
          earlier: [],
        })),
    ];
    const folded: Entry[] = [];
    for (const entry of all.toSorted(
      (a, b) => Date.parse(a.at) - Date.parse(b.at)
    )) {
      const previous = folded.at(-1);
      if (
        entry.kind === "activity" &&
        previous?.kind === "activity" &&
        sameRun(entry.activity, previous.activity)
      ) {
        folded[folded.length - 1] = {
          ...entry,
          earlier: [previous.activity, ...previous.earlier],
        };
      } else {
        folded.push(entry);
      }
    }
    return folded;
  }, [card.comments, activities.data]);

  return (
    <section {...stylex.props(styles.timeline)} aria-label="History">
      <h3 {...stylex.props(styles.timelineTitle)}>History</h3>
      <ol {...stylex.props(styles.entries)}>
        {entries.map((entry) =>
          entry.kind === "comment" ? (
            <li key={entry.comment.id} {...stylex.props(styles.comment)}>
              <Avatar
                person={
                  entry.comment.authorId
                    ? byId.get(entry.comment.authorId)
                    : null
                }
                size={24}
              />
              <div {...stylex.props(styles.commentBody)}>
                <div {...stylex.props(styles.commentHead)}>
                  <span {...stylex.props(styles.commentAuthor)}>
                    {(entry.comment.authorId &&
                      byId.get(entry.comment.authorId)?.name) ??
                      "Someone"}
                  </span>
                  <span
                    title={exactTime(entry.at)}
                    {...stylex.props(layout.faint)}
                  >
                    {ago(entry.at)}
                  </span>
                </div>
                <Markdown size="label">{entry.comment.body}</Markdown>
              </div>
            </li>
          ) : (
            <li key={entry.activity.id}>
              <ActivityLine
                activity={entry.activity}
                earlier={entry.earlier}
                compact
                hideCard
              />
            </li>
          )
        )}
      </ol>
    </section>
  );
}

function stoppedLabel(card: CardDetail) {
  if (card.stage === "done") {
    return "Done";
  }
  return card.autoPostponed ? "Drifted to Not now" : "Not now";
}

function Composer({ number }: { number: number }) {
  const [body, setBody] = useState("");
  const client = useQueryClient();
  const send = useMutation({
    mutationFn: async () =>
      await unwrap(
        api.POST("/v1/cards/{number}/comments", {
          params: { path: { number } },
          body: { body: body.trim() },
        })
      ),
    onSuccess: () => {
      setBody("");
      void client.invalidateQueries({ queryKey: ["card", number] });
      void client.invalidateQueries({ queryKey: ["cards"] });
    },
    onError: (error) => toast.error(error.message),
  });
  const refs = useCardRefs({ value: body, onChange: setBody, exclude: number });
  const touch = useTouch();
  const before = useRef("");
  const dictation = useDictation((heard) => {
    setBody(before.current ? `${before.current} ${heard}` : heard);
  });
  const submit = () => {
    dictation.cancel();
    if (body.trim() && !send.isPending) {
      send.mutate();
    }
  };
  return (
    <div {...stylex.props(styles.composer)}>
      {refs.list && <div {...stylex.props(styles.refsAbove)}>{refs.list}</div>}
      <Textarea
        aria-label="Comment"
        placeholder={
          touch
            ? "Comment… # links a card"
            : `Comment… # links a card, ${MOD}↵ sends`
        }
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (refs.onKeyDown(e)) {
            return;
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        sx={styles.composerInput}
      />
      <div {...stylex.props(styles.send)}>
        {dictation.supported && (
          <Tooltip label={dictation.listening ? "Stop dictating" : "Dictate"}>
            <Button
              variant={dictation.listening ? "secondary" : "ghost"}
              size="sm"
              aria-label={dictation.listening ? "Stop dictating" : "Dictate"}
              aria-pressed={dictation.listening}
              icon={
                <MicrophoneIcon
                  size={14}
                  weight={dictation.listening ? "fill" : "regular"}
                />
              }
              onClick={() => {
                if (dictation.listening) {
                  dictation.stop();
                } else {
                  before.current = body.trim();
                  dictation.start();
                }
              }}
            />
          </Tooltip>
        )}
        <Button
          variant="primary"
          size="sm"
          onClick={submit}
          busy={send.isPending}
          disabled={!body.trim()}
        >
          Comment
        </Button>
      </div>
    </div>
  );
}

function PinButton({ number }: { number: number }) {
  const pins = usePins();
  const pinned = pins.isPinned(number);
  return (
    <Tooltip label={pinned ? "Unpin" : "Pin to your stack"} shortcut="⇧ P">
      <Button
        variant="ghost"
        size="sm"
        aria-label={pinned ? "Unpin" : "Pin"}
        aria-pressed={pinned}
        icon={<PushPinIcon size={15} weight={pinned ? "fill" : "regular"} />}
        onClick={() => pins.toggle(number)}
        sx={pinned ? styles.toggleOn : undefined}
      />
    </Tooltip>
  );
}

function WatchButton({ card, act }: { card: CardDetail; act: Act }) {
  const me = useMe();
  const watching = me ? card.watcherIds.includes(me.member.id) : false;
  return (
    <Tooltip
      label={watching ? "Stop watching" : "Watch: get told about new comments"}
      shortcut="⇧ N"
    >
      <Button
        variant="ghost"
        size="sm"
        aria-label={watching ? "Stop watching" : "Watch"}
        aria-pressed={watching}
        icon={<EyeIcon size={15} weight={watching ? "fill" : "regular"} />}
        sx={watching ? styles.toggleOn : undefined}
        onClick={() => act({ type: watching ? "unwatch" : "watch" })}
      />
    </Tooltip>
  );
}

function pressCardControl(name: "title" | "tags" | "assign") {
  const control = document.querySelector(
    `[role="dialog"] [data-card-edit="${name}"]`
  );
  if (control instanceof HTMLElement) {
    control.click();
  }
}

function DueField({
  card,
  onChange,
}: {
  card: CardDetail;
  onChange: (dueOn: string | null) => void;
}) {
  return (
    <span {...stylex.props(styles.dateWrap)}>
      <DatePicker
        value={card.dueOn}
        onChange={onChange}
        trigger={
          <button
            type="button"
            aria-label={
              card.dueOn ? `Due ${card.dueOn}. Change` : "Set a due date"
            }
            {...stylex.props(styles.dateButton)}
          >
            {card.dueOn ? (
              <DueChip
                on={card.dueOn}
                done={card.stage === "done" || card.stage === "not_now"}
              />
            ) : (
              <>
                <CalendarBlankIcon size={13} />
                Set a due date
              </>
            )}
          </button>
        }
      />
      {card.dueOn && (
        <button
          type="button"
          aria-label="Clear the due date"
          onClick={() => onChange(null)}
          {...stylex.props(styles.remove)}
        >
          <XIcon size={12} />
        </button>
      )}
    </span>
  );
}

const styles = stylex.create({
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 40,
    backgroundColor:
      "light-dark(oklch(0.2 0.01 80 / 0.12), oklch(0 0 0 / 0.4))",
    transitionProperty: "opacity",
    transitionDuration: motion.base,
    opacity: {
      default: 1,
      ":is([data-starting-style])": 0,
      ":is([data-ending-style])": 0,
    },
  },
  panel: {
    position: "fixed",
    zIndex: 41,
    top: 6,
    right: 6,
    bottom: 6,
    width: "min(600px, calc(100vw - 12px))",
    display: "flex",
    flexDirection: "column",
    borderRadius: 10,
    backgroundColor: color.raised,
    boxShadow: shadow.lift,
    outline: "none",
    overflow: "hidden",
    transitionProperty: "transform, opacity",
    transitionDuration: motion.slow,
    transitionTimingFunction: motion.out,
    transform: {
      default: "translateX(0)",
      ":is([data-starting-style])": "translateX(24px)",
      ":is([data-ending-style])": "translateX(24px)",
    },
    opacity: {
      default: 1,
      ":is([data-starting-style])": 0,
      ":is([data-ending-style])": 0,
    },
  },
  pad: { padding: space.x3 },
  header: {
    display: "flex",
    alignItems: "center",
    gap: space.xs,
    height: 48,
    flexShrink: 0,
    paddingInlineStart: space.xl,
    paddingInlineEnd: space.md,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
  },
  number: {
    fontFamily: font.mono,
    fontSize: text.meta,
    color: color.fgMuted,
    marginInlineEnd: space.sm,
  },
  crumb: { fontSize: text.label, color: color.fgMuted },
  grow: { flexGrow: 1 },
  toggleOn: { color: color.accentFg },
  // Above the composer: it sits at the foot of the panel, so a list below would be cut off.
  refsAbove: {
    position: "absolute",
    insetInline: space.lg,
    bottom: "100%",
    marginBottom: space.xs,
    zIndex: 2,
  },
  goldOn: { color: color.goldFg, backgroundColor: color.goldSubtle },
  scroll: { flexGrow: 1, overflowY: "auto", overscrollBehavior: "contain" },
  content: {
    display: "flex",
    flexDirection: "column",
    gap: space.xl,
    paddingInline: space.xl,
    paddingTop: space.xl,
    paddingBottom: space.x3,
  },
  title: {
    fontSize: text.title,
    lineHeight: leading.title,
    fontWeight: 600,
    letterSpacing: "-0.01em",
  },
  titleButton: {
    textAlign: "left",
    borderRadius: radius.xs,
    cursor: "text",
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.ui },
    },
    boxShadow: {
      default: null,
      ":hover": { default: null, [media.hover]: `0 0 0 4px ${color.ui}` },
    },
  },
  titleInput: {
    minHeight: 0,
    fontSize: text.title,
    lineHeight: leading.title,
    fontWeight: 600,
    resize: "none",
  },
  stage: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.sm,
    minHeight: 40,
    paddingBlock: space.xs,
    paddingInline: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    boxShadow: `inset 0 0 0 1px ${color.line}`,
    fontSize: text.label,
  },
  stageTriage: { backgroundColor: color.violetSubtle, boxShadow: "none" },
  stageDone: {
    color: color.greenFg,
    backgroundColor: color.greenSubtle,
    boxShadow: "none",
  },
  stageLater: { color: color.fgMuted },
  stageLabel: {
    fontWeight: 500,
    color: color.violetFg,
    marginInlineEnd: space.xs,
  },
  stageName: { fontWeight: 500 },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    height: 26,
    paddingInline: space.md,
    borderRadius: radius.full,
    fontSize: text.meta,
    fontWeight: 500,
    color: color.fg,
    backgroundColor: {
      default: color.raised,
      ":hover": { default: null, [media.hover]: color.ui },
    },
    boxShadow: `0 0 0 1px ${color.lineUi}`,
  },
  columnDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  columnHue: (hue: number) => ({
    backgroundColor: hue < 0 ? color.fgFaint : `oklch(0.65 0.15 ${hue})`,
  }),
  fields: {
    display: "grid",
    // Narrower labels on a phone leave the values room for a line instead of a word.
    gridTemplateColumns: {
      default: "96px minmax(0, 1fr)",
      "@media (max-width: 480px)": "72px minmax(0, 1fr)",
    },
    columnGap: space.lg,
    rowGap: space.sm,
    // Top, not centre: a value that wraps (two assignees, the drift note) keeps its label on line one.
    alignItems: "start",
    fontSize: text.label,
  },
  fieldLabel: {
    color: color.fgMuted,
    minHeight: 28,
    display: "flex",
    alignItems: "center",
  },
  fieldValue: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.sm,
    minHeight: 28,
  },
  // A sentence that may wrap keeps its icon on the first line instead of alone above it.
  sentence: { flexWrap: "nowrap", alignItems: "flex-start", paddingTop: 4 },
  sentenceIcon: { display: "flex", flexShrink: 0, marginTop: 3 },
  warn: { color: color.amberFg },
  person: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    height: { default: 26, [media.touch]: 32 },
    paddingInlineStart: 4,
    paddingInlineEnd: 2,
    borderRadius: radius.full,
    backgroundColor: color.ui,
    fontWeight: 500,
  },
  remove: {
    display: "grid",
    placeItems: "center",
    width: { default: 20, [media.touch]: 28 },
    height: { default: 20, [media.touch]: 28 },
    borderRadius: "50%",
    color: {
      default: color.fgFaint,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.uiActive },
    },
  },
  add: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    height: { default: 26, [media.touch]: 32 },
    minWidth: { default: null, [media.touch]: 32 },
    justifyContent: "center",
    paddingInline: space.sm,
    borderRadius: radius.full,
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.ui },
    },
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: color.lineUi,
    fontSize: text.meta,
  },
  dateWrap: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    color: color.fgMuted,
  },
  dateButton: {
    marginInlineStart: `calc(-1 * ${space.xs})`,
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    minHeight: 26,
    paddingInline: space.xs,
    borderRadius: radius.sm,
    fontSize: text.label,
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.ui },
    },
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
  },
  // Fill-less controls among plain values: pull the padding back so the ink keeps the column's edge.
  tagRow: { display: "flex", flexGrow: 1 },
  tagButton: {
    marginInlineStart: `calc(-1 * ${space.xs})`,
    display: "inline-flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.sm,
    minHeight: 26,
    paddingInline: space.xs,
    borderRadius: radius.xs,
    color: color.fgMuted,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.ui },
    },
  },
  pencil: { opacity: 0.5 },
  desc: {
    position: "relative",
    paddingBlock: space.sm,
    paddingInlineEnd: space.x4,
  },
  descEditButton: {
    position: "absolute",
    top: 0,
    right: 0,
    display: "grid",
    placeItems: "center",
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    color: color.fgFaint,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.ui },
    },
  },
  descEmpty: {
    textAlign: "left",
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderRadius: radius.md,
    color: color.fgFaint,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: color.line,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.surface },
    },
  },
  descEdit: { display: "flex", flexDirection: "column", gap: space.md },
  descArea: { minHeight: 140, fontSize: text.copy, lineHeight: leading.copy },
  external: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    fontSize: text.meta,
    color: color.accentFg,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  timeline: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    paddingTop: space.lg,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: color.line,
  },
  timelineTitle: {
    fontSize: text.caption,
    fontWeight: 500,
    color: color.fgFaint,
  },
  entries: { display: "flex", flexDirection: "column", gap: space.md },
  comment: {
    display: "flex",
    gap: space.md,
    paddingBlock: space.xs,
  },
  commentBody: {
    flexGrow: 1,
    minWidth: 0,
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    boxShadow: `inset 0 0 0 1px ${color.line}`,
  },
  commentHead: {
    display: "flex",
    alignItems: "baseline",
    gap: space.md,
    marginBottom: space.xs,
    fontSize: text.meta,
  },
  commentAuthor: { fontWeight: 600, color: color.fg },
  composer: {
    position: "relative",
    flexShrink: 0,
    padding: space.lg,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: color.line,
    backgroundColor: color.surface,
  },
  composerInput: {
    minHeight: 64,
    paddingBottom: 40,
    backgroundColor: color.raised,
  },
  send: {
    position: "absolute",
    right: 22,
    bottom: 22,
    display: "flex",
    alignItems: "center",
    gap: space.xs,
  },
});
