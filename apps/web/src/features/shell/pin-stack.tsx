import { PushPinIcon, PushPinSlashIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useQueries } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { q } from "#api/queries";
import { STAGE_TONE } from "#features/cards/card-bits";
import type { Card } from "#features/cards/card-bits";
import { usePins } from "#features/cards/pins";
import type { Tone } from "#ui/chip";
import {
  color,
  font,
  media,
  radius,
  shadow,
  space,
  text,
} from "#ui/tokens.stylex";

// Sonner's stack, sized for a sidebar: rows are one line tall, so no heights need measuring.
const ROW = 36;
const GAP = 6;
const PEEK = 7;
const LAYERS = 3;
const LEAVE_MS = 200;

// When the stack first appeared: rows there from the start sit still, only new pins slide in.
let shownSince = Number.POSITIVE_INFINITY;

/**
 * Fizzy's pin stack, stacked the way Sonner stacks toasts: the newest pin in front, two more
 * peeking out behind it, and the whole pile fanning out into a list on hover, focus or P.
 */
export function PinStack() {
  const { pins, toggle } = usePins();
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const cards = useQueries({ queries: pins.map((n) => q.card(n)) });
  useEffect(() => {
    shownSince = Math.min(shownSince, Date.now());
  }, []);

  useHotkey(
    "P",
    () => {
      setExpanded((open) => !open);
      rootRef.current?.querySelector<HTMLElement>("a")?.focus();
    },
    {
      enabled: pins.length > 0,
      meta: { name: "Pinned cards", group: "General" },
    }
  );

  if (pins.length === 0) {
    return null;
  }
  const layers = Math.min(pins.length, LAYERS);

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- hover and focus only fan the pile out; every action is a link or button inside, and P opens it from the keyboard
    <section
      ref={rootRef}
      aria-label={`Pinned cards, ${pins.length}`}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") {
          setExpanded(true);
        }
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") {
          setExpanded(false);
        }
      }}
      onFocus={(e) => {
        // Keyboard focus only: a tap focuses too, and would open the pile and the card at once.
        if (e.target.matches(":focus-visible")) {
          setExpanded(true);
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setExpanded(false);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && expanded) {
          e.stopPropagation();
          setExpanded(false);
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
        }
      }}
      {...stylex.props(styles.dock, styles.height(ROW + PEEK * (layers - 1)))}
    >
      {/* Keeps the pointer "inside" while it crosses the gaps between fanned-out rows. */}
      {expanded && (
        <div
          aria-hidden
          {...stylex.props(
            styles.bridge,
            styles.height(pins.length * (ROW + GAP))
          )}
        />
      )}
      <ol {...stylex.props(styles.list)}>
        {pins.map((number, index) => (
          <PinRow
            key={number}
            number={number}
            card={cards[index]?.data}
            index={index}
            total={pins.length}
            expanded={expanded}
            onExpand={() => setExpanded(true)}
            onUnpin={() => toggle(number)}
          />
        ))}
      </ol>
    </section>
  );
}

function PinRow({
  number,
  card,
  index,
  total,
  expanded,
  onExpand,
  onUnpin,
}: {
  number: number;
  card: Card | undefined;
  index: number;
  total: number;
  expanded: boolean;
  onExpand: () => void;
  onUnpin: () => void;
}) {
  // Mounts below its place and slides up on the next frame, like a toast arriving.
  const [mounted, setMounted] = useState(() => Date.now() - shownSince < 1000);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const frame = mounted ? 0 : requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, [mounted]);
  useEffect(() => {
    const timer = leaving ? setTimeout(onUnpin, LEAVE_MS) : undefined;
    return () => clearTimeout(timer);
  }, [leaving, onUnpin]);

  const front = index === 0;
  const { y, scale } = placement({ index, expanded, mounted });
  const shown = mounted && !leaving && (expanded || index < LAYERS);

  return (
    <li
      aria-hidden={!expanded && !front}
      {...stylex.props(
        styles.row,
        styles.place(y, scale, total - index, shown ? 1 : 0),
        leaving && styles.leaving,
        front || expanded ? styles.reachable : styles.unreachable
      )}
    >
      <Link
        to="."
        search={(prev: Record<string, unknown>) => ({ ...prev, card: number })}
        tabIndex={front || expanded ? 0 : -1}
        onClick={(e) => {
          // On a touch screen there's no hover: the first tap opens the pile, the next picks a card.
          if (!expanded) {
            e.preventDefault();
            onExpand();
          }
        }}
        {...stylex.props(styles.link, !expanded && !front && styles.muted)}
      >
        <RowFace
          number={number}
          card={card}
          lead={front && !expanded}
          total={total}
        />
      </Link>
      {expanded && (
        <button
          type="button"
          aria-label={`Unpin #${number}`}
          onClick={() => setLeaving(true)}
          {...stylex.props(styles.unpin)}
        >
          <PushPinSlashIcon size={13} />
        </button>
      )}
    </li>
  );
}

