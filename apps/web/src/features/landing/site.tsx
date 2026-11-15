import * as stylex from "@stylexjs/stylex";
import { useEffect } from "react";
import type { ReactNode } from "react";

import { color } from "#ui/tokens.stylex";

import { Footer } from "./closing";
import { Nav } from "./nav";
import { useSetupOpen } from "./start";

/**
 * The frame every public page shares: the front page, pricing, the FAQ, the changelog and the
 * legal pages wear the same bar and footer, so moving between them feels like one site.
 */
export function Site({ children }: { children: ReactNode }) {
  const setupOpen = useSetupOpen();
  // The public pages are always light, whatever theme someone picked in the app. The frame says
  // so for everything inside it; the root follows while a page is open, so the canvas past the
  // page's edges and anything portalled to the body match, and goes back to the app's theme after.
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.colorScheme;
    root.style.colorScheme = "light";
    return () => {
      root.style.colorScheme = before;
    };
  }, []);
  return (
    <div id="top" {...stylex.props(styles.page)}>
      <Nav setupOpen={setupOpen} />
      <main>{children}</main>
      <Footer />
    </div>
  );
}

const styles = stylex.create({
  page: {
    colorScheme: "light",
    minHeight: "100dvh",
    backgroundColor: color.surface,
    color: color.fg,
  },
});
