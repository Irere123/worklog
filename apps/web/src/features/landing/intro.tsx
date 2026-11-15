import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { page, type } from "./styles";

/** The top of a page of its own (pricing, the FAQ, the changelog): its title and one line. */
export function PageHead({
  title,
  lede,
}: {
  title: ReactNode;
  lede: ReactNode;
}) {
  return (
    <header {...stylex.props(page.wide, styles.head)}>
      <h1 {...stylex.props(type.display)}>{title}</h1>
      <p {...stylex.props(type.lede)}>{lede}</p>
    </header>
  );
}

/** A section's heading and the line under it. */
export function Intro({ title, lede }: { title: ReactNode; lede?: ReactNode }) {
  return (
    <div {...stylex.props(page.intro)}>
      <h2 {...stylex.props(type.heading)}>{title}</h2>
      {lede !== undefined && <p {...stylex.props(type.lede)}>{lede}</p>}
    </div>
  );
}

const styles = stylex.create({
  head: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 20,
    paddingTop: {
      default: 96,
      "@media (max-width: 640px)": 64,
    },
    paddingBottom: 56,
    textAlign: "center",
  },
});
