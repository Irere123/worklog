import { Agents } from "./agents";
import { Closing } from "./closing";
import { Faq } from "./faq";
import { Features } from "./features";
import { Hero } from "./hero";
import { Open } from "./open";
import { Site } from "./site";
import { Sources } from "./sources";
import { Tour } from "./tour";

/**
 * Worklog's front page, for someone who hasn't signed in. It shows the product in its own
 * clothes: every demo is the app's window drawn from the app's tokens, with the seed's team.
 */
export function Landing() {
  return (
    <Site>
      <Hero />
      <Tour />
      <Features />
      <Agents />
      <Sources />
      <Open />
      <Faq />
      <Closing />
    </Site>
  );
}
