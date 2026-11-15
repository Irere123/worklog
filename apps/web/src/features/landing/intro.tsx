import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { page, type } from "./styles";

/** A section's heading and the line under it. */
export function Intro({ title, lede }: { title: ReactNode; lede?: ReactNode }) {
  return (
    <div {...stylex.props(page.intro)}>
      <h2 {...stylex.props(type.heading)}>{title}</h2>
      {lede !== undefined && <p {...stylex.props(type.lede)}>{lede}</p>}
    </div>
  );
}
