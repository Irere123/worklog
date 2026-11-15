import { PlusIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";

import { color, font, media, motion, radius, space } from "#ui/tokens.stylex";

import { Intro } from "./intro";
import { AI, OPEN, PRIVACY, START } from "./questions";
import type { Question } from "./questions";
import { focus, links, page } from "./styles";

// The five a team asks first; the rest wait on the FAQ page.
const FIRST: Question[] = [START[1], OPEN[1], AI[0], AI[2], PRIVACY[0]].filter(
  (each) => each !== undefined
);

/** The questions a team asks before it sets anything up, answered in a line or two each. */
export function Faq() {
  return (
    <section {...stylex.props(page.narrow, page.section)}>
      <Intro title="Before you start." />
      <div {...stylex.props(styles.column)}>
        <Questions items={FIRST} />
        <a href="/faq" {...stylex.props(links.quiet, styles.more)}>
          More questions, answered
        </a>
      </div>
    </section>
  );
}

/** A list of questions that open in place, each with its answer. */
export function Questions({ items }: { items: Question[] }) {
  return (
    <div {...stylex.props(styles.list)}>
      {items.map((item) => (
        <details key={item.ask} {...stylex.props(styles.item)}>
          <summary {...stylex.props(focus.ring, styles.ask)}>
            <span>{item.ask}</span>
            <PlusIcon size={16} {...stylex.props(styles.icon)} />
          </summary>
          <p {...stylex.props(styles.answer)}>{item.answer}</p>
        </details>
      ))}
    </div>
  );
}

const styles = stylex.create({
  column: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.x3,
    maxWidth: 640,
    marginInline: "auto",
  },
  more: {
    fontSize: 13,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
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
