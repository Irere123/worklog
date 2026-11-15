import {
  CaretLeftIcon,
  CaretRightIcon,
  PauseIcon,
  PlayIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";

import { color, media, space } from "#ui/tokens.stylex";

import { Plate } from "./frame";
import clay from "./plates/clay.webp";
import ink from "./plates/ink.webp";
import sage from "./plates/sage.webp";
import sky from "./plates/sky.webp";
import activityThumb from "./plates/thumbs/activity.webp";
import boardThumb from "./plates/thumbs/board.webp";
import briefsThumb from "./plates/thumbs/briefs.webp";
import homeThumb from "./plates/thumbs/home.webp";
import inboxThumb from "./plates/thumbs/inbox.webp";
import ticket from "./plates/ticket.webp";
import { ActivityScene } from "./scenes/activity";
import { BoardScene } from "./scenes/board";
import { BriefsScene } from "./scenes/briefs";
import { HomeScene } from "./scenes/home";
import { InboxScene } from "./scenes/inbox";
import type { SceneProps } from "./scenes/parts";
import { useInView, useReducedMotion } from "./script";
import { focus, page } from "./styles";

type Chapter = {
  id: string;
  label: string;
  caption: string;
  plate: string;
  thumb: string;
  duration: number;
  Scene: ComponentType<SceneProps>;
};

const HOME: Chapter = {
  id: "home",
  label: "Home",
  caption: "What needs you today, and what moved while you were away.",
  plate: ink,
  thumb: homeThumb,
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
    thumb: inboxThumb,
    duration: 7500,
    Scene: InboxScene,
  },
  {
    id: "board",
    label: "Board",
    caption:
      "Golden tickets instead of priorities. Cards nobody touches drift away.",
    plate: sage,
    thumb: boardThumb,
    duration: 8000,
    Scene: BoardScene,
  },
  {
    id: "activity",
    label: "Activity",
    caption:
      "GitHub, Slack, Discord and agents in one stream, with the noise left out.",
    plate: sky,
    thumb: activityThumb,
    duration: 8500,
    Scene: ActivityScene,
  },
  {
    id: "briefs",
    label: "Briefs",
    caption:
      "A morning brief and a weekly wrap, by email, Slack, Discord or webhook.",
    plate: clay,
    thumb: briefsThumb,
    duration: 8000,
    Scene: BriefsScene,
  },
];

const PLATES = [ink, ticket, sage, sky, clay];

// The window is laid out at the app's own size and scaled to the wallpaper, as a screenshot would
// be: the miniature keeps the app's proportions instead of reflowing into a cramped one.
const DESIGN_WIDTH = 1000;
// A tablet's window lays out narrower instead of shrinking further, so its words stay readable.
const NARROWEST = 860;
// What a 1440px screen shows, so the first paint is already the right size.
const FIRST_SCALE = 0.806;
// The slide lasts as long as resurf's: long enough to read as one window leaving for the next.
const SLIDE = 700;

type Shown = { index: number; round: number; from: 1 | -1 };

/**
 * The product tour: the app's own window on a wallpaper, one chapter at a time. Each chapter plays
 * a short scene and slides over to the next; the arrows and thumbnails jump, Pause holds it.
 */
