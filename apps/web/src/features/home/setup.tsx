import { ArrowRightIcon, XIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useQueries } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { LinkProps } from "@tanstack/react-router";
import { useState } from "react";

import { q } from "#api/queries";
import { color, leading, media, radius, space, text } from "#ui/tokens.stylex";

type Step = {
  key: string;
  label: string;
  hint: string;
  to: LinkProps["to"];
  done: boolean;
};

const DISMISSED = "worklog.setup.dismissed";

const setupQueries = () =>
  [q.connections(), q.boards(), q.members(), q.targets(), q.voice()] as const;

/**
 * Whether the checklist knows if it will show. Until then the page holds what sits below it, so
 * the list doesn't arrive late and push everything down.
 */
export function useSetupSettled() {
  const results = useQueries({ queries: setupQueries() });
  return (
    localStorage.getItem(DISMISSED) === "1" ||
    results.every((r) => !r.isPending)
  );
}

/**
 * A new workspace is mostly empty pages; this says what makes Worklog useful, in order, and ticks
 * each step off from real data rather than from clicks.
 */
export function SetupChecklist({ meId }: { meId: string }) {
  const [hidden, setHidden] = useState(
    () => localStorage.getItem(DISMISSED) === "1"
  );
  const [connections, boards, members, targets, voice] = useQueries({
    queries: setupQueries(),
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
        <h2 {...stylex.props(styles.title)}>
          Get Worklog working for your team
        </h2>
        <span {...stylex.props(styles.count)}>
          {done} of {steps.length}
        </span>
        <button
          type="button"
          aria-label="Hide setup"
          onClick={() => {
            localStorage.setItem(DISMISSED, "1");
            setHidden(true);
          }}
          {...stylex.props(styles.close)}
        >
          <XIcon size={14} />
        </button>
      </header>
      {/* Finished steps drop out: once most are done, the card is the one thing left to do. */}
      <ol {...stylex.props(styles.steps)}>
        {steps
          .filter((step) => !step.done)
          .map((step) => (
            <li key={step.key}>
              <Link to={step.to} {...stylex.props(styles.step)}>
                <span {...stylex.props(styles.tick)} />
                <span {...stylex.props(styles.grow)}>
                  <span {...stylex.props(styles.label)}>{step.label}</span>
                  <span {...stylex.props(styles.hint)}>{step.hint}</span>
                </span>
                <ArrowRightIcon size={13} {...stylex.props(styles.go)} />
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
    gap: space.xs,
    paddingTop: space.lg,
    paddingBottom: space.sm,
    paddingInline: space.sm,
    borderRadius: radius.lg,
    // Flat and tinted so it reads as a note beside the page, not a second thing to type into.
    backgroundColor: color.surface,
    boxShadow: `inset 0 0 0 1px ${color.line}`,
  },
  head: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    paddingInlineStart: space.md,
  },
  grow: { flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" },
  title: { flexGrow: 1, fontSize: text.label, fontWeight: 600 },
  count: {
    flexShrink: 0,
    whiteSpace: "nowrap",
    fontSize: text.meta,
    color: color.fgMuted,
    fontVariantNumeric: "tabular-nums",
  },
  close: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: { default: 24, [media.touch]: 36 },
    height: { default: 24, [media.touch]: 36 },
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
  steps: { display: "flex", flexDirection: "column" },
  step: {
    display: "flex",
    alignItems: "center",
    gap: space.lg,
    paddingBlock: space.md,
    paddingInline: space.md,
    borderRadius: radius.md,
    color: {
      default: color.fgFaint,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.uiHover },
    },
  },
  tick: {
    width: 16,
    height: 16,
    flexShrink: 0,
    borderRadius: "50%",
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: color.lineStrong,
  },
  label: { fontSize: text.label, fontWeight: 500, color: color.fg },
  hint: { fontSize: text.meta, lineHeight: leading.meta, color: color.fgMuted },
  go: { flexShrink: 0 },
});
