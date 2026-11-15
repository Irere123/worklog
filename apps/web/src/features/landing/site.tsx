import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { color } from "#ui/tokens.stylex";

import { Footer } from "./closing";
import { Nav } from "./nav";
import { useSetupOpen } from "./start";

/**
 * The frame every public page shares: the front page, pricing, the FAQ and the changelog wear
 * the same bar and footer, so moving between them feels like one site.
 */
export function Site({ children }: { children: ReactNode }) {
  const setupOpen = useSetupOpen();
  return (
    <div id="top" {...stylex.props(styles.page)}>
      <Nav setupOpen={setupOpen} />
      <main>{children}</main>
      <Footer setupOpen={setupOpen} />
    </div>
  );
}

const styles = stylex.create({
  page: {
    minHeight: "100dvh",
    backgroundColor: color.surface,
    color: color.fg,
  },
});
