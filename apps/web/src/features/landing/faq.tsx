import { PlusIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useRef } from "react";
import type { ReactNode } from "react";

import { color, font, media, motion, radius, space } from "#ui/tokens.stylex";

import { Intro } from "./intro";
import { useReveal } from "./script";
import { page, reveal } from "./styles";

const QUESTIONS: { ask: string; answer: ReactNode }[] = [
  {
    ask: "Is Worklog open source?",
    answer: (
      <>
        Yes. The server, the worker and the web app are all on GitHub, and the
        hosted Worklog runs the same code. Read it, file an issue, or send a
        pull request.
      </>
    ),
  },
  {
    ask: "Can we host it ourselves?",
    answer: (
      <>
        Yes. Run it on your own server with Docker Compose, or deploy it to
        Railway, and your data stays in your own Postgres. Telemetry is off
        unless you give it a Tinybird token.
      </>
    ),
  },
  {
    ask: "Do we need AI?",
    answer: (
      <>
        No. Without a model, briefs are written from templates and rules, and
        the board, inbox and activity work the same. With one, the assistant
        answers and briefs are written in sentences.
      </>
    ),
  },
  {
    ask: "Which tools connect?",
    answer: (
      <>
        GitHub and Slack install in one step and bring their recent history.
        GitLab, Gitea, Forgejo and Discord connect with a token, and any other
        tool can post to a webhook mapped by rules. People log the rest in a
        sentence.
      </>
    ),
  },
  {
    ask: "How do agents join the team?",
    answer: (
      <>
        Each agent gets its own API key, scoped to read, write or ingest. It
        owns cards, reports progress, and asks its person when a change needs a
        decision. Everything it does is labelled as the agent’s.
      </>
    ),
  },
  {
    ask: "Who sees what?",
    answer: (
      <>
        Teammates see the team’s work. Anything private stays yours, and that
        rule is kept by the server, so a teammate’s question to your assistant
        never reaches it.
      </>
    ),
  },
];

/** The questions a team asks before it sets anything up, answered in a line or two each. */
export function Faq() {
  const list = useRef<HTMLDivElement>(null);
  const on = useReveal(list);
  return (
    <section {...stylex.props(page.narrow, page.section)}>
      <Intro title="Before you set it up." />
      <div
        ref={list}
        {...stylex.props(
          styles.list,
          reveal.line,
          reveal.delay(150),
          on && reveal.on
        )}
      >
        {QUESTIONS.map((item) => (
          <details key={item.ask} {...stylex.props(styles.item)}>
            <summary {...stylex.props(styles.ask)}>
              <span>{item.ask}</span>
              <PlusIcon size={16} {...stylex.props(styles.icon)} />
            </summary>
            <p {...stylex.props(styles.answer)}>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

const styles = stylex.create({
  list: {
    display: "flex",
    flexDirection: "column",
    maxWidth: 640,
    marginInline: "auto",
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: color.line,
  },
  item: {
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
  },
  ask: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.xl,
    paddingBlock: 18,
    fontFamily: font.sans,
    fontSize: 15,
    fontWeight: 500,
    listStyle: "none",
    cursor: "pointer",
    color: {
      default: color.fg,
      ":hover": { default: null, [media.hover]: color.accentFg },
    },
    transitionProperty: "color",
    transitionDuration: motion.fast,
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
    outlineOffset: 4,
    borderRadius: radius.xs,
    // Safari draws its own disclosure triangle unless the marker is hidden this way.
    "::-webkit-details-marker": {
      display: "none",
    },
  },
  icon: {
    flexShrink: 0,
    color: color.fgMuted,
    transitionProperty: "transform",
    transitionDuration: motion.base,
    transitionTimingFunction: motion.out,
    // The plus turns into a cross when the answer is open: the same strokes, rotated.
    transform: {
      default: "none",
      ":is([open] > summary > *)": "rotate(45deg)",
    },
  },
  answer: {
    margin: 0,
    paddingBottom: space.xxl,
    maxWidth: 580,
    fontSize: 14,
    lineHeight: "22px",
    color: color.fgMuted,
    textWrap: "pretty",
  },
});
