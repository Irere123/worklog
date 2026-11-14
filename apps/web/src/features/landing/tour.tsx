import { PauseIcon, PlayIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { ComponentType } from "react";

import { color, media, motion, radius, space, text } from "#ui/tokens.stylex";

import { Plate } from "./frame";
import clay from "./plates/clay.webp";
import ink from "./plates/ink.webp";
import sage from "./plates/sage.webp";
import sky from "./plates/sky.webp";
import ticket from "./plates/ticket.webp";
import { ActivityScene } from "./scenes/activity";
import { BoardScene } from "./scenes/board";
import { BriefsScene } from "./scenes/briefs";
import { HomeScene } from "./scenes/home";
import { InboxScene } from "./scenes/inbox";
import type { SceneProps } from "./scenes/parts";
import { useInView, useReducedMotion } from "./script";
import { page } from "./styles";

type Chapter = {
  id: string;
  label: string;
  caption: string;
  plate: string;
  duration: number;
  Scene: ComponentType<SceneProps>;
};

const HOME: Chapter = {
  id: "home",
  label: "Home",
  caption: "What needs you today, and what moved while you were away.",
  plate: ink,
  duration: 8000,
  Scene: HomeScene,
};

const CHAPTERS: Chapter[] = [
  HOME,
  {
    id: "inbox",
    label: "Inbox",
    caption: "Only what’s blocked on you, each with why it’s there.",
    plate: ticket,
    duration: 7500,
    Scene: InboxScene,
  },
  {
    id: "board",
    label: "Board",
    caption:
      "Golden tickets instead of priorities. Cards nobody touches drift away.",
    plate: sage,
    duration: 8000,
    Scene: BoardScene,
  },
  {
    id: "activity",
    label: "Activity",
    caption:
      "GitHub, Slack, Discord and agents in one stream, with the noise left out.",
    plate: sky,
    duration: 8500,
    Scene: ActivityScene,
  },
  {
    id: "briefs",
    label: "Briefs",
    caption:
      "A morning brief and a weekly wrap, by email, Slack, Discord or webhook.",
    plate: clay,
    duration: 8000,
    Scene: BriefsScene,
  },
];

// Every chapter's wallpaper is laid in the plate from the start, so a change crossfades.
const PLATES = [ink, ticket, sage, sky, clay];

/**
 * The product tour: the app's own window on a wallpaper, one chapter at a time. Each chapter plays
 * a short scene and hands over to the next; the tabs jump, and Pause holds the scene where it is.
 */
export function Tour() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  // Wallpapers mount as the tour reaches them, plus the next one so its change can crossfade: a
  // first visit fetches two, not five. Once mounted they stay, so the loop back fades too.
  const [reached, setReached] = useState(0);
  const [round, setRound] = useState(0);
  const [paused, setPaused] = useState(false);
  const chapter = CHAPTERS.at(index) ?? HOME;
  const auto = !reduced;
  const holding = paused || !inView;

  function go(next: number) {
    const to = (next + CHAPTERS.length) % CHAPTERS.length;
    setReached((now) => Math.max(now, to));
    setIndex(to);
    setRound((now) => now + 1);
  }

  return (
    <section
      id="tour"
      aria-label="Product tour"
      {...stylex.props(page.wide, styles.tour)}
    >
      <div ref={ref}>
        <Plate
          src={chapter.plate}
          choices={PLATES.slice(0, reached + 2)}
          priority
          sx={styles.plate}
        >
          {/* A picture of the app: the caption below says what it shows, in words. */}
          <div aria-hidden {...stylex.props(styles.stage)}>
            {CHAPTERS.map((each, at) =>
              at === index ? (
                <div
                  key={`${each.id}-${round}`}
                  {...stylex.props(styles.scene)}
                >
                  <each.Scene play={inView} paused={holding} still={reduced} />
                </div>
              ) : null
            )}
          </div>
        </Plate>
      </div>

      <p {...stylex.props(styles.caption)} aria-live="polite">
        <strong {...stylex.props(styles.captionLead)}>{chapter.label}</strong>{" "}
        {chapter.caption}
      </p>

      <div {...stylex.props(styles.controls)}>
        <div
          role="tablist"
          aria-label="Tour chapters"
          {...stylex.props(styles.tabs)}
        >
          {CHAPTERS.map((each, at) => (
            <button
              key={each.id}
              type="button"
              role="tab"
              aria-selected={at === index}
              onClick={() => go(at)}
              {...stylex.props(styles.tab, at === index && styles.tabOn)}
            >
              {each.label}
              {auto && at === index && (
                <span
                  key={round}
                  onAnimationEnd={() => go(index + 1)}
                  {...stylex.props(
                    styles.progress,
                    styles.duration(each.duration),
                    holding && styles.progressHeld
                  )}
                />
              )}
            </button>
          ))}
        </div>
        {auto && (
          <button
            type="button"
            aria-label={paused ? "Play the tour" : "Pause the tour"}
            onClick={() => setPaused((now) => !now)}
            {...stylex.props(styles.pause)}
          >
            {paused ? (
              <PlayIcon size={14} weight="fill" />
            ) : (
              <PauseIcon size={14} weight="fill" />
            )}
          </button>
        )}
      </div>
    </section>
  );
}

