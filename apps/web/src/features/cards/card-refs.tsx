import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import type { KeyboardEvent } from "react";
import { useState } from "react";

import { q } from "#api/queries";
import { color, font, radius, shadow, space, text } from "#ui/tokens.stylex";

import { stageLabel } from "./card-bits";
import type { Card } from "./card-bits";

// "#" then a number or a word, at the end of what's typed: the reference being written.
const TRIGGER = /(?:^|\s)#(?<query>[\p{L}\p{N}]*)$/u;
const SHOWN = 6;

/**
 * Fizzy's card links: type # in a comment or description, pick a card by number or title, and
 * "#8" goes in, which every Markdown view renders as a link to the card.
 */
export function useCardRefs({
  value,
  onChange,
  exclude,
}: {
  value: string;
  onChange: (next: string) => void;
  exclude?: number;
}) {
  const query = TRIGGER.exec(value)?.groups?.query;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const recent = useQuery({
    ...q.cards({ limit: 100 }),
    enabled: query !== undefined,
  });
  const open = query !== undefined && dismissed !== value;
  const matches = open ? match(recent.data ?? [], query, exclude) : [];
  const active = Math.min(index, Math.max(0, matches.length - 1));

  const pick = (card: Card) => {
    onChange(
      value.replace(TRIGGER, (whole) => {
        const lead = whole.startsWith("#") ? "" : whole[0];
        return `${lead}#${card.number} `;
      })
    );
    setIndex(0);
  };

  /** Returns true when the key was the picker's, so the textarea's own handler can skip it. */
  const onKeyDown = (event: KeyboardEvent) => {
    if (matches.length === 0) {
      return false;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setIndex((active + step + matches.length) % matches.length);
      return true;
    }
    const chosen = matches[active];
    if ((event.key === "Enter" || event.key === "Tab") && chosen) {
      event.preventDefault();
      pick(chosen);
      return true;
    }
    if (event.key === "Escape") {
      // Closes the list, not the panel or the editor around it.
      event.preventDefault();
      event.stopPropagation();
      setDismissed(value);
      return true;
    }
    return false;
  };

  const list =
    matches.length > 0 ? (
      <ul aria-label="Link a card" {...stylex.props(styles.list)}>
        {matches.map((card, i) => (
          <li key={card.id}>
            <button
              type="button"
              // Keeps focus in the textarea, so typing carries on after a click.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(card)}
              {...stylex.props(styles.option, i === active && styles.active)}
            >
              <span {...stylex.props(styles.number)}>#{card.number}</span>
              <span {...stylex.props(styles.title)}>{card.title}</span>
              <span {...stylex.props(styles.stage)}>
                {card.stage === "active"
                  ? (card.columnName ?? "Active")
                  : stageLabel(card.stage)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    ) : null;

  return { list, onKeyDown };
}

function match(cards: Card[], query: string, exclude?: number) {
  const term = query.toLowerCase();
  const candidates = cards.filter((c) => c.number !== exclude);
  if (term === "") {
    return candidates.slice(0, SHOWN);
  }
  if (/^\d+$/u.test(term)) {
    // "#1" means card 1 before 14, 15 and 18: Enter should insert what was typed.
    return candidates
      .filter((c) => String(c.number).startsWith(term))
      .toSorted((a, b) => a.number - b.number)
      .slice(0, SHOWN);
  }
  return candidates
    .filter((c) => c.title.toLowerCase().includes(term))
    .slice(0, SHOWN);
}

const styles = stylex.create({
  list: {
    display: "flex",
    flexDirection: "column",
    padding: space.xs,
    borderRadius: radius.md,
    backgroundColor: color.raised,
    boxShadow: shadow.float,
  },
  option: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    width: "100%",
    minHeight: 32,
    paddingInline: space.sm,
    borderRadius: radius.sm,
    textAlign: "start",
    color: color.fg,
  },
  active: { backgroundColor: color.ui },
  number: {
    flexShrink: 0,
    minWidth: 26,
    fontFamily: font.mono,
    fontSize: 11.5,
    color: color.fgFaint,
  },
  title: {
    flexGrow: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: text.label,
  },
  stage: { flexShrink: 0, fontSize: text.caption, color: color.fgMuted },
});