/** Where a row sits: fanned out into a list, or tucked into the pile with the back rows peeking. */
function placement({
  index,
  expanded,
  mounted,
}: {
  index: number;
  expanded: boolean;
  mounted: boolean;
}) {
  if (!mounted) {
    return { y: ROW, scale: 1 };
  }
  if (expanded) {
    return { y: -(ROW + GAP) * index, scale: 1 };
  }
  const depth = Math.min(index, LAYERS - 1);
  return { y: -PEEK * depth, scale: 1 - 0.05 * depth };
}

/** The pile's top row carries the pin and the count; every other row shows its stage. */
function RowFace({
  number,
  card,
  lead,
  total,
}: {
  number: number;
  card: Card | undefined;
  lead: boolean;
  total: number;
}) {
  const tone: Tone = card ? STAGE_TONE[card.stage] : "neutral";
  return (
    <>
      {lead ? (
        <PushPinIcon size={13} weight="fill" {...stylex.props(styles.pin)} />
      ) : (
        <span aria-hidden {...stylex.props(styles.stage, stages[tone])} />
      )}
      <span {...stylex.props(styles.number)}>#{number}</span>
      <span {...stylex.props(styles.title)}>{card?.title ?? ""}</span>
      {lead && total > 1 && (
        <span {...stylex.props(styles.count)}>{total}</span>
      )}
    </>
  );
}

const styles = stylex.create({
  // The pile keeps its collapsed height in the sidebar; fanned out, it rises over the nav above
  // it, the way Sonner's toasts rise over the page.
  dock: {
    position: "relative",
    marginTop: space.lg,
    marginInline: space.xs,
    marginBottom: space.sm,
  },
  height: (px: number) => ({ height: px }),
  bridge: { position: "absolute", insetInline: 0, bottom: 0 },
  list: { position: "absolute", inset: 0 },
  row: {
    position: "absolute",
    insetInline: 0,
    bottom: 0,
    height: ROW,
    display: "flex",
    alignItems: "center",
    borderRadius: radius.md,
    backgroundColor: color.raised,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.line,
    boxShadow: shadow.card,
    // Scaling from the top keeps the sliver that peeks out above the front row the same height.
    transformOrigin: "center top",
    transitionProperty: {
      default: "transform, opacity",
      "@media (prefers-reduced-motion: reduce)": "opacity",
    },
    transitionDuration: "400ms",
    transitionTimingFunction: "cubic-bezier(0.21, 1.02, 0.73, 1)",
  },
  place: (y: number, scale: number, z: number, opacity: number) => ({
    transform: `translateY(${y}px) scale(${scale})`,
    zIndex: z,
    opacity,
  }),
  leaving: { transitionDuration: `${LEAVE_MS}ms` },
  reachable: { pointerEvents: "auto" },
  unreachable: { pointerEvents: "none" },
  link: {
    flexGrow: 1,
    minWidth: 0,
    height: "100%",
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    paddingInline: space.md,
    borderRadius: radius.md,
    color: color.fg,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.ui },
    },
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
    outlineOffset: -2,
  },
  // Behind the front row only a sliver shows; text there would be clipped noise.
  muted: { opacity: 0 },
  pin: { flexShrink: 0, color: color.accentFg },
  stage: {
    flexShrink: 0,
    width: 7,
    height: 7,
    marginInline: 3,
    borderRadius: radius.full,
  },
  number: {
    flexShrink: 0,
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
    fontSize: text.meta,
    fontWeight: 500,
  },
  count: {
    flexShrink: 0,
    minWidth: 18,
    height: 18,
    paddingInline: 5,
    borderRadius: radius.full,
    fontSize: text.caption,
    fontWeight: 600,
    lineHeight: "18px",
    textAlign: "center",
    color: color.fgOnSolid,
    backgroundColor: color.accent,
  },
  unpin: {
    flexShrink: 0,
    display: "grid",
    placeItems: "center",
    width: 28,
    height: 28,
    marginInlineEnd: space.xs,
    borderRadius: radius.sm,
    color: {
      default: color.fgFaint,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.ui },
    },
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
  },
});

const stages = stylex.create({
  neutral: { backgroundColor: color.lineStrong },
  accent: { backgroundColor: color.accent },
  gold: { backgroundColor: color.gold },
  green: { backgroundColor: color.green },
  amber: { backgroundColor: color.amber },
  red: { backgroundColor: color.red },
  violet: { backgroundColor: color.violet },
  blue: { backgroundColor: color.blue },
});