export function Tour() {
  const ref = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<Shown>({ index: 0, round: 0, from: 1 });
  const [leaving, setLeaving] = useState<Shown | null>(null);
  // Wallpapers mount as the tour reaches them, plus the next one so its change can crossfade: a
  // first visit fetches two, not five. Once mounted they stay, so the loop back fades too.
  const [reached, setReached] = useState(0);
  const [paused, setPaused] = useState(false);
  const [scale, setScale] = useState(FIRST_SCALE);
  const chapter = CHAPTERS.at(shown.index) ?? HOME;
  const auto = !reduced;
  const holding = paused || !inView;

  useEffect(() => {
    const element = stage.current;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      if (width > 0) {
        setScale(
          width /
            Math.max(NARROWEST, Math.min(DESIGN_WIDTH, width / FIRST_SCALE))
        );
      }
    });
    if (element) {
      observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timer = leaving
      ? setTimeout(() => setLeaving(null), SLIDE)
      : undefined;
    return () => clearTimeout(timer);
  }, [leaving]);

  function go(next: number, from: 1 | -1 = 1) {
    const to = (next + CHAPTERS.length) % CHAPTERS.length;
    setReached((now) => Math.max(now, to));
    setLeaving(reduced ? null : shown);
    setShown({ index: to, round: shown.round + 1, from });
  }

  const slides = leaving ? [leaving, shown] : [shown];

  return (
    <section
      id="tour"
      aria-roledescription="carousel"
      aria-label="Product tour"
      {...stylex.props(page.wide, styles.tour)}
    >
      <div ref={ref} {...stylex.props(styles.frame)}>
        <Plate
          src={chapter.plate}
          choices={PLATES.slice(0, reached + 2)}
          priority
          sx={styles.plate}
        >
          {/* A picture of the app: the caption below says what it shows, in words. */}
          <div ref={stage} aria-hidden {...stylex.props(styles.stage)}>
            {slides.map((slide) => {
              const each = CHAPTERS.at(slide.index) ?? HOME;
              const out = slide === leaving;
              return (
                <div
                  key={`${each.id}-${slide.round}`}
                  {...stylex.props(
                    styles.slide,
                    !reduced && !out && slide.round > 0 && styles.slideIn,
                    out && styles.slideOut,
                    styles.from(out ? -shown.from : slide.from)
                  )}
                >
                  <div {...stylex.props(styles.design, styles.scale(scale))}>
                    <each.Scene
                      play={inView && !out}
                      paused={holding || out}
                      still={reduced}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Plate>
        <button
          type="button"
          aria-label="Previous chapter"
          onClick={() => go(shown.index - 1, -1)}
          {...stylex.props(focus.ring, styles.arrow, styles.arrowLeft)}
        >
          <CaretLeftIcon size={16} weight="bold" />
        </button>
        <button
          type="button"
          aria-label="Next chapter"
          onClick={() => go(shown.index + 1)}
          {...stylex.props(focus.ring, styles.arrow, styles.arrowRight)}
        >
          <CaretRightIcon size={16} weight="bold" />
        </button>
        {auto && (
          <Pause
            paused={paused}
            onToggle={() => setPaused((now) => !now)}
            sx={styles.pauseOnPlate}
          />
        )}
      </div>

      <div {...stylex.props(styles.captions)} aria-live="polite">
        {CHAPTERS.map((each, at) => (
          <p
            key={each.id}
            aria-hidden={at !== shown.index}
            {...stylex.props(
              styles.caption,
              at === shown.index && styles.captionOn
            )}
          >
            <span {...stylex.props(styles.captionLead)}>{each.label}</span>{" "}
            {each.caption}
          </p>
        ))}
      </div>

      <div
        role="tablist"
        aria-label="Tour chapters"
        {...stylex.props(styles.thumbs)}
      >
        {CHAPTERS.map((each, at) => (
          <button
            key={each.id}
            type="button"
            role="tab"
            aria-selected={at === shown.index}
            aria-label={each.label}
            onClick={() => go(at, at < shown.index ? -1 : 1)}
            {...stylex.props(
              styles.thumb,
              at === shown.index && styles.thumbOn
            )}
          >
            <img
              src={each.thumb}
              alt=""
              width={320}
              height={200}
              loading="lazy"
              decoding="async"
              draggable={false}
              {...stylex.props(styles.thumbImage)}
            />
            {auto && at === shown.index && (
              <span
                key={shown.round}
                onAnimationEnd={() => go(shown.index + 1)}
                {...stylex.props(
                  styles.progress,
                  styles.duration(each.duration),
                  holding && styles.progressHeld
                )}
              />
            )}
          </button>
        ))}
        {auto && (
          <Pause
            paused={paused}
            onToggle={() => setPaused((now) => !now)}
            sx={styles.pauseInRow}
          />
        )}
      </div>
    </section>
  );
}

/**
 * Holds the tour where it is. On a wide screen it rests on the wallpaper's corner; a phone's window
 * fills the wallpaper, so there it ends the row of chapters instead of covering the app's words.
 */
function Pause({
  paused,
  onToggle,
  sx,
}: {
  paused: boolean;
  onToggle: () => void;
  sx: StyleXStyles;
}) {
  return (
    <button
      type="button"
      aria-label={paused ? "Play the tour" : "Pause the tour"}
      onClick={onToggle}
      {...stylex.props(focus.ring, styles.pause, sx)}
    >
      {paused ? (
        <PlayIcon size={14} weight="fill" />
      ) : (
        <PauseIcon size={14} weight="fill" />
      )}
      <span {...stylex.props(styles.pauseLabel)}>
        {paused ? "Play" : "Pause"}
      </span>
    </button>
  );
}

const fill = stylex.keyframes({
  from: { transform: "scaleX(0)" },
  to: { transform: "scaleX(1)" },
});

const slideIn = stylex.keyframes({
  from: { translate: "calc(112% * var(--tour-from))" },
  to: { translate: "0" },
});

const slideOut = stylex.keyframes({
  from: { translate: "0" },
  to: { translate: "calc(112% * var(--tour-from))" },
});

const PHONE = "@media (max-width: 719px)";
const GLIDE = "cubic-bezier(0.32, 0.72, 0, 1)";

const styles = stylex.create({
  tour: {
    // Clears the sticky nav, so "Tour" lands on the whole wallpaper.
    scrollMarginTop: 72,
    marginTop: {
      default: 64,
      [PHONE]: 48,
    },
  },
  frame: {
    position: "relative",
  },
  plate: {
    borderRadius: {
      default: 10,
      [PHONE]: 8,
    },
    aspectRatio: {
      default: "2632 / 1658",
      [PHONE]: "auto",
    },
    height: {
      default: "auto",
      [PHONE]: 480,
    },
    boxShadow:
      "inset 0 0 0 1px oklch(0.2 0.01 80 / 0.1), 0 2px 6px oklch(0 0 0 / 0.03), 0 16px 40px oklch(0 0 0 / 0.05), 0 40px 100px oklch(0 0 0 / 0.07)",
  },
  // Where the window stands on the wallpaper: resurf's proportions, an even margin either side and
  // a little more air above than below, like a window on a desktop.
  stage: {
    position: "absolute",
    top: {
      default: "9.72%",
      [PHONE]: 24,
    },
    left: {
      default: "8%",
      [PHONE]: space.xl,
    },
    width: {
      default: "84%",
      [PHONE]: `calc(100% - 2 * ${space.xl})`,
    },
    // A phone's window runs off the wallpaper's foot instead: whole, it would be too small to read.
    // It fades out just above the edge, so no line of the app is sliced through.
    height: {
      default: "84%",
      [PHONE]: 520,
    },
    maskImage: {
      default: "none",
      [PHONE]: "linear-gradient(to bottom, #000 392px, transparent 448px)",
    },
  },
  slide: {
    position: "absolute",
    inset: 0,
    "--tour-from": "1",
  },
  from: (from: number) => ({
    "--tour-from": `${from}`,
  }),
  slideIn: {
    animationName: slideIn,
    animationDuration: `${SLIDE}ms`,
    animationTimingFunction: GLIDE,
    animationFillMode: "both",
  },
  slideOut: {
    animationName: slideOut,
    animationDuration: `${SLIDE}ms`,
    animationTimingFunction: GLIDE,
    animationFillMode: "both",
    pointerEvents: "none",
  },
  design: {
    display: "grid",
    width: {
      default: "calc(100% / var(--tour-scale))",
      [PHONE]: "100%",
    },
    height: {
      default: "calc(100% / var(--tour-scale))",
      [PHONE]: "100%",
    },
    transformOrigin: "top left",
    transform: {
      default: "scale(var(--tour-scale))",
      [PHONE]: "none",
    },
  },
  scale: (scale: number) => ({
    "--tour-scale": `${scale}`,
  }),
  arrow: {
    position: "absolute",
    top: "50%",
    zIndex: 2,
    // A phone's window fills the wallpaper, so an arrow there would sit on the app's words; the
    // row of chapters below is the way through.
    display: {
      default: "grid",
      [PHONE]: "none",
    },
    placeItems: "center",
    width: {
      default: 40,
      [PHONE]: 32,
    },
    height: {
      default: 40,
      [PHONE]: 32,
    },
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: 999,
    backgroundColor: {
      default: "oklch(1 0 0 / 0.9)",
      ":hover": { default: null, [media.hover]: color.raised },
    },
    backdropFilter: "blur(12px)",
    boxShadow: {
      default:
        "0 0 0 0.5px oklch(0 0 0 / 0.1), 0 1px 2px oklch(0 0 0 / 0.08), 0 4px 12px -2px oklch(0 0 0 / 0.16)",
      ":hover": {
        default: null,
        [media.hover]:
          "0 0 0 0.5px oklch(0 0 0 / 0.1), 0 1px 2px oklch(0 0 0 / 0.08), 0 8px 20px -4px oklch(0 0 0 / 0.22)",
      },
    },
    color: {
      default: "oklch(0.22 0.01 80 / 0.7)",
      ":hover": { default: null, [media.hover]: color.fg },
    },
    cursor: "pointer",
    transform: {
      default: "translateY(-50%)",
      ":active": "translateY(-50%) scale(0.95)",
    },
    transitionProperty: "color, background-color, box-shadow, transform",
    transitionDuration: "200ms",
    transitionTimingFunction: "ease-out",
  },
  arrowLeft: {
    left: {
      default: space.xl,
      [PHONE]: space.md,
    },
  },
  arrowRight: {
    right: {
      default: space.xl,
      [PHONE]: space.md,
    },
  },
  pause: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.md,
    minWidth: 44,
    height: 44,
    paddingInline: {
      default: space.xxl,
      [PHONE]: space.lg,
    },
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: 999,
    backgroundColor: {
      default: "oklch(1 0 0 / 0.9)",
      ":hover": { default: null, [media.hover]: "oklch(1 0 0 / 0.8)" },
    },
    backdropFilter: "blur(24px)",
    boxShadow: "0 1px 3px oklch(0 0 0 / 0.12)",
    color: "oklch(0 0 0)",
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    transitionProperty: "background-color, transform",
    transitionDuration: "200ms",
    transform: { default: null, ":active": "scale(0.96)" },
  },
  // Inside the window's corner, as a player's control sits on its video, not astride the frame.
  pauseOnPlate: {
    position: "absolute",
    right: `calc(8% + ${space.xl})`,
    bottom: `calc(6.28% + ${space.xl})`,
    zIndex: 2,
    display: {
      default: "inline-flex",
      [PHONE]: "none",
    },
  },
  // First in the row, where a thumb reaches it without scrolling the chapters along.
  pauseInRow: {
    order: -1,
    alignSelf: "center",
    flexShrink: 0,
    backgroundColor: color.ui,
    boxShadow: "none",
    color: color.fg,
    display: {
      default: "none",
      [PHONE]: "inline-flex",
    },
  },
  pauseLabel: {
    display: {
      default: "inline",
      [PHONE]: "none",
    },
  },
  // Every caption is laid in one cell, so the line below never jumps as they change.
  captions: {
    display: "grid",
    maxWidth: 640,
    marginTop: space.x3,
    marginInline: "auto",
    textAlign: "center",
  },
  caption: {
    gridArea: "1 / 1",
    margin: 0,
    fontSize: 15,
    lineHeight: "24px",
    color: color.fgMuted,
    textWrap: "balance",
    opacity: 0,
    visibility: "hidden",
    transitionProperty: "opacity, visibility",
    transitionDuration: "150ms",
    transitionTimingFunction: "ease-out",
  },
  captionOn: {
    opacity: 1,
    visibility: "visible",
    transitionDuration: "300ms",
  },
  captionLead: {
    color: color.fg,
    fontWeight: 500,
  },
  thumbs: {
    display: "flex",
    justifyContent: {
      default: "center",
      [PHONE]: "flex-start",
    },
    gap: {
      default: space.xxl,
      "@media (max-width: 1023px)": space.xl,
      [PHONE]: space.lg,
    },
    marginTop: space.xxl,
    marginInline: {
      default: 0,
      [PHONE]: `calc(-1 * ${space.x3})`,
    },
    paddingBlock: space.lg,
    paddingInline: {
      default: space.lg,
      [PHONE]: space.x3,
    },
    overflowX: "auto",
    overscrollBehaviorX: "contain",
    scrollbarWidth: "none",
  },
  thumb: {
    position: "relative",
    flexShrink: 0,
    overflow: "hidden",
    width: {
      default: 136,
      "@media (max-width: 1023px)": 104,
      [PHONE]: 112,
    },
    aspectRatio: "16 / 10",
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: 6,
    backgroundColor: color.ui,
    boxShadow: {
      default:
        "0 1px 2px oklch(0 0 0 / 0.06), 0 4px 12px -4px oklch(0 0 0 / 0.12)",
      ":hover": {
        default: null,
        [media.hover]:
          "0 2px 4px oklch(0 0 0 / 0.06), 0 8px 18px -6px oklch(0 0 0 / 0.16)",
      },
    },
    opacity: {
      default: 0.75,
      ":hover": { default: null, [media.hover]: 1 },
    },
    transform: {
      default: null,
      ":hover": { default: null, [media.hover]: "translateY(-1px)" },
    },
    cursor: "pointer",
    outlineWidth: 2,
    outlineStyle: "solid",
    outlineColor: {
      default: "transparent",
      ":focus-visible": color.focus,
    },
    outlineOffset: 4,
    transitionProperty: "opacity, box-shadow, transform, outline-color",
    transitionDuration: "200ms",
    transitionTimingFunction: "ease-out",
    // A hairline inside the picture's edge, so a pale screenshot doesn't melt into the page.
    "::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      borderRadius: "inherit",
      boxShadow: "inset 0 0 0 1px oklch(0.2 0.01 80 / 0.1)",
      pointerEvents: "none",
    },
  },
  thumbOn: {
    opacity: 1,
    outlineColor: color.accent,
  },
  thumbImage: {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  progress: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
    height: 3,
    backgroundColor: color.accent,
    transformOrigin: "left",
    animationName: fill,
    animationTimingFunction: "linear",
    animationFillMode: "both",
  },
  duration: (ms: number) => ({
    animationDuration: `${ms}ms`,
  }),
  progressHeld: {
    animationPlayState: "paused",
  },
});
