import { CardsIcon, TicketIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { q } from "#api/queries";
import { ago, exactTime } from "#lib/time";
import { AvatarStack } from "#ui/avatar";
import { Badge } from "#ui/chip";
import { EmptyState, ErrorNote, Skeleton } from "#ui/feedback";
import { Segmented } from "#ui/field";
import { Page, PageHeader } from "#ui/layout";
import {
  color,
  font,
  leading,
  media,
  radius,
  space,
  text,
} from "#ui/tokens.stylex";

import { DueChip, STAGE_TONE, stageLabel, useMembers } from "./card-bits";
import type { Card } from "./card-bits";

export type MineTab = "assigned" | "added";

// Done cards are history; the page is for what's still yours to move.
const OPEN_ORDER: Record<Card["stage"], number> = {
  active: 0,
  triage: 1,
  not_now: 2,
  done: 3,
};

/**
 * Fizzy's "Assigned to me" and "Added by me" (keys 2 and 3): every open card of yours across
 * boards, grouped by board, golden tickets first.
 */
export function MyCards({ tab }: { tab: MineTab }) {
  const navigate = useNavigate();
  const cards = useQuery(
    q.cards(
      tab === "assigned"
        ? { assignee: "me", limit: 500 }
        : { addedBy: "me", limit: 500 }
    )
  );
  const boards = useQuery(q.boards());
  const cardList = cards.data;
  const boardList = boards.data;
  const groups = useMemo(() => {
    const open = (cardList ?? [])
      .filter((c) => c.stage !== "done")
      .toSorted(
        (a, b) =>
          Number(b.golden) - Number(a.golden) ||
          OPEN_ORDER[a.stage] - OPEN_ORDER[b.stage] ||
          Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt)
      );
    const byBoard = new Map<string, Card[]>();
    for (const card of open) {
      byBoard.set(card.boardId, [...(byBoard.get(card.boardId) ?? []), card]);
    }
    return [...byBoard.entries()].map(([boardId, list]) => ({
      boardId,
      name: boardList?.find((b) => b.id === boardId)?.name ?? "Board",
      list,
    }));
  }, [cardList, boardList]);
  const count = groups.reduce((n, g) => n + g.list.length, 0);

  return (
    <>
      <PageHeader
        title="My cards"
        icon={<CardsIcon size={16} />}
        subtitle={cards.isSuccess ? `${count} open` : undefined}
        actions={
          <Segmented
            label="Whose"
            value={tab}
            onChange={(next) => {
              void navigate({
                to: "/mine",
                search: { tab: next === "added" ? "added" : undefined },
              });
            }}
            options={[
              { value: "assigned", label: "Assigned to me" },
              { value: "added", label: "Added by me" },
            ]}
          />
        }
      />
      <Page width="reading">
        {cards.isPending && <Skeleton lines={8} height={36} />}
        {cards.isError && <ErrorNote error={cards.error} />}
        {cards.isSuccess && count === 0 && (
          <EmptyState icon={<CardsIcon size={20} />} title="Nothing open">
            {tab === "assigned"
              ? "Cards assigned to you show up here. Press M on a card to take it."
              : "Cards you add show up here until they're done. Press C to add one."}
          </EmptyState>
        )}
        {groups.map((group) => (
          <section
            key={group.boardId}
            aria-label={group.name}
            {...stylex.props(styles.group)}
          >
            <Link
              to="/boards/$boardId"
              params={{ boardId: group.boardId }}
              {...stylex.props(styles.groupTitle)}
            >
              {group.name}
              <span {...stylex.props(styles.groupCount)}>
                {group.list.length}
              </span>
            </Link>
            <ul {...stylex.props(styles.list)}>
              {group.list.map((card) => (
                <li key={card.id}>
                  <CardRow card={card} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </Page>
    </>
  );
}

function CardRow({ card }: { card: Card }) {
  const { byId } = useMembers();
  const people = card.assigneeIds
    .map((id) => byId.get(id))
    .filter((m) => m !== undefined);
  return (
    <Link
      to="."
      search={(prev: Record<string, unknown>) => ({
        ...prev,
        card: card.number,
      })}
      {...stylex.props(styles.row)}
    >
      <span {...stylex.props(styles.number)}>#{card.number}</span>
      {card.golden && <TicketIcon size={13} {...stylex.props(styles.gold)} />}
      <span {...stylex.props(styles.title)}>{card.title}</span>
      {card.dueOn && <DueChip on={card.dueOn} done={false} />}
      <Badge tone={STAGE_TONE[card.stage]}>
        {card.stage === "active"
          ? (card.columnName ?? "Active")
          : stageLabel(card.stage)}
      </Badge>
      {/* A fixed slot, so stage badges line up whether a card has one person or three. */}
      <span {...stylex.props(styles.people)}>
        {people.length > 0 && <AvatarStack people={people} size={18} />}
      </span>
      <time title={exactTime(card.lastActiveAt)} {...stylex.props(styles.time)}>
        {ago(card.lastActiveAt)}
      </time>
    </Link>
  );
}

const styles = stylex.create({
  group: { display: "flex", flexDirection: "column", gap: space.sm },
  groupTitle: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    alignSelf: "flex-start",
    fontSize: text.label,
    fontWeight: 600,
    color: {
      default: color.fg,
      ":hover": { default: null, [media.hover]: color.accentFg },
    },
    marginTop: space.xl,
  },
  groupCount: { fontSize: text.meta, fontWeight: 400, color: color.fgFaint },
  list: {
    display: "flex",
    flexDirection: "column",
    borderRadius: radius.md,
    boxShadow: `inset 0 0 0 1px ${color.line}`,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    minHeight: 44,
    paddingInline: space.lg,
    color: color.fg,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: { default: color.line, ":first-child": "transparent" },
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.surface },
    },
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
    outlineOffset: -2,
  },
  number: {
    flexShrink: 0,
    minWidth: 28,
    fontFamily: font.mono,
    fontSize: 11.5,
    color: color.fgFaint,
  },
  gold: { flexShrink: 0, color: color.goldFg },
  title: {
    flexGrow: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: text.label,
    lineHeight: leading.label,
    fontWeight: 500,
  },
  people: {
    flexShrink: 0,
    display: "flex",
    justifyContent: "flex-end",
    width: 48,
  },
  time: {
    flexShrink: 0,
    minWidth: 24,
    textAlign: "end",
    fontSize: text.meta,
    color: color.fgFaint,
    fontVariantNumeric: "tabular-nums",
  },
});
