import {
  ArrowElbowDownLeftIcon,
  CardsIcon,
  ChatsCircleIcon,
  GearIcon,
  HouseIcon,
  KanbanIcon,
  KeyboardIcon,
  MoonIcon,
  NewspaperIcon,
  NotePencilIcon,
  PlusIcon,
  PulseIcon,
  SignOutIcon,
  SunIcon,
  TrayIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { q } from "#api/queries";
import { signOut } from "#features/auth/session";
import { setTheme } from "#lib/theme";
import { Avatar } from "#ui/avatar";
import { Kbd } from "#ui/chip";
import {
  color,
  font,
  leading,
  radius,
  shadow,
  space,
  text,
} from "#ui/tokens.stylex";

import type { ShellDialog } from "./shell";

/**
 * ⌘K reaches every page, board, person and card, and every create action. It never animates:
 * it's opened hundreds of times a day, and motion there only adds delay.
 */
export function CommandPalette({
  open,
  onClose,
  onOpen,
}: {
  open: boolean;
  onClose: () => void;
  onOpen: (dialog: ShellDialog) => void;
}) {
  const [search, setSearch] = useState("");
  const [term] = useDebouncedValue(search.trim(), { wait: 150 });
  const navigate = useNavigate();
  const client = useQueryClient();
  const boards = useQuery({ ...q.boards(), enabled: open });
  const members = useQuery({ ...q.members(), enabled: open });
  const searching = term.length >= 2;
  const found = useQuery({
    ...q.cards({ q: term, limit: 8 }),
    enabled: open && searching,
  });
  // Before anything is typed, the cards moving most recently are the likeliest destination.
  const recent = useQuery({
    ...q.cards({ stage: "active", limit: 6 }),
    enabled: open && !searching,
  });
  const cards = searching ? found : recent;
  // A number opens that card at once: any page can show a card over itself, so there's
  // nothing to wait for, and Enter can't fall through to "Ask" while the search loads.
  const typed = cardNumberIn(search);
  const { numbered, listed } = splitOut(cards.data, typed);
  // When results arrive, light the row shown first. cmdk keeps the old highlight while the list
  // re-sorts under it, so Enter would open whatever was picked from the instant list. A frame
  // later the DOM is in cmdk's sorted order.
  const [selected, setSelected] = useState("");
  const loadedAt = found.dataUpdatedAt;
  useEffect(() => {
    let frame: number | undefined;
    if (open && loadedAt > 0) {
      frame = requestAnimationFrame(() => {
        const first = document.querySelector<HTMLElement>(
          "[cmdk-list] [cmdk-item]"
        );
        if (first?.dataset.value !== undefined) {
          setSelected(first.dataset.value);
        }
      });
    }
    return () => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
    };
  }, [open, loadedAt]);

  const close = () => {
    setSearch("");
    onClose();
  };
  const run = (action: () => unknown) => () => {
    close();
    void action();
  };
  const go = (to: string, params?: Record<string, string>) =>
    run(async () => await navigate({ to, params }));

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          close();
        }
      }}
      label="Command menu"
      value={selected}
      onValueChange={setSelected}
      loop
      overlayClassName={stylex.props(styles.overlay).className}
      contentClassName={stylex.props(styles.content).className}
    >
      <Command.Input
        value={search}
        onValueChange={setSearch}
        placeholder="Search cards, people, pages… or ask your assistant"
        {...stylex.props(styles.input)}
      />
      <Command.List {...stylex.props(styles.list)}>
        <Command.Empty {...stylex.props(styles.empty)}>
          Nothing matches. Press ↵ to ask your assistant.
        </Command.Empty>

        {typed !== undefined && (
          <Command.Group heading="Cards" {...stylex.props(styles.group)}>
            <Item
              value={cardValue(typed)}
              icon={<span {...stylex.props(styles.number)}>#{typed}</span>}
              onSelect={run(
                async () =>
                  await navigate({
                    to: ".",
                    search: (prev: Record<string, unknown>) => ({
                      ...prev,
                      card: typed,
                    }),
                  })
              )}
              hint={<ArrowElbowDownLeftIcon size={13} />}
            >
              {numbered?.title ?? `Open card #${typed}`}
            </Item>
          </Command.Group>
        )}

        {listed.length > 0 && (
          <Command.Group
            heading={searching ? "Cards" : "Recently active"}
            {...stylex.props(styles.group)}
          >
            {listed.map((card) => (
              <Item
                key={card.id}
                value={cardValue(card.number, card.title)}
                icon={
                  <span {...stylex.props(styles.number)}>#{card.number}</span>
                }
                onSelect={run(
                  async () =>
                    await navigate({
                      to: "/boards/$boardId",
                      params: { boardId: card.boardId },
                      search: { card: card.number },
                    })
                )}
              >
                {card.title}
              </Item>
            ))}
          </Command.Group>
        )}

        <Command.Group heading="Go to" {...stylex.props(styles.group)}>
          <Item
            icon={<HouseIcon size={15} />}
            onSelect={go("/home")}
            hint={<Kbd>G H</Kbd>}
          >
            Home
          </Item>
          <Item
            icon={<TrayIcon size={15} />}
            onSelect={go("/inbox")}
            hint={<Kbd>G I</Kbd>}
          >
            Inbox
          </Item>
          <Item
            icon={<CardsIcon size={15} />}
            onSelect={go("/mine")}
            hint={<Kbd>G M</Kbd>}
          >
            My cards
          </Item>
          <Item
            icon={<PulseIcon size={15} />}
            onSelect={go("/activity")}
            hint={<Kbd>G A</Kbd>}
          >
            Activity
          </Item>
          <Item
            icon={<ChatsCircleIcon size={15} />}
            onSelect={go("/assistant")}
            hint={<Kbd>G C</Kbd>}
          >
            Assistant
          </Item>
          <Item
            icon={<NewspaperIcon size={15} />}
            onSelect={go("/briefs")}
            hint={<Kbd>G R</Kbd>}
          >
            Briefs
          </Item>
          <Item
            icon={<UsersIcon size={15} />}
            onSelect={go("/people")}
            hint={<Kbd>G P</Kbd>}
          >
            People
          </Item>
          <Item
            icon={<GearIcon size={15} />}
            onSelect={go("/settings")}
            hint={<Kbd>G S</Kbd>}
          >
            Settings
          </Item>
        </Command.Group>

        {(boards.data?.length ?? 0) > 0 && (
          <Command.Group heading="Boards" {...stylex.props(styles.group)}>
            {boards.data?.map((board) => (
              <Item
                key={board.id}
                value={`board ${board.name}`}
                icon={<KanbanIcon size={15} />}
                onSelect={go("/boards/$boardId", { boardId: board.id })}
              >
                {board.name}
              </Item>
            ))}
          </Command.Group>
        )}

        <ConversationResults
          search={search}
          onPick={(id) =>
            go("/assistant/$conversationId", { conversationId: id })()
          }
        />

        {(members.data?.length ?? 0) > 0 && (
          <Command.Group
            heading="People and agents"
            {...stylex.props(styles.group)}
          >
            {members.data?.map((m) => (
              <Item
                key={m.id}
                value={`person ${m.name} ${m.handle}`}
                icon={<Avatar person={m} size={18} />}
                onSelect={go("/people/$handle", { handle: m.handle })}
                hint={<span {...stylex.props(styles.handle)}>@{m.handle}</span>}
              >
                {m.name}
              </Item>
            ))}
          </Command.Group>
        )}

        <Command.Group heading="Actions" {...stylex.props(styles.group)}>
          <Item
            icon={<PlusIcon size={15} />}
            onSelect={run(() => onOpen("card"))}
            hint={<Kbd>C</Kbd>}
          >
            New card
          </Item>
          <Item
            icon={<NotePencilIcon size={15} />}
            onSelect={run(() => onOpen("log"))}
            hint={<Kbd>L</Kbd>}
          >
            Log work
          </Item>
          <Item
            icon={<KeyboardIcon size={15} />}
            onSelect={run(() => onOpen("shortcuts"))}
            hint={<Kbd>?</Kbd>}
          >
            Keyboard shortcuts
          </Item>
          <Item
            icon={<SunIcon size={15} />}
            onSelect={run(() => setTheme("light"))}
          >
            Light theme
          </Item>
          <Item
            icon={<MoonIcon size={15} />}
            onSelect={run(() => setTheme("dark"))}
          >
            Dark theme
          </Item>
          <Item
            icon={<SignOutIcon size={15} />}
            onSelect={run(async () => {
              await signOut(client);
              await navigate({ to: "/login" });
            })}
          >
            Sign out
          </Item>
        </Command.Group>

        {search.trim().length > 0 && (
          <Command.Group heading="Assistant" {...stylex.props(styles.group)}>
            <Item
              value={`ask ${search}`}
              icon={<ChatsCircleIcon size={15} />}
              onSelect={run(
                async () =>
                  await navigate({
                    to: "/assistant",
                    search: { ask: search.trim() },
                  })
              )}
              hint={<ArrowElbowDownLeftIcon size={13} />}
            >
              Ask: <span {...stylex.props(styles.quote)}>{search.trim()}</span>
            </Item>
          </Command.Group>
        )}
      </Command.List>
      <footer {...stylex.props(styles.footer)}>
        <span {...stylex.props(styles.footerKey)}>
          <Kbd>↑ ↓</Kbd> move
        </span>
        <span {...stylex.props(styles.footerKey)}>
          <Kbd>↵</Kbd> open
        </span>
        <span {...stylex.props(styles.footerKey)}>
          <Kbd>Esc</Kbd> close
        </span>
      </footer>
    </Command.Dialog>
  );
}

