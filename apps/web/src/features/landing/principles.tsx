import * as stylex from "@stylexjs/stylex";
import { useRef } from "react";
import type { ReactNode } from "react";

import { Avatar } from "#ui/avatar";
import { Ghost } from "#ui/ghost";
import { color, font, radius, shadow, space, text } from "#ui/tokens.stylex";

import { Intro } from "./intro";
import { useReveal } from "./script";
import { page, reveal, type } from "./styles";
import { ada, atlas, eric, grace, jean, scout } from "./team";

/**
 * What Worklog promises, in place of quotes: three values from docs/DESIGN.md, each shown in the
 * small piece of the product that keeps it.
 */
export function Principles() {
  const grid = useRef<HTMLDivElement>(null);
  const on = useReveal(grid);
  return (
    <section {...stylex.props(page.narrow, page.section)}>
      <Intro title="Honest, calm and human." />
      <div
        ref={grid}
        {...stylex.props(
          styles.grid,
          reveal.line,
          reveal.delay(150),
          on && reveal.on
        )}
      >
        <Principle
          name="Honest"
          words="Every line is something that happened, with a source and a time. An agent’s work says so, and names the person answerable for it."
        >
          <span {...stylex.props(styles.logLine)}>
            <Avatar person={atlas} size={16} />
            <span {...stylex.props(styles.strong)}>Atlas</span>
            <span {...stylex.props(styles.forWhom)}>for Jean</span>
            <span {...stylex.props(styles.ellipsis, styles.muted)}>
              opened <span {...stylex.props(styles.mono)}>#209</span>
            </span>
          </span>
        </Principle>
        <Principle
          name="Calm"
          words="Only attention is counted, and when nothing needs you it says so. Everything else waits for your brief."
        >
          <span {...stylex.props(styles.nav)}>
            <Ghost size={18} still />
            <span {...stylex.props(styles.grow)}>
              Nothing needs you right now.
            </span>
          </span>
        </Principle>
        <Principle
          name="Human"
          words="People appear as their faces and in their own words. Agents get faces too, square ones, so nobody mistakes them for people."
        >
          <span {...stylex.props(styles.faces)}>
            {[ada, jean, grace, eric].map((person) => (
              <Avatar key={person.id} person={person} size={28} ring />
            ))}
            <span {...stylex.props(styles.gap)} />
            {[atlas, scout].map((agent) => (
              <Avatar key={agent.id} person={agent} size={28} />
            ))}
          </span>
        </Principle>
      </div>
    </section>
  );
}

function Principle({
  name,
  words,
  children,
}: {
  name: string;
  words: string;
  children: ReactNode;
}) {
  return (
    <article {...stylex.props(styles.card)}>
      <h3 {...stylex.props(type.tileTitle)}>{name}</h3>
      <p {...stylex.props(styles.words)}>{words}</p>
      <div aria-hidden {...stylex.props(styles.foot)}>
        {children}
      </div>
    </article>
  );
}

const styles = stylex.create({
  grid: {
    display: "grid",
    // minmax(0, …): a line that won't wrap must not widen its own card past the others.
    gridTemplateColumns: {
      default: "repeat(3, minmax(0, 1fr))",
      "@media (max-width: 860px)": "1fr",
    },
    gap: space.md,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    padding: space.xxl,
    borderRadius: 16,
    backgroundColor:
      "light-dark(oklch(0.2 0.01 80 / 0.03), oklch(1 0 0 / 0.035))",
    boxShadow: "inset 0 0 0 1px light-dark(transparent, oklch(1 0 0 / 0.05))",
  },
  words: {
    margin: 0,
    flexGrow: 1,
    fontSize: 14,
    lineHeight: "22px",
    fontWeight: 400,
    color: "light-dark(oklch(0.22 0.01 80 / 0.8), oklch(0.94 0.004 80 / 0.8))",
    textWrap: "pretty",
  },
  foot: {
    display: "flex",
    marginTop: space.lg,
    fontSize: text.label,
  },
  logLine: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    width: "100%",
    height: 40,
    paddingInline: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.raised,
    boxShadow: shadow.object,
    whiteSpace: "nowrap",
  },
  strong: {
    fontWeight: 600,
  },
  forWhom: {
    paddingInline: space.sm,
    borderRadius: radius.full,
    backgroundColor: color.ui,
    fontSize: text.caption,
    color: color.fgMuted,
  },
  muted: {
    color: color.fgMuted,
  },
  ellipsis: {
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  mono: {
    fontFamily: font.mono,
    fontSize: text.meta,
    color: color.fgMuted,
  },
  nav: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    width: "100%",
    height: 40,
    paddingInline: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.raised,
    boxShadow: shadow.object,
    fontWeight: 500,
  },
  grow: {
    flexGrow: 1,
  },
  count: {
    display: "grid",
    placeItems: "center",
    minWidth: 20,
    height: 20,
    paddingInline: space.xs,
    borderRadius: radius.full,
    backgroundColor: color.accent,
    color: color.fgOnSolid,
    fontSize: text.caption,
    fontWeight: 600,
  },
  faces: {
    display: "flex",
    alignItems: "center",
    gap: space.xs,
    height: 40,
  },
  gap: {
    width: space.md,
  },
});
