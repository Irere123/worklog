import * as stylex from "@stylexjs/stylex";

import { color, space } from "#ui/tokens.stylex";

import { Questions } from "./faq";
import { PageHead } from "./intro";
import { SOURCE } from "./links";
import { GROUPS } from "./questions";
import { Site } from "./site";
import { links, page } from "./styles";

/** Every question in one place, grouped by what people worry about, as resurf's FAQ is. */
export function FaqPage() {
  return (
    <Site>
      <PageHead
        title="Questions, answered"
        lede={
          <>
            Plain answers about starting, self-hosting, AI and agents, privacy
            and pricing.
          </>
        }
      />
      <div {...stylex.props(page.narrow, styles.groups)}>
        {GROUPS.map((group) => (
          <section key={group.title} {...stylex.props(styles.group)}>
            <h2 {...stylex.props(styles.groupTitle)}>{group.title}</h2>
            <Questions items={group.questions} />
          </section>
        ))}
        <p {...stylex.props(styles.help)}>
          Didn’t find it?{" "}
          <a href={`${SOURCE}/issues`} {...stylex.props(links.inline)}>
            Ask on GitHub
          </a>
          .
        </p>
      </div>
    </Site>
  );
}

const styles = stylex.create({
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
});