function Item({
  icon,
  children,
  hint,
  onSelect,
  value,
}: {
  icon: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  onSelect: () => void;
  value?: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      {...stylex.props(styles.item)}
    >
      <span {...stylex.props(styles.icon)}>{icon}</span>
      <span {...stylex.props(styles.label)}>{children}</span>
      {hint !== undefined && <span {...stylex.props(styles.hint)}>{hint}</span>}
    </Command.Item>
  );
}

function cardNumberIn(search: string) {
  const digits = /^#?(?<n>\d{1,9})$/u.exec(search.trim())?.groups?.n;
  return digits === undefined ? undefined : Number(digits);
}

function cardValue(number: number, title = "open") {
  return `card ${number} ${title}`;
}

/** Past conversations, matched only against what's typed: unasked, they'd crowd out the pages. */
function ConversationResults({
  search,
  onPick,
}: {
  search: string;
  onPick: (id: string) => void;
}) {
  const typed = search.trim().length > 0;
  const conversations = useQuery({ ...q.conversations(), enabled: typed });
  if (!typed || (conversations.data?.length ?? 0) === 0) {
    return null;
  }
  return (
    <Command.Group heading="Conversations" {...stylex.props(styles.group)}>
      {conversations.data?.slice(0, 50).map((c) => (
        <Item
          key={c.id}
          value={`conversation ${c.title ?? ""}`}
          icon={<ChatsCircleIcon size={15} />}
          onSelect={() => onPick(c.id)}
        >
          {c.title ?? "New conversation"}
        </Item>
      ))}
    </Command.Group>
  );
}

