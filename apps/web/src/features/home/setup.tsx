import { CheckIcon, XIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useQueries } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { LinkProps } from "@tanstack/react-router";
import { useState } from "react";

import { q } from "#api/queries";
import {
  color,
  leading,
  media,
  motion,
  radius,
  shadow,
  space,
  text,
} from "#ui/tokens.stylex";

type Step = {
  key: string;
  label: string;
  hint: string;
  to: LinkProps["to"];
  done: boolean;
};

const DISMISSED = "worklog.setup.dismissed";

/**
 * A new workspace is mostly empty pages; this says what makes Worklog useful, in order, and ticks
 * each step off from real data rather than from clicks.
 */
export function SetupChecklist({ meId }: { meId: string }) {
  const [hidden, setHidden] = useState(
    () => localStorage.getItem(DISMISSED) === "1"
  );
  const [connections, boards, members, targets, voice] = useQueries({
    queries: [q.connections(), q.boards(), q.members(), q.targets(), q.voice()],
  });
  if (
    hidden ||
    [connections, boards, members, targets, voice].some((r) => r.isPending)
  ) {
    return null;
  }
  const people = members.data ?? [];
  const steps: Step[] = [
    {
      key: "connect",
      label: "Connect where work happens",
      hint: "GitHub, GitLab or Slack, so activity arrives on its own.",
      to: "/settings/connections",
      done: (connections.data?.length ?? 0) > 0,
    },
    {
      key: "board",
      label: "Start a board",
      hint: "Cards for one stream of work. New ones wait in Maybe?",
      to: "/boards",
      done: (boards.data?.length ?? 0) > 0,
    },
    {
      key: "invite",
      label: "Invite your team",
      hint: "Everyone gets an assistant teammates can ask.",
      to: "/settings/members",
      done: people.some((m) => m.kind === "human" && m.id !== meId),
    },
    {
      key: "agent",
      label: "Add a coding agent",
      hint: "It reports progress and asks you only when it needs a decision.",
      to: "/settings/members",
      done: people.some(
        (m) => m.kind === "agent" && m.agentProvider !== "worklog"
      ),
    },
    {
      key: "delivery",
      label: "Choose where briefs go",
      hint: "Your email or a Slack channel.",
      to: "/settings/delivery",
      done: (targets.data?.length ?? 0) > 0,
    },
    {
      key: "voice",
      label: "Tell your assistant how to work for you",
      hint: "A few lines of your own words.",
      to: "/settings/assistant",
      done: Boolean(voice.data?.content.trim()),
    },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) {
    return null;
  }
  return (
    <section aria-label="Get set up" {...stylex.props(styles.card)}>
      <header {...stylex.props(styles.head)}>
        <div {...stylex.props(styles.grow)}>
          <h2 {...stylex.props(styles.title)}>
            Get Worklog working for your team
          </h2>
          <p {...stylex.props(styles.sub)}>
            {done} of {steps.length} done
          </p>
        </div>
        <button
          type="button"
          aria-label="Hide setup"
          onClick={() => {
            localStorage.setItem(DISMISSED, "1");
            setHidden(true);
          }}
          {...stylex.props(styles.close)}
        >
          <XIcon size={15} />
        </button>
      </header>
      <div {...stylex.props(styles.track)} aria-hidden>
        <div {...stylex.props(styles.fill(done / steps.length))} />
      </div>
      <ol {...stylex.props(styles.steps)}>
        {steps.map((step) => (
          <li key={step.key}>
            <Link
              to={step.to}
              {...stylex.props(styles.step, step.done && styles.stepDone)}
            >
              <span
                {...stylex.props(styles.tick, step.done && styles.tickDone)}
              >
                {step.done && <CheckIcon size={12} weight="bold" />}
              </span>
              <span {...stylex.props(styles.grow)}>
                <span
                  {...stylex.props(styles.label, step.done && styles.labelDone)}
                >
                  {step.label}
                </span>
                {!step.done && (
                  <span {...stylex.props(styles.hint)}>{step.hint}</span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

const styles = stylex.create({
  card: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    padding: space.xl,
    borderRadius: radius.lg,
    backgroundColor: color.raised,
    boxShadow: shadow.card,
  },
  head: { display: "flex", alignItems: "flex-start", gap: space.md },
  grow: { flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" },
  title: {
    fontSize: text.titleSm,
    lineHeight: leading.titleSm,
    fontWeight: 600,
  },
  sub: {
    fontSize: text.meta,
    color: color.fgMuted,
    fontVariantNumeric: "tabular-nums",
  },
  close: {
    display: "grid",
    placeItems: "center",
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    color: {
      default: color.fgFaint,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.uiHover },
    },
  },
  track: {
    height: 4,
    borderRadius: radius.full,
    backgroundColor: color.ui,
    overflow: "hidden",
  },
  fill: (ratio: number) => ({
    width: `${Math.round(ratio * 100)}%`,
    height: "100%",
    borderRadius: radius.full,
    backgroundColor: color.accent,
    transitionProperty: "width",
    transitionDuration: motion.slow,
  }),
  steps: {
    display: "grid",
    gridTemplateColumns: {
      default: "1fr 1fr",
      "@media (max-width: 640px)": "1fr",
    },
    gap: space.xs,
  },
  step: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.md,
    paddingBlock: space.md,
    paddingInline: space.md,
    borderRadius: radius.md,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.surface },
    },
  },
  stepDone: { opacity: 0.7 },
  tick: {
    display: "grid",
    placeItems: "center",
    width: 18,
    height: 18,
    marginTop: 1,
    flexShrink: 0,
    borderRadius: "50%",
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: color.lineStrong,
    color: color.fgOnSolid,
  },
  tickDone: { borderColor: color.green, backgroundColor: color.green },
  label: { fontSize: text.label, fontWeight: 500, color: color.fg },
  labelDone: {
    textDecoration: "line-through",
    textDecorationColor: color.fgFaint,
    color: color.fgMuted,
  },
  hint: { fontSize: text.meta, lineHeight: leading.meta, color: color.fgMuted },
});
