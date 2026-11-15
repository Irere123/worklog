import {
  DotsThreeIcon,
  HourglassMediumIcon,
  PlusIcon,
  TicketIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { ReactNode } from "react";

import { AppWindow, Cursor } from "#features/landing/frame";
import { Collapse, Roll } from "#features/landing/motion";
import { pointAt, useScript } from "#features/landing/script";
import type { Point } from "#features/landing/script";
import { ada, atlas, eric, grace, jean } from "#features/landing/team";
import { Avatar } from "#ui/avatar";
import { color, radius, space, text } from "#ui/tokens.stylex";

import { CardNumber, PaneHeader, parts } from "./parts";
import type { SceneProps } from "./parts";

type Box = { x: number; y: number; width: number };

type State = {
  phase: "rest" | "lifted" | "dropping" | "dropped";
  flyer: Box;
  cursor: Point;
  shown: boolean;
  pressed: boolean;
  travel: number;
};

const START: State = {
  phase: "rest",
  flyer: { x: 0, y: 0, width: 0 },
  cursor: { x: 560, y: 440 },
  shown: false,
  pressed: false,
  travel: 700,
};

const END: State = { ...START, phase: "dropped" };

const CARRY = 1100;

/**
 * Board: you pick up #4 and carry it to In progress. The column it leaves closes behind it, the
 * one it joins makes room, and both counts follow. Around it, the golden ticket marks the one card
 * that matters and an untouched card is already fading.
 */
export function BoardScene({ play, paused, still }: SceneProps) {
  const root = useRef<HTMLDivElement>(null);
  const [s, setS] = useState(still ? END : START);
  const set = (next: Partial<State>) => setS((now) => ({ ...now, ...next }));

  useScript(
    async (a) => {
      await a.wait(1200);
      const grab = pointAt(root.current, "card4", 0.42, 0.42);
      const card = box(root.current, "card4");
      if (!(grab && card)) {
        await a.wait(600);
        set({ phase: "dropped" });
        return;
      }
      set({ shown: true, travel: 800 });
      await a.wait(100);
      set({ cursor: grab });
      await a.wait(1000);
      set({ pressed: true, phase: "lifted", flyer: card });
      await a.wait(260);
      set({ pressed: false });
      await a.wait(420);
      const slot = box(root.current, "slot");
      if (!slot) {
        return;
      }
      const offset = { x: grab.x - card.x, y: grab.y - card.y };
      set({
        travel: CARRY,
        cursor: { x: slot.x + offset.x, y: slot.y + offset.y },
        flyer: { ...slot, width: card.width },
      });
      await a.wait(CARRY + 60);
      set({ phase: "dropping", pressed: true });
      await a.wait(200);
      set({ phase: "dropped", pressed: false });
      await a.wait(700);
      set({
        travel: 900,
        cursor: { x: slot.x + offset.x + 40, y: slot.y + 230 },
      });
    },
    { running: play && !still, paused }
  );

  const carried = s.phase === "lifted";
  const moved = s.phase !== "rest";
  const landed = s.phase === "dropped";
  return (
    <AppWindow nav="referrals" inbox={3}>
      <div ref={root} {...stylex.props(styles.root)}>
        <PaneHeader
          title="Referrals"
          note="Moving patients between clinics without losing their story."
          end={
            <span {...stylex.props(styles.newCard)}>
              <PlusIcon size={13} weight="bold" /> New card
            </span>
          }
        />
        <div {...stylex.props(styles.columns)}>
          <div {...stylex.props(styles.notNow)}>
            <span {...stylex.props(styles.notNowCount)}>2</span>
            <span {...stylex.props(styles.notNowLabel)}>Not now</span>
          </div>

          <Column name="Maybe?" hue="violet" count={2} narrowHidden>
            <Tile
              number={8}
              title="Track referral turnaround per district"
              tags={["reporting"]}
              who={ada}
              owner={ada}
            />
            <Tile
              number={9}
              title="Let receiving clinicians reply on a referral"
              tags={["design"]}
              who={grace}
              drift
            />
          </Column>

          <Column name="Investigating" hue="violet" count={moved ? 1 : 2}>
            <Tile
              number={5}
              title="Duplicate patients after district merge"
              tags={["data"]}
              who={eric}
            />
            <Collapse open={!moved} from="none">
              <div data-target="card4" {...stylex.props(styles.slot)}>
                <Tile
                  number={4}
                  title="SMS fallback when the receiving clinic is offline"
                  tags={["sms"]}
                  who={jean}
                  owner={atlas}
                />
              </div>
            </Collapse>
          </Column>

          <Column name="In progress" hue="blue" count={landed ? 3 : 2}>
            <Collapse open={moved} from="none">
              <div
                data-target="slot"
                {...stylex.props(styles.slot, !landed && styles.hold)}
              >
                <Tile
                  number={4}
                  title="SMS fallback when the receiving clinic is offline"
                  tags={["sms"]}
                  who={jean}
                  owner={atlas}
                />
              </div>
            </Collapse>
            <Tile
              number={1}
              title="Referral form loses attachments on slow connections"
              tags={["bug", "field"]}
              who={ada}
              owner={jean}
              golden
            />
            <Tile
              number={3}
              title="Show referral status to the sending clinic"
              tags={["design"]}
              who={grace}
              owner={eric}
            />
          </Column>
        </div>

        {(s.phase === "lifted" || s.phase === "dropping") && (
          <div
            aria-hidden
            {...stylex.props(
              styles.flyer,
              styles.place(s.flyer.x, s.flyer.y, s.flyer.width, CARRY),
              carried && styles.flyerHeld
            )}
          >
            <Tile
              number={4}
              title="SMS fallback when the receiving clinic is offline"
              tags={["sms"]}
              who={jean}
              owner={atlas}
            />
          </div>
        )}
        <Cursor
          at={s.cursor}
          pressed={s.pressed}
          shown={s.shown}
          travel={s.travel}
        />
      </div>
    </AppWindow>
  );
}

function box(root: HTMLElement | null, name: string): Box | null {
  const target = root?.querySelector<HTMLElement>(`[data-target="${name}"]`);
  if (!(root && target && target.offsetParent)) {
    return null;
  }
  const outer = root.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  return {
    x: rect.left - outer.left,
    y: rect.top - outer.top,
    width: rect.width,
  };
}

function Column({
  name,
  hue,
  count,
  narrowHidden = false,
  children,
}: {
  name: string;
  hue: "violet" | "blue";
  count: number;
  narrowHidden?: boolean;
  children: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.column, narrowHidden && styles.narrowHidden)}>
      <div {...stylex.props(styles.columnHead)}>
        <span {...stylex.props(styles.hue, styles[hue])} />
        <span {...stylex.props(parts.strong)}>{name}</span>
        <span {...stylex.props(parts.faint)}>
          <Roll value={count} />
        </span>
        <DotsThreeIcon size={16} {...stylex.props(styles.more)} />
      </div>
      <div {...stylex.props(styles.stack)}>{children}</div>
    </div>
  );
}