function splitOut<T extends { number: number }>(
  cards: T[] | undefined,
  number: number | undefined
) {
  const numbered = cards?.find((c) => c.number === number);
  return { numbered, listed: (cards ?? []).filter((c) => c !== numbered) };
}

const styles = stylex.create({
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 60,
    backgroundColor: color.scrim,
  },
  content: {
    position: "fixed",
    zIndex: 61,
    top: "14vh",
    left: "50%",
    translate: "-50% 0",
    width: "min(640px, calc(100vw - 32px))",
    borderRadius: radius.lg,
    backgroundColor: color.raised,
    boxShadow: shadow.lift,
    overflow: "hidden",
    outline: "none",
  },
  input: {
    width: "100%",
    height: 52,
    paddingInline: space.xl,
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
    backgroundColor: "transparent",
    fontSize: text.copy,
    outline: "none",
    "::placeholder": { color: color.fgFaint },
  },
  list: {
    maxHeight: "min(420px, 60vh)",
    overflowY: "auto",
    padding: space.sm,
    scrollPaddingBlock: space.sm,
  },
  footer: {
    display: {
      default: "flex",
      "@media (hover: none) and (pointer: coarse)": "none",
    },
    gap: space.lg,
    paddingBlock: space.sm,
    paddingInline: space.lg,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: color.line,
    backgroundColor: color.surface,
    fontSize: text.meta,
    color: color.fgFaint,
  },
  footerKey: { display: "inline-flex", alignItems: "center", gap: space.xs },
  empty: {
    paddingBlock: space.x3,
    textAlign: "center",
    fontSize: text.label,
    color: color.fgMuted,
  },
  group: {
    ":is(*) [cmdk-group-heading]": {
      paddingInline: space.md,
      paddingTop: space.md,
      paddingBottom: space.xs,
      fontSize: text.caption,
      fontWeight: 500,
      color: color.fgFaint,
    },
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    height: 36,
    paddingInline: space.md,
    borderRadius: radius.sm,
    fontSize: text.label,
    lineHeight: leading.label,
    color: color.fg,
    cursor: "default",
    userSelect: "none",
    backgroundColor: {
      default: "transparent",
      ":is([data-selected=true])": color.uiHover,
    },
  },
  icon: {
    display: "grid",
    placeItems: "center",
    width: 20,
    color: color.fgMuted,
    flexShrink: 0,
  },
  label: {
    flexGrow: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  hint: { color: color.fgFaint, display: "flex", alignItems: "center" },
  quote: { color: color.fgMuted },
  number: {
    fontFamily: font.mono,
    fontSize: 11,
    color: color.fgFaint,
  },
  handle: { fontSize: text.meta },
});
