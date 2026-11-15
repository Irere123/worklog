import {
  ArrowUpIcon,
  BellRingingIcon,
  CaretRightIcon,
  KanbanIcon,
  MagnifyingGlassIcon,
  MicrophoneIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";

import { AppWindow } from "#features/landing/frame";
import { Collapse } from "#features/landing/motion";
import { useScript } from "#features/landing/script";
import { ada } from "#features/landing/team";
import { Avatar } from "#ui/avatar";
import { Ghost } from "#ui/ghost";
import type { Mood } from "#ui/ghost";
import { color, font, radius, space, text } from "#ui/tokens.stylex";

import { PaneHeader, parts } from "./parts";
import type { SceneProps } from "./parts";

const QUESTION = "What’s blocking the county turnaround report?";
const ANSWER =
  "Data, not people. #8 needs last month’s numbers from the Denver server, and its nightly sync has stalled since Thursday. Scout found the cause in #14, and Eric is fixing it today, so Jean can send the report Wednesday.";
const WORDS = ANSWER.split(" ");

type State = {
  asked: boolean;
  mood: Mood;
  steps: number;
  folded: boolean;
  words: number;
  sources: boolean;
};

const START: State = {
  asked: false,
  mood: "idle",
  steps: 0,
  folded: false,
  words: 0,
  sources: false,
};

// The finished frame: what someone with reduced motion sees, and the beat the story builds to.
const END: State = {
  asked: true,
  mood: "done",
  steps: 2,
  folded: true,
  words: WORDS.length,
  sources: true,
};

/**
 * Assistant: Ada asks her own assistant what's holding up a report. It looks things up where she
 * can see it, folds the lookups away, and answers from the record, with the sources last. An
 * earlier exchange above shows it keeps what it's asked to: a reminder for Thursday.
 */
export function AssistantScene({ play, paused, still }: SceneProps) {
  const [s, setS] = useState(still ? END : START);
  const set = (next: Partial<State>) => setS((now) => ({ ...now, ...next }));

  useScript(
    async (a) => {
      await a.wait(900);
      set({ asked: true, mood: "thinking" });
      await a.wait(900);
      set({ steps: 1 });
      await a.wait(900);
      set({ steps: 2 });
      await a.wait(1000);
      set({ folded: true, mood: "writing" });
      await a.wait(300);
      // Every word is laid out from the start and shown in turn, so the answer grows in place
      // instead of reflowing as it arrives.
      for (let words = 1; words <= WORDS.length; words += 1) {
        set({ words });
        // oxlint-disable-next-line no-await-in-loop -- one word after another
        await a.wait(45);
      }
      await a.wait(300);
      set({ sources: true, mood: "done" });
    },
    { running: play && !still, paused }
  );

  return (
    <AppWindow nav="assistant" inbox={3}>
      <div {...stylex.props(styles.root)}>
        <PaneHeader
          title="Assistant"
          note="Answers from the team’s activity"
          end={<Ghost mood={s.mood} size={20} />}
        />
        <div {...stylex.props(styles.thread)}>
          {/* A phone's window runs off the wallpaper's foot, so it keeps only the new exchange,
              from the top, where it can be seen. */}
          <div {...stylex.props(styles.history)}>
            <Question muted>What did Atlas ship this week?</Question>
            <span {...stylex.props(styles.reply, styles.past)}>
              <Refs words="The SMS fallback prototype, #4, opened for review on Saturday." />
            </span>
            <Question muted>Who’s reviewing Grace’s FHIR profile?</Question>
            <span {...stylex.props(styles.reply, styles.past)}>
              <Refs words="You are. Grace asked for it yesterday; it’s waiting in your inbox as #2." />
            </span>
            <Question muted>
              Remind me Thursday to check the county numbers
            </Question>
            <span {...stylex.props(styles.reply, styles.past)}>
              <BellRingingIcon size={14} {...stylex.props(styles.bell)} />
              <span>
                <Refs words="I’ll bring it up Thursday at 9:00, with whatever moved on #8 by then." />
              </span>
            </span>
          </div>

          <Collapse open={s.asked}>
            <Question>{QUESTION}</Question>
          </Collapse>
          <Collapse open={s.steps > 0 && !s.folded}>
            <div {...stylex.props(styles.steps)}>
              <span {...stylex.props(styles.step)}>
                <MagnifyingGlassIcon
                  size={13}
                  {...stylex.props(styles.stepIcon)}
                />
                Searched activity for “turnaround” · 6 results
              </span>
              <Collapse open={s.steps > 1}>
                <span {...stylex.props(styles.step)}>
                  <KanbanIcon size={13} {...stylex.props(styles.stepIcon)} />
                  <span>
                    Read <span {...stylex.props(styles.mono)}>#8</span> Track
                    referral turnaround per county
                  </span>
                </span>
              </Collapse>
            </div>
          </Collapse>
          <Collapse open={s.folded}>
            <span {...stylex.props(styles.folded)}>
              <CaretRightIcon size={11} weight="bold" />
              Checked 2 things · 3s
            </span>
          </Collapse>
          <Collapse open={s.words > 0}>
            <p {...stylex.props(styles.answer)}>
              {WORDS.map((word, at) => {
                const { card, rest } =
                  /^(?<card>#\d+)(?<rest>.*)$/u.exec(word)?.groups ?? {};
                return (
                  // oxlint-disable-next-line react/no-array-index-key -- the words never reorder
                  <span key={at}>
                    <span
                      {...stylex.props(
                        styles.word,
                        at < s.words && styles.wordShown
                      )}
                    >
                      {card === undefined ? (
                        word
                      ) : (
                        <>
                          <span {...stylex.props(styles.ref)}>{card}</span>
                          {rest}
                        </>
                      )}
                    </span>{" "}
                  </span>
                );
              })}
            </p>
          </Collapse>
          <Collapse open={s.sources}>
            <span {...stylex.props(styles.sources)}>
              <span {...stylex.props(styles.source)}>
                <KanbanIcon size={12} />
                <span {...stylex.props(styles.mono)}>#8</span> Turnaround report
              </span>
              <span {...stylex.props(styles.source)}>
                <KanbanIcon size={12} />
                <span {...stylex.props(styles.mono)}>#14</span> Nightly sync
              </span>
              <span {...stylex.props(styles.source)}>
                <MagnifyingGlassIcon size={12} />
                Activity · 6 results
              </span>
            </span>
          </Collapse>
        </div>

        <div {...stylex.props(styles.composer)}>
          <span {...stylex.props(parts.faint)}>Ask a follow-up…</span>
          <span {...stylex.props(styles.composerFoot)}>
            <MicrophoneIcon size={15} {...stylex.props(parts.faint)} />
            <span {...stylex.props(styles.send)}>
              <ArrowUpIcon size={13} weight="bold" />
            </span>
          </span>
        </div>
      </div>
    </AppWindow>
  );
}

/** A reply's words, with each card number set as a reference, as the app sets them. */
function Refs({ words }: { words: string }) {
  return (
    <span>
      {words.split(/(?<card>#\d+)/u).map((part, at) =>
        /^#\d+$/u.test(part) ? (
          // oxlint-disable-next-line react/no-array-index-key -- the parts never reorder
          <span key={at} {...stylex.props(styles.ref)}>
            {part}
          </span>
        ) : (
          part
        )
      )}
    </span>
  );
}

function Question({
  children,
  muted = false,
}: {
  children: string;
  muted?: boolean;
}) {
  return (
    <span {...stylex.props(styles.question, muted && styles.past)}>
      <Avatar person={ada} size={20} />
      <span>{children}</span>
    </span>
  );
}

const styles = stylex.create({
  root: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    height: "100%",
  },
  // Anchored to the composer, as a conversation is: the newest exchange sits just above it.
  // Narrow enough that the composer ends before the tour's Pause button, on the window's corner.
  thread: {
    display: "flex",
    flexDirection: "column",
    justifyContent: {
      default: "flex-end",
      "@media (max-width: 719px)": "flex-start",
    },
    gap: space.md,
    flexGrow: 1,
    width: "100%",
    maxWidth: 520,
    marginInline: "auto",
    paddingTop: space.x3,
    paddingInline: space.lg,
  },
  history: {
    display: {
      default: "flex",
      "@media (max-width: 719px)": "none",
    },
    flexDirection: "column",
    gap: space.md,
  },
  question: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.md,
    alignSelf: "flex-end",
    width: "fit-content",
    marginLeft: "auto",
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.ui,
  },
  // The earlier exchange stays readable but steps back, so the eye lands on the new one.
  past: {
    opacity: 0.6,
  },
  reply: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.sm,
    fontSize: text.copy,
    lineHeight: "22px",
  },
  bell: {
    flexShrink: 0,
    marginTop: 4,
    color: color.goldFg,
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
  word: {
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: "160ms",
  },
  wordShown: {
    opacity: 1,
  },
  ref: {
    paddingInline: 3,
    borderRadius: radius.xs,
    backgroundColor: color.accentSubtle,
    color: color.accentFg,
    fontFamily: font.mono,
    fontSize: text.label,
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
    height: 26,
    paddingInline: space.md,
    borderRadius: radius.full,
    boxShadow: `inset 0 0 0 1px ${color.line}`,
    fontSize: text.meta,
    color: color.fgMuted,
    whiteSpace: "nowrap",
  },
  mono: {
    fontFamily: font.mono,
    fontSize: text.meta,
  },
  composer: {
    display: {
      default: "flex",
      "@media (max-width: 719px)": "none",
    },
    flexDirection: "column",
    gap: space.md,
    width: "calc(100% - 32px)",
    maxWidth: 488,
    marginInline: "auto",
    marginBlock: space.x3,
    paddingBlock: space.lg,
    paddingInline: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.raised,
    boxShadow: `inset 0 0 0 1px ${color.lineUi}, 0 1px 2px oklch(0.2 0.01 80 / 0.05)`,
    fontSize: text.copy,
  },
  composerFoot: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: space.md,
  },
  send: {
    display: "grid",
    placeItems: "center",
    width: 24,
    height: 24,
    borderRadius: radius.full,
    backgroundColor: color.ui,
    color: color.fgMuted,
  },
});
