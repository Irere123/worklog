import {
  CaretRightIcon,
  CheckIcon,
  CircleHalfIcon,
  CircleIcon,
  KanbanIcon,
  MagnifyingGlassIcon,
  XIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useRef, useState } from "react";

import { Avatar } from "#ui/avatar";
import { Ghost } from "#ui/ghost";
import type { Mood } from "#ui/ghost";
import { color, font, radius, space, text } from "#ui/tokens.stylex";

import { Cursor, Plate } from "./frame";
import { Collapse, Roll } from "./motion";
import ink from "./plates/ink.webp";
import sage from "./plates/sage.webp";
import { pointAt, useInView, useReducedMotion, useScript } from "./script";
import type { Point } from "./script";
import { page, type } from "./styles";
import { ada, atlas, grace, jean } from "./team";

/**
 * Agents as teammates: your assistant answers for you while you're away, and a coding agent works
 * a card and asks before it changes what others will see.
 */
export function Agents() {
  return (
    <section id="agents" {...stylex.props(page.wide, page.section)}>
      <div {...stylex.props(page.intro)}>
        <h2 {...stylex.props(type.heading)}>Agents on the team.</h2>
        <p {...stylex.props(type.lede, styles.lede)}>
          Everyone gets an assistant that knows their work. Coding agents report
          like teammates, and ask before they act.
        </p>
      </div>
      <div {...stylex.props(styles.pair)}>
        <figure {...stylex.props(styles.card)}>
          <Plate src={ink} sx={styles.plate}>
            <div aria-hidden {...stylex.props(styles.picture)}>
              <Ask />
            </div>
          </Plate>
          <figcaption {...stylex.props(styles.caption)}>
            <h3 {...stylex.props(type.tileTitle)}>Ask anyone’s assistant</h3>
            <p {...stylex.props(type.tileCopy)}>
              Teammates ask it about your work while you’re away. It answers
              from the record, shows what it checked, and sees only what the
              person asking may see.
            </p>
          </figcaption>
        </figure>
        <figure {...stylex.props(styles.card)}>
          <Plate src={sage} sx={styles.plate}>
            <div aria-hidden {...stylex.props(styles.picture)}>
              <Approve />
            </div>
          </Plate>
          <figcaption {...stylex.props(styles.caption)}>
            <h3 {...stylex.props(type.tileTitle)}>
              Agents ask before they act
            </h3>
            <p {...stylex.props(type.tileCopy)}>
              Coding agents own cards and report progress through the API. A
              change others will see waits for their human’s OK.
            </p>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

const ANSWER =
  "Yes. Atlas finished the prototype on Saturday and opened a pull request for review. Jean approved queueing messages until the clinic is back; testing waits on Eric’s review of #4.";

type AskState = {
  asked: boolean;
  mood: Mood;
  steps: number;
  folded: boolean;
  typed: number;
};

// The question is asked and the lookup under way: the first frame is already a working assistant.
const ASK_START: AskState = {
  asked: true,
  mood: "thinking",
  steps: 1,
  folded: false,
  typed: 0,
};

const ASK_END: AskState = {
  asked: true,
  mood: "done",
  steps: 2,
  folded: true,
  typed: ANSWER.length,
};

function Ask() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const reduced = useReducedMotion();
  const [s, setS] = useState(ASK_START);
  const set = (next: Partial<AskState>) => setS((now) => ({ ...now, ...next }));

  useScript(
    async (a) => {
      await a.wait(1000);
      set({ steps: 2 });
      await a.wait(900);
      set({ folded: true, mood: "writing" });
      await a.wait(300);
      // Streams in word by word, the way the assistant really answers.
      const words = ANSWER.split(" ");
      let typed = 0;
      for (const word of words) {
        typed += word.length + 1;
        set({ typed: Math.min(typed, ANSWER.length) });
        // oxlint-disable-next-line no-await-in-loop -- one word after another
        await a.wait(55);
      }
      set({ mood: "done" });
    },
    { running: inView && !reduced, paused: false }
  );

  const shown = reduced ? ASK_END : s;
  const answer = ANSWER.slice(0, shown.typed);
  return (
    <div ref={ref} {...stylex.props(styles.panel)}>
      <div {...stylex.props(styles.panelHead)}>
        <Ghost mood={shown.mood} size={22} />
        <span {...stylex.props(styles.panelTitle)}>Jean’s assistant</span>
        <span {...stylex.props(styles.away)}>Jean is away until Thursday</span>
      </div>
      <div {...stylex.props(styles.thread)}>
        <Collapse open={shown.asked}>
          <div {...stylex.props(styles.question)}>
            <Avatar person={grace} size={20} />
            <span>Is the SMS fallback ready for Kibagabaga to test?</span>
          </div>
        </Collapse>
        <Collapse open={shown.steps > 0 && !shown.folded}>
          <div {...stylex.props(styles.steps)}>
            <span {...stylex.props(styles.step)}>
              <MagnifyingGlassIcon
                size={13}
                {...stylex.props(styles.stepIcon)}
              />
              Searched activity for “SMS fallback” · 4 results
            </span>
            <Collapse open={shown.steps > 1}>
              <span {...stylex.props(styles.step)}>
                <KanbanIcon size={13} {...stylex.props(styles.stepIcon)} />
                <span>
                  Read <span {...stylex.props(styles.mono)}>#4</span> SMS
                  fallback when the receiving clinic is offline
                </span>
              </span>
            </Collapse>
          </div>
        </Collapse>
        <Collapse open={shown.folded}>
          <span {...stylex.props(styles.folded)}>
            <CaretRightIcon size={11} weight="bold" />
            Checked 2 things · 3s
          </span>
        </Collapse>
        <Collapse open={shown.typed > 0}>
          <p {...stylex.props(styles.answer)}>
            {answer.split("#4").map((part, at, all) => (
              // oxlint-disable-next-line react/no-array-index-key -- the parts never reorder
              <span key={at}>
                {part}
                {at < all.length - 1 && (
                  <span {...stylex.props(styles.ref)}>#4</span>
                )}
              </span>
            ))}
          </p>
        </Collapse>
        <Collapse open={shown.mood === "done"}>
          <span {...stylex.props(styles.sources)}>
            <span {...stylex.props(styles.source)}>
              <KanbanIcon size={12} />
              <span {...stylex.props(styles.mono)}>#4</span> SMS fallback when
              the receiving clinic is offline
            </span>
            <span {...stylex.props(styles.source)}>
              <MagnifyingGlassIcon size={12} />
              Activity · 4 results
            </span>
          </span>
        </Collapse>
      </div>
    </div>
  );
}

type Phase = "working" | "asking" | "allowed";

// The ghost wears the run's state, as every agent's does across the app.
const MOODS: Record<Phase, Mood> = {
  working: "thinking",
  asking: "waiting",
  allowed: "done",
};

const DOING: Record<Phase, string> = {
  working: "is drafting the rollback plan",
  asking: "needs you",
  allowed: "starts Saturday at 02:00",
};

type ApproveState = {
  phase: Phase;
  cursor: Point;
  shown: boolean;
  pressed: boolean;
};

const APPROVE_START: ApproveState = {
  phase: "working",
  cursor: { x: 380, y: 300 },
  shown: false,
  pressed: false,
};

function Approve() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const reduced = useReducedMotion();
  const [s, setS] = useState(APPROVE_START);
  const set = (next: Partial<ApproveState>) =>
    setS((now) => ({ ...now, ...next }));

  useScript(
    async (a) => {
      await a.wait(1800);
      set({ phase: "asking" });
      await a.wait(1200);
      const allow = pointAt(ref.current, "allow", 0.72, 0.6);
      if (allow) {
        set({ shown: true });
        await a.wait(120);
        set({ cursor: allow });
        await a.wait(1000);
        set({ pressed: true });
        await a.wait(140);
        set({ pressed: false });
      }
      await a.wait(100);
      set({ phase: "allowed" });
      await a.wait(900);
      if (allow) {
        set({ cursor: { x: allow.x + 30, y: allow.y + 90 } });
      }
    },
    { running: inView && !reduced, paused: false }
  );

  const phase = reduced ? "allowed" : s.phase;
  const mood = MOODS[phase];
  return (
    <div ref={ref} {...stylex.props(styles.panel, styles.cardPanel)}>
      <div {...stylex.props(styles.cardHead)}>
        <KanbanIcon size={14} {...stylex.props(styles.faint)} />
        <span {...stylex.props(styles.mono, styles.faint)}>#16</span>
        <span {...stylex.props(styles.panelTitle)}>Upgrade Postgres to 18</span>
        <span
          {...stylex.props(
            styles.status,
            phase === "allowed" ? styles.statusDoing : styles.statusTodo
          )}
        >
          {phase === "allowed" ? (
            <CircleHalfIcon size={12} weight="fill" />
          ) : (
            <CircleIcon size={12} weight="bold" />
          )}
          <Roll value={phase === "allowed" ? "Doing" : "Investigating"} />
        </span>
      </div>

      <div
        {...stylex.props(styles.run, phase === "asking" && styles.runAsking)}
      >
        <span {...stylex.props(styles.runHead)}>
          <Avatar person={atlas} size={20} />
          <span {...stylex.props(styles.strong)}>Atlas</span>
          <Ghost mood={mood} size={16} tinted />
          <span {...stylex.props(styles.runState)}>
            <Roll value={DOING[phase]} />
          </span>
        </span>
        <Collapse open={phase === "asking"}>
          <div {...stylex.props(styles.ask)}>
            <span>
              Wants your OK to move{" "}
              <span {...stylex.props(styles.mono)}>#16</span> to Doing and book
              Saturday 02:00 for the upgrade.
            </span>
            <span {...stylex.props(styles.askActions)}>
              <span
                data-target="allow"
                {...stylex.props(
                  styles.allow,
                  s.pressed && styles.allowPressed
                )}
              >
                <CheckIcon size={13} weight="bold" /> Allow
              </span>
              <span {...stylex.props(styles.deny)}>
                <XIcon size={12} weight="bold" /> Deny
              </span>
            </span>
          </div>
        </Collapse>
      </div>

      <div {...stylex.props(styles.log)}>
        <Collapse open={phase === "allowed"}>
          <span {...stylex.props(styles.logLine)}>
            <Avatar person={atlas} size={16} />
            <span>
              <span {...stylex.props(styles.strong)}>Atlas</span> Moved to Doing
              · Allowed by {ada.name}
            </span>
            <span {...stylex.props(styles.when)}>Now</span>
          </span>
        </Collapse>
        <span {...stylex.props(styles.logLine)}>
          <Avatar person={atlas} size={16} />
          <span>
            <span {...stylex.props(styles.strong)}>Atlas</span> Drafted the
            rollback plan · snapshot restore, about 12 min
          </span>
          <span {...stylex.props(styles.when)}>8:10</span>
        </span>
        <span {...stylex.props(styles.logLine)}>
          <Avatar person={jean} size={16} />
          <span>
            <span {...stylex.props(styles.strong)}>Jean Habimana</span> Assigned
            to Atlas · Moved to Investigating
          </span>
          <span {...stylex.props(styles.when)}>Fri</span>
        </span>
        <span {...stylex.props(styles.logLine)}>
          <Avatar person={jean} size={16} />
          <span>
            <span {...stylex.props(styles.strong)}>Jean Habimana</span> Blocked
            on Ada · production DB credentials need rotating first
          </span>
          <span {...stylex.props(styles.when)}>Thu</span>
        </span>
      </div>
      <Cursor at={s.cursor} pressed={s.pressed} shown={s.shown && !reduced} />
    </div>
  );
}