type Person = { id: string; name: string; avatarUrl?: string; kind?: string };

function Tile({
  number,
  title,
  tags,
  who,
  owner,
  golden = false,
  drift = false,
}: {
  number: number;
  title: string;
  tags: string[];
  who: Person;
  owner?: Person;
  golden?: boolean;
  drift?: boolean;
}) {
  return (
    <div
      {...stylex.props(
        styles.tile,
        golden && styles.golden,
        drift && styles.drifting
      )}
    >
      <span {...stylex.props(styles.tileTop)}>
        <span {...stylex.props(styles.number, golden && styles.numberGolden)}>
          <CardNumber>{number}</CardNumber>
        </span>
        {golden && (
          <TicketIcon
            size={15}
            weight="fill"
            {...stylex.props(styles.ticket)}
          />
        )}
        {drift && (
          <span {...stylex.props(styles.drift)}>
            <HourglassMediumIcon size={12} weight="fill" /> 3 days
          </span>
        )}
      </span>
      <span {...stylex.props(styles.tileTitle)}>{title}</span>
      <span {...stylex.props(styles.tags)}>
        {tags.map((tag) => (
          <span key={tag}>#{tag}</span>
        ))}
      </span>
      <span {...stylex.props(styles.tileFoot)}>
        <Avatar person={who} size={16} />
        <span {...stylex.props(parts.muted)}>2 Nov</span>
        <span {...stylex.props(styles.owner)}>
          {owner && <Avatar person={owner} size={20} />}
        </span>
      </span>
    </div>
  );
}

