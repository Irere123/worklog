import { EnvelopeSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";

import { AppWindow } from "#features/landing/frame";
import { useScript } from "#features/landing/script";
import { Logo } from "#ui/logo";
import { ProductMark } from "#ui/product-mark";
import { color, radius, space, text } from "#ui/tokens.stylex";

import { CardNumber, PaneHeader, Pill, parts } from "./parts";
import type { SceneProps } from "./parts";

const FIGURES = [
  { label: "Need you", value: 3, tone: "accent" },
  { label: "In progress", value: 4 },
  { label: "Closed", value: 6 },
  { label: "Drifting soon", value: 1 },
] as const;

// The lines that need Ada, written into the brief one after another.
const LINES = [
  {
    key: "atlas",
    width: "88%",
    text: (
      <>
        <strong>Atlas needs you:</strong> approve Saturday’s window for the
        Postgres 18 upgrade
      </>
    ),
  },
  {
    key: "jean",
    width: "74%",
    text: (
      <>
        Jean Miller assigned you <CardNumber>8</CardNumber> Track referral
        turnaround per county
      </>
    ),
  },
  {
    key: "drift",
    width: "80%",
    text: (
      <>
        <CardNumber>9</CardNumber> Let receiving clinicians reply drifts to Not
        now on Thursday
      </>
    ),
  },
];

type State = { figures: boolean; lines: number; sent: boolean };

const START: State = { figures: false, lines: 0, sent: false };
const END: State = { figures: true, lines: 3, sent: true };

/**
 * Briefs: the morning brief writes itself from the record, figures first, then the few lines that
 * need you, and goes out where you read, here as a Slack message.
 */
export function BriefsScene({ play, paused, still }: SceneProps) {
  const [s, setS] = useState(still ? END : START);
  const set = (next: Partial<State>) => setS((now) => ({ ...now, ...next }));

  useScript(
    async (a) => {
      await a.wait(900);
      set({ figures: true });
      await a.wait(1100);
      for (const lines of [1, 2, 3]) {
        set({ lines });
        // oxlint-disable-next-line no-await-in-loop -- the lines arrive one after another
        await a.wait(500);
      }
      await a.wait(900);
      set({ sent: true });
    },
    { running: play && !still, paused }
  );

  return (
    <AppWindow
      nav="briefs"
      inbox={3}
      overlay={
        <div {...stylex.props(styles.slack, s.sent && styles.slackShown)}>
          <span {...stylex.props(styles.slackHead)}>
            <ProductMark product="slack" size={14} />
            <span {...stylex.props(parts.strong)}>#referrals</span>
            <span {...stylex.props(styles.slackTime)}>8:00</span>
          </span>
          <span {...stylex.props(styles.slackBody)}>
            <span {...stylex.props(styles.appIcon)}>
              <Logo size={22} />
            </span>
            <span {...stylex.props(styles.slackText)}>
              <span>
                <span {...stylex.props(parts.strong)}>Worklog</span>{" "}
                <span {...stylex.props(styles.app)}>APP</span>
              </span>
              <span>Morning brief: 3 need you, 6 closed since Friday.</span>
            </span>
          </span>
          <span {...stylex.props(styles.also)}>
            <EnvelopeSimpleIcon size={12} /> Also sent by email
          </span>
        </div>
      }
    >
      <div {...stylex.props(styles.root)}>
        <PaneHeader
          title="Briefs"
          end={
            <span {...stylex.props(styles.make)}>
              <PlusIcon size={13} weight="bold" /> Make one now
            </span>
          }
        />
        <div {...stylex.props(styles.doc)}>
          <Pill tone="blue">Daily brief</Pill>
          <span {...stylex.props(styles.title)}>
            Morning brief for Ada Chen
          </span>
          <span {...stylex.props(parts.muted)}>
            Monday, 9 November · 8:00
            <span {...stylex.props(styles.sentNote)}>
              {" "}
              · Sent to Slack and email
            </span>
          </span>

          <div {...stylex.props(styles.figures)}>
            {FIGURES.map((figure) => (
              <span key={figure.label} {...stylex.props(styles.figure)}>
                <span {...stylex.props(styles.figureLabel)}>
                  {figure.label}
                </span>
                <span
                  {...stylex.props(
                    styles.figureValue,
                    "tone" in figure && styles.figureAccent
                  )}
                >
                  {s.figures ? (
                    figure.value
                  ) : (
                    <span
                      {...stylex.props(styles.skeleton, styles.skeletonFigure)}
                    />
                  )}
                </span>
              </span>
            ))}
          </div>

          <span {...stylex.props(styles.heading)}>Needs your attention</span>
          <ul {...stylex.props(styles.list)}>
            {LINES.map((line, at) => (
              <li key={line.key} {...stylex.props(styles.item)}>
                {s.lines > at ? (
                  <span {...stylex.props(styles.written)}>{line.text}</span>
                ) : (
                  <span
                    {...stylex.props(
                      styles.skeleton,
                      styles.skeletonLine(line.width)
                    )}
                  />
                )}
              </li>
            ))}
          </ul>
          <span {...stylex.props(styles.heading)}>Shipped since Friday</span>
          <span {...stylex.props(styles.paragraph)}>
            Eric fixed <CardNumber sx={styles.link}>1</CardNumber> attachments
            on slow connections; Atlas finished the SMS fallback prototype.
          </span>
          <span {...stylex.props(styles.heading)}>Still stuck</span>
          <span {...stylex.props(styles.paragraph)}>
            The nightly sync on the Denver server,{" "}
            <CardNumber sx={styles.link}>14</CardNumber>. Scout found the cause;
            Eric is fixing it today.
          </span>
        </div>
      </div>
    </AppWindow>
  );
}

const styles = stylex.create({
  root: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    height: "100%",
  },
  make: {
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
  doc: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.xs,
    width: "100%",
    maxWidth: 600,
    marginInline: "auto",
    paddingTop: space.x4,
    paddingInline: space.x3,
  },
  title: {
    marginTop: space.md,
    fontSize: 24,
    lineHeight: "30px",
    fontWeight: 600,
    letterSpacing: "-0.015em",
  },
  figures: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    alignSelf: "stretch",
    marginTop: space.xl,
    paddingBlock: space.lg,
    borderBlockWidth: 1,
    borderBlockStyle: "solid",
    borderBlockColor: color.line,
  },
  figure: {
    display: "flex",
    flexDirection: "column",
    gap: space.xxs,
    paddingLeft: { default: space.lg, ":first-child": 0 },
    borderLeftWidth: { default: 1, ":first-child": 0 },
    borderLeftStyle: "solid",
    borderLeftColor: color.line,
  },
  figureLabel: {
    fontSize: text.meta,
    color: color.fgMuted,
    whiteSpace: "nowrap",
  },
  figureValue: {
    fontSize: 24,
    lineHeight: "30px",
    fontWeight: 600,
  },
  figureAccent: {
    color: color.accentFg,
  },
  heading: {
    marginTop: space.xl,
    fontSize: text.titleSm,
    fontWeight: 600,
  },
  list: {
    alignSelf: "stretch",
    margin: 0,
    marginTop: space.xs,
    paddingLeft: 0,
  },
  item: {
    display: "flex",
    alignItems: "center",
    minHeight: 24,
  },
  written: {
    animationName: stylex.keyframes({
      from: { opacity: 0 },
      to: { opacity: 1 },
    }),
    animationDuration: "300ms",
  },
  // Placeholders at the written content's own size, so nothing moves when the words replace them.
  skeleton: {
    display: "block",
    height: 10,
    borderRadius: radius.full,
    backgroundColor: color.ui,
  },
  skeletonFigure: {
    width: 28,
    height: 22,
    marginBlock: 4,
    borderRadius: radius.sm,
  },
  skeletonLine: (width: string) => ({
    width,
  }),
  link: {
    color: color.accentFg,
    fontSize: text.label,
  },
  paragraph: {
    marginTop: space.xs,
  },
  // Over the sidebar's empty foot, so the delivered message never hides the brief it carries.
  // A phone has no sidebar to carry the message, so the brief's own date line says where it went.
  sentNote: {
    display: {
      default: "none",
      "@media (max-width: 719px)": "inline",
    },
  },
  slack: {
    display: {
      default: "flex",
      "@media (max-width: 719px)": "none",
    },
    position: "absolute",
    left: {
      default: space.lg,
      "@media (max-width: 719px)": "auto",
    },
    right: {
      default: "auto",
      "@media (max-width: 719px)": space.lg,
    },
    bottom: 64,
    flexDirection: "column",
    gap: space.md,
    // Narrow enough to end before the brief's text column: it covers the sidebar, never words.
    width: 236,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.raised,
    boxShadow:
      "0 0 0 1px oklch(0.2 0.01 80 / 0.08), 0 12px 32px oklch(0.2 0.01 80 / 0.16)",
    opacity: 0,
    transform: "translateY(10px) scale(0.98)",
    transitionProperty: "opacity, transform",
    transitionDuration: "560ms",
    transitionTimingFunction: "cubic-bezier(0.25, 0.8, 0.25, 1)",
  },
  slackShown: {
    opacity: 1,
    transform: "none",
  },
  slackHead: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    fontSize: text.meta,
  },
  slackTime: {
    marginLeft: "auto",
    color: color.fgFaint,
  },
  slackBody: {
    display: "flex",
    gap: space.md,
  },
  appIcon: {
    display: "grid",
    placeItems: "center",
    width: 32,
    height: 32,
    flexShrink: 0,
    borderRadius: radius.md,
    backgroundColor: color.ui,
  },
  slackText: {
    display: "flex",
    flexDirection: "column",
    lineHeight: "19px",
  },
  app: {
    paddingInline: space.xs,
    borderRadius: radius.xs,
    backgroundColor: color.ui,
    color: color.fgMuted,
    fontSize: 9,
    fontWeight: 600,
  },
  also: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: color.line,
    fontSize: text.meta,
    color: color.fgMuted,
  },
});