const styles = stylex.create({
  lede: {
    maxWidth: 520,
  },
  pair: {
    display: "grid",
    gridTemplateColumns: {
      default: "1fr 1fr",
      "@media (max-width: 860px)": "1fr",
    },
    gap: space.md,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    overflow: "hidden",
    borderRadius: 20,
    backgroundColor: "light-dark(oklch(0.958 0.004 80), oklch(0.215 0.005 80))",
    // In the dark a surface a step up isn't edge enough; a hairline carries it, as in the app.
    boxShadow: "inset 0 0 0 1px light-dark(transparent, oklch(1 0 0 / 0.06))",
  },
  plate: {
    height: 380,
    borderRadius: 0,
    display: "flex",
    justifyContent: "center",
    paddingTop: 44,
    paddingInline: {
      default: 40,
      "@media (max-width: 640px)": space.xl,
    },
  },
  picture: {
    display: "flex",
    justifyContent: "center",
    width: "100%",
  },
  caption: {
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
    paddingTop: space.xxl,
    paddingBottom: space.x3,
    paddingInline: space.x3,
  },
  panel: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    width: "100%",
    maxWidth: 420,
    // Runs off the plate's foot, like the product shots above it.
    minHeight: 400,
    borderRadius: radius.lg,
    backgroundColor: color.bg,
    boxShadow:
      "0 0 0 1px light-dark(oklch(0.2 0.01 80 / 0.1), oklch(1 0 0 / 0.1)), 0 12px 32px light-dark(oklch(0.2 0.02 60 / 0.16), oklch(0 0 0 / 0.5))",
    fontSize: text.label,
    lineHeight: "20px",
    color: color.fg,
    textAlign: "start",
    userSelect: "none",
  },
  panelHead: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    height: 48,
    paddingInline: space.lg,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
  },
  panelTitle: {
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  away: {
    marginLeft: "auto",
    fontSize: text.meta,
    color: color.fgMuted,
    whiteSpace: "nowrap",
  },
  thread: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    flexGrow: 1,
    padding: space.lg,
  },
  question: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.md,
    alignSelf: "flex-end",
    marginLeft: space.x4,
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.ui,
  },
  steps: {
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
    paddingTop: space.xs,
  },
  step: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.sm,
    fontSize: text.meta,
    color: color.fgMuted,
  },
  // Sits on the step's first line when its words wrap.
  stepIcon: {
    flexShrink: 0,
    marginTop: 2,
  },
  folded: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    paddingTop: space.xs,
    fontSize: text.meta,
    color: color.fgMuted,
  },
  answer: {
    margin: 0,
    fontSize: text.copy,
    lineHeight: "22px",
  },
  sources: {
    display: "flex",
    flexWrap: "wrap",
    gap: space.sm,
  },
  source: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    maxWidth: "100%",
    height: 26,
    paddingInline: space.md,
    borderRadius: radius.full,
    boxShadow: `inset 0 0 0 1px ${color.line}`,
    fontSize: text.meta,
    color: color.fgMuted,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  ref: {
    paddingInline: 3,
    borderRadius: radius.xs,
    backgroundColor: color.accentSubtle,
    color: color.accentFg,
    fontFamily: font.mono,
    fontSize: text.label,
  },
  cardPanel: {
    gap: 0,
  },
  cardHead: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    height: 48,
    paddingInline: space.lg,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
  },
  faint: {
    color: color.fgFaint,
  },
  mono: {
    fontFamily: font.mono,
    fontSize: text.meta,
  },
  status: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    marginLeft: "auto",
    height: 22,
    paddingInline: space.md,
    borderRadius: radius.sm,
    fontSize: text.meta,
    fontWeight: 500,
    whiteSpace: "nowrap",
    transitionProperty: "background-color, color",
    transitionDuration: "240ms",
  },
  statusTodo: {
    backgroundColor: color.violetSubtle,
    color: color.violetFg,
  },
  statusDoing: {
    backgroundColor: color.blueSubtle,
    color: color.blueFg,
  },
  run: {
    display: "flex",
    flexDirection: "column",
    margin: space.lg,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    boxShadow: `inset 0 0 0 1px ${color.line}`,
    transitionProperty: "box-shadow, background-color",
    transitionDuration: "300ms",
  },
  runAsking: {
    backgroundColor: color.amberSubtle,
    boxShadow: `inset 0 0 0 1px light-dark(oklch(0.85 0.08 75), oklch(0.4 0.07 70))`,
  },
  runHead: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    color: color.fgMuted,
  },
  strong: {
    fontWeight: 600,
    color: color.fg,
  },
  runState: {
    whiteSpace: "nowrap",
  },
  ask: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    paddingTop: space.md,
    paddingLeft: 28,
  },
  askActions: {
    display: "flex",
    gap: space.sm,
  },
  allow: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    height: 28,
    paddingInline: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.fg,
    color: color.bg,
    fontWeight: 500,
    transitionProperty: "transform",
    transitionDuration: "120ms",
  },
  allowPressed: {
    transform: "scale(0.96)",
  },
  deny: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    height: 28,
    paddingInline: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.raised,
    boxShadow: `inset 0 0 0 1px ${color.lineUi}`,
    fontWeight: 500,
  },
  log: {
    display: "flex",
    flexDirection: "column",
    paddingInline: space.lg,
  },
  logLine: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.sm,
    paddingBlock: space.sm,
    fontSize: text.meta,
    lineHeight: "17px",
    color: color.fgMuted,
  },
  when: {
    marginLeft: "auto",
    flexShrink: 0,
    paddingLeft: space.md,
  },
});