const styles = stylex.create({
  root: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    height: "100%",
  },
  newCard: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    height: 28,
    paddingInline: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.accent,
    color: color.fgOnSolid,
    fontWeight: 500,
  },
  columns: {
    display: "flex",
    gap: space.lg,
    paddingTop: space.xl,
    paddingInline: space.xl,
  },
  notNow: {
    display: {
      default: "flex",
      "@media (max-width: 719px)": "none",
    },
    flexDirection: "column",
    alignItems: "center",
    gap: space.md,
    width: 36,
    flexShrink: 0,
    height: 260,
    paddingTop: space.md,
    borderRadius: radius.full,
    backgroundColor: color.ui,
  },
  notNowCount: {
    display: "grid",
    placeItems: "center",
    width: 24,
    height: 24,
    borderRadius: radius.full,
    backgroundColor: color.raised,
    fontSize: text.meta,
    fontWeight: 600,
  },
  notNowLabel: {
    writingMode: "vertical-rl",
    fontSize: text.caption,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: color.fgMuted,
  },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
  },
  narrowHidden: {
    display: {
      default: "flex",
      "@media (max-width: 719px)": "none",
    },
  },
  columnHead: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    height: 24,
    paddingInline: space.xs,
  },
  hue: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
  },
  violet: { backgroundColor: color.violet },
  blue: { backgroundColor: color.blue },
  more: {
    marginLeft: "auto",
    color: color.fgFaint,
  },
  stack: {
    display: "flex",
    flexDirection: "column",
  },
  slot: {
    paddingBottom: space.md,
  },
  hold: {
    opacity: 0,
  },
  tile: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    marginBottom: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.raised,
    boxShadow: `0 0 0 1px ${color.line}, 0 1px 2px light-dark(oklch(0.2 0.01 80 / 0.05), oklch(0 0 0 / 0.3))`,
  },
  golden: {
    backgroundImage:
      "linear-gradient(160deg, light-dark(oklch(0.97 0.06 92), oklch(0.4 0.085 86)), light-dark(oklch(0.93 0.09 85), oklch(0.34 0.075 80)))",
    boxShadow: `0 0 0 1px ${color.gold}, 0 2px 8px light-dark(oklch(0.78 0.15 82 / 0.3), oklch(0 0 0 / 0.3))`,
  },
  drifting: {
    opacity: 0.72,
  },
  tileTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  number: {
    display: "inline-flex",
    alignItems: "center",
    height: 20,
    paddingInline: space.sm,
    borderRadius: radius.xs,
    backgroundColor: color.ui,
  },
  numberGolden: {
    backgroundColor: "light-dark(oklch(1 0 0 / 0.6), oklch(0 0 0 / 0.2))",
  },
  ticket: {
    color: color.goldFg,
  },
  drift: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xxs,
    fontSize: text.caption,
    fontWeight: 500,
    color: color.fgMuted,
  },
  tileTitle: {
    fontWeight: 500,
    lineHeight: "19px",
  },
  tags: {
    display: "flex",
    gap: space.sm,
    fontSize: text.meta,
    color: color.fgMuted,
  },
  tileFoot: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    fontSize: text.meta,
  },
  owner: {
    marginLeft: "auto",
    display: "flex",
  },
  flyer: {
    position: "absolute",
    top: 0,
    left: 0,
    zIndex: 4,
    transformOrigin: "40% 40%",
  },
  place: (x: number, y: number, width: number, travel: number) => ({
    width,
    transform: `translate(${x}px, ${y}px)`,
    transition: `transform ${travel}ms cubic-bezier(0.45, 0, 0.1, 1), filter 220ms ease, rotate 220ms ease, scale 220ms ease`,
  }),
  // Held, it lifts, tilts a little with the hand and casts a deeper shadow; it settles flat on drop.
  flyerHeld: {
    filter:
      "drop-shadow(0 12px 18px light-dark(oklch(0.2 0.02 60 / 0.18), oklch(0 0 0 / 0.5)))",
    rotate: "2deg",
    scale: "1.03",
  },
});