const fill = stylex.keyframes({
  from: { transform: "scaleX(0)" },
  to: { transform: "scaleX(1)" },
});

const styles = stylex.create({
  tour: {
    marginTop: {
      default: 72,
      "@media (max-width: 640px)": 48,
    },
  },
  plate: {
    height: {
      default: 600,
      "@media (max-width: 719px)": 500,
    },
  },
  stage: {
    position: "absolute",
    top: {
      default: 56,
      "@media (max-width: 719px)": 28,
    },
    left: {
      default: "6%",
      "@media (max-width: 719px)": space.xl,
    },
    right: {
      default: "6%",
      "@media (max-width: 719px)": space.xl,
    },
    // Taller than what shows: the window runs off the plate's foot, as a window on a desk would.
    height: {
      default: 600,
      "@media (max-width: 719px)": 520,
    },
  },
  scene: {
    height: "100%",
    display: "grid",
  },
  caption: {
    margin: 0,
    marginTop: space.xxl,
    textAlign: "center",
    fontSize: 15,
    lineHeight: "22px",
    color: color.fgMuted,
    textWrap: "balance",
  },
  captionLead: {
    color: color.fg,
    fontWeight: 600,
  },
  controls: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.md,
    marginTop: space.xl,
  },
  tabs: {
    display: "flex",
    gap: space.xs,
    padding: space.xs,
    borderRadius: radius.full,
    backgroundColor: color.ui,
    overflowX: "auto",
    scrollbarWidth: "none",
  },
  tab: {
    position: "relative",
    overflow: "hidden",
    height: 32,
    paddingInline: space.lg,
    border: "none",
    borderRadius: radius.full,
    backgroundColor: "transparent",
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    fontFamily: "inherit",
    fontSize: text.label,
    fontWeight: 500,
    whiteSpace: "nowrap",
    cursor: "pointer",
    transitionProperty: "background-color, color",
    transitionDuration: motion.base,
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
    outlineOffset: 1,
  },
  tabOn: {
    backgroundColor: color.raised,
    color: color.fg,
    boxShadow: `0 0 0 1px ${color.line}, 0 1px 2px light-dark(oklch(0.2 0.01 80 / 0.08), oklch(0 0 0 / 0.3))`,
  },
  progress: {
    position: "absolute",
    left: space.lg,
    right: space.lg,
    bottom: 5,
    height: 2,
    borderRadius: radius.full,
    backgroundColor: color.fgFaint,
    transformOrigin: "left",
    animationName: fill,
    animationTimingFunction: "linear",
    animationFillMode: "both",
    opacity: 0.55,
  },
  duration: (ms: number) => ({
    animationDuration: `${ms}ms`,
  }),
  progressHeld: {
    animationPlayState: "paused",
  },
  pause: {
    display: "grid",
    placeItems: "center",
    width: 40,
    height: 40,
    flexShrink: 0,
    border: "none",
    borderRadius: radius.full,
    backgroundColor: {
      default: color.ui,
      ":hover": { default: null, [media.hover]: color.uiActive },
    },
    color: color.fg,
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: motion.fast,
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
    outlineOffset: 2,
  },
});
