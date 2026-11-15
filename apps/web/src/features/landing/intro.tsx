import * as stylex from "@stylexjs/stylex";
import { useRef } from "react";
import type { ReactNode } from "react";

import { useReveal } from "./script";
import { page, reveal, type } from "./styles";

/** A section's heading and the line under it, arriving one after the other as it scrolls in. */
export function Intro({ title, lede }: { title: ReactNode; lede?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const on = useReveal(ref);
  return (
    <div ref={ref} {...stylex.props(page.intro)}>
      <h2
        {...stylex.props(
          type.heading,
          reveal.line,
          reveal.delay(50),
          on && reveal.on
        )}
      >
        {title}
      </h2>
      {lede !== undefined && (
        <p
          {...stylex.props(
            type.lede,
            reveal.line,
            reveal.delay(100),
            on && reveal.on
          )}
        >
          {lede}
        </p>
      )}
    </div>
  );
}
