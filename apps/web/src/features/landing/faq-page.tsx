import * as stylex from "@stylexjs/stylex";

import { color, media, motion, radius, space } from "#ui/tokens.stylex";

import { Questions } from "./faq";
import { SOURCE } from "./links";
import { GROUPS } from "./questions";
import { Site } from "./site";
import { page, type } from "./styles";

/** Every question in one place, grouped by what people worry about, as resurf's FAQ is. */
export function FaqPage() {
  return (
    <Site>
      <header {...stylex.props(page.narrow, styles.head)}>
        <h1 {...stylex.props(type.display)}>Questions, answered</h1>
        <p {...stylex.props(type.lede)}>
          Plain answers about starting, self-hosting, AI and agents, privacy and
          pricing.
        </p>
      </header>
      <div {...stylex.props(page.narrow, styles.groups)}>
        {GROUPS.map((group) => (
          <section key={group.title} {...stylex.props(styles.group)}>
            <h2 {...stylex.props(styles.groupTitle)}>{group.title}</h2>
            <Questions items={group.questions} />
          </section>
        ))}
        <p {...stylex.props(styles.help)}>
          Didn’t find it?{" "}
          <a href={`${SOURCE}/issues`} {...stylex.props(styles.helpLink)}>
            Ask on GitHub
          </a>
          .
        </p>
      </div>
    </Site>
  );
}

const styles = stylex.create({
  head: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.xxl,
    paddingTop: {
      default: 96,
      "@media (max-width: 640px)": 64,
    },
    paddingBottom: 56,
    textAlign: "center",
  },
  groups: {
    display: "flex",
    flexDirection: "column",
    gap: 56,
    maxWidth: 704,
  },
  group: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
  },
  groupTitle: {
    margin: 0,
    fontSize: 13,
    lineHeight: "20px",
    fontWeight: 500,
    color: color.fgMuted,
  },
  help: {
    margin: 0,
    fontSize: 13,
    color: color.fgMuted,
    textAlign: "center",
  },
  helpLink: {
    color: {
      default: color.fg,
      ":hover": { default: null, [media.hover]: color.accentFg },
    },
    textDecorationLine: "underline",
    textDecorationColor: color.lineStrong,
    textUnderlineOffset: 3,
    transitionProperty: "color",
    transitionDuration: motion.fast,
    borderRadius: radius.xs,
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
    outlineOffset: 2,
  },
});
