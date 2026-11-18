import { Popover as BasePopover } from "@base-ui/react/popover";
import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { q } from "#api/queries";
import { ago } from "#lib/time";
import { AvatarStack } from "#ui/avatar";
import { Dot } from "#ui/chip";
import { surface } from "#ui/overlay";
import { color, font, leading, radius, space, text } from "#ui/tokens.stylex";

import { CardRun, STAGE_TONE, stageLabel, useMembers } from "./card-bits";

const OPEN_MS = 450;
const CLOSE_MS = 160;

/**
 * Pointing at a card link ("#8" in a reply, a brief or a comment) shows the card without leaving
 * the page: its title, where it stands, who has it and when it last moved. Mounted once in the
 * shell, it watches every `a[data-card]` the Markdown renders. Touch screens skip it: a tap opens
 * the card itself.
 */
export function CardPreviews() {
  const [shown, setShown] = useState<{
    anchor: Element;
    number: number;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const later = (fn: () => void, ms: number) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(fn, ms);
    };
    const over = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-card-preview]")) {
        clearTimeout(timer.current);
        return;
      }
      const link = target?.closest("a[data-card]");
      const number =
        link instanceof HTMLElement ? Number(link.dataset.card) : Number.NaN;
      if (link && number > 0) {
        later(() => setShown({ anchor: link, number }), OPEN_MS);
      } else {
        later(() => setShown(null), CLOSE_MS);
      }
    };
    const pointing = matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (pointing) {
      document.addEventListener("pointerover", over);
    }
    return () => {
      document.removeEventListener("pointerover", over);
      clearTimeout(timer.current);
    };
  }, []);

  return (
    <BasePopover.Root
      open={shown !== null}
      onOpenChange={(open) => {
        if (!open) {
          setShown(null);
        }
      }}
    >
      <BasePopover.Portal>
        <BasePopover.Positioner
          anchor={shown?.anchor}
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          {...stylex.props(styles.positioner)}
        >
          <BasePopover.Popup
            data-card-preview
            initialFocus={false}
            finalFocus={false}
            {...stylex.props(surface.popup, styles.popup)}
          >
            {shown && <Preview number={shown.number} />}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}

function Preview({ number }: { number: number }) {
  const card = useQuery(q.card(number));
  const { byId } = useMembers();
  if (card.isPending) {
    return <p {...stylex.props(styles.meta)}>#{number} …</p>;
  }
  if (card.isError) {
    return (
      <p {...stylex.props(styles.meta)}>#{number} isn’t a card you can see.</p>
    );
  }
  const c = card.data;
  const people = c.assigneeIds.flatMap((id) => {
    const person = byId.get(id);
    return person ? [person] : [];
  });
  return (
    <div {...stylex.props(styles.body)}>
      <p {...stylex.props(styles.head)}>
        <span {...stylex.props(styles.number)}>#{c.number}</span>
        <Dot tone={STAGE_TONE[c.stage]} />
        <span>
          {c.stage === "active"
            ? (c.columnName ?? "In progress")
            : stageLabel(c.stage)}
        </span>
        {c.golden && <span {...stylex.props(styles.golden)}>Golden</span>}
      </p>
      <p {...stylex.props(styles.title)}>{c.title}</p>
      {c.stage !== "done" && c.stage !== "not_now" && (
        <CardRun number={c.number} />
      )}
      <p {...stylex.props(styles.foot)}>
        {people.length > 0 && <AvatarStack people={people} size={18} />}
        <span>
          {people.length > 0
            ? people.map((p) => p.name.split(" ")[0]).join(", ")
            : "Nobody on it"}
          {" · "}
          moved {ago(c.lastActiveAt)}
          {ago(c.lastActiveAt) === "now" ? "" : " ago"}
        </span>
      </p>
    </div>
  );
}

const styles = stylex.create({
  positioner: { zIndex: 80 },
  popup: {
    width: 300,
    maxWidth: "calc(100vw - 16px)",
    padding: space.lg,
    borderRadius: radius.md,
  },
  body: { display: "flex", flexDirection: "column", gap: space.sm },
  head: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    margin: 0,
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgMuted,
  },
  number: { fontFamily: font.mono, color: color.fgFaint },
  golden: { color: color.goldFg, fontWeight: 500 },
  title: {
    margin: 0,
    fontSize: text.copy,
    lineHeight: leading.copy,
    fontWeight: 500,
    color: color.fg,
    textWrap: "pretty",
  },
  foot: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    margin: 0,
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgMuted,
  },
  meta: {
    margin: 0,
    fontSize: text.meta,
    color: color.fgMuted,
  },
});
