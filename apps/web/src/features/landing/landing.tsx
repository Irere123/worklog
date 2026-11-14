import * as stylex from "@stylexjs/stylex";

import { color } from "#ui/tokens.stylex";

import { Agents } from "./agents";
import { Closing, Footer } from "./closing";
import { Faq } from "./faq";
import { Features } from "./features";
import { Hero } from "./hero";
import { Nav } from "./nav";
import { Open } from "./open";
import { Principles } from "./principles";
import { Sources } from "./sources";
import { Tour } from "./tour";

/**
 * Worklog's front page, for someone who hasn't signed in. It shows the product in its own
 * clothes: every demo is the app's window drawn from the app's tokens, with the seed's team.
 */
export function Landing({ setupOpen }: { setupOpen: boolean }) {
  return (
    <div id="top" {...stylex.props(styles.page)}>
      <Nav setupOpen={setupOpen} />
      <main>
        <Hero setupOpen={setupOpen} />
        <Tour />
        <Features />
        <Agents />
        <Sources />
        <Open />
        <Principles />
        <Faq />
        <Closing setupOpen={setupOpen} />
      </main>
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
