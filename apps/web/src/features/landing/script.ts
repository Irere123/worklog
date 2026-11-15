import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { RefObject } from "react";

import { useTheme } from "#lib/theme";

/**
 * The landing page's demos are scripts: a list of beats that set state and wait. A script stops
 * where it is when someone presses Pause, and is dropped mid-beat when its demo unmounts, so
 * nothing keeps writing to a scene nobody sees.
 */
export type Act = {
  wait: (ms: number) => Promise<void>;
};

class CancelledError extends Error {
  override name = "CancelledError";
}

// Short enough that Pause feels immediate, long enough not to wake the page for nothing.
const TICK = 50;

export function useScript(
  run: (act: Act) => Promise<void>,
  { running, paused }: { running: boolean; paused: boolean }
) {
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  const perform = useEffectEvent(run);

  useEffect(() => {
    let cancelled = false;
    const act: Act = {
      async wait(ms) {
        let left = ms;
        while (left > 0) {
          const step = Math.min(left, TICK);
          // oxlint-disable-next-line no-await-in-loop -- the beats are sequential by design
          await sleep(step);
          if (cancelled) {
            throw new CancelledError();
          }
          if (!pausedRef.current) {
            left -= step;
          }
        }
      },
    };
    if (running) {
      void play(act);
    }
    async function play(on: Act) {
      try {
        await perform(on);
      } catch (error) {
        if (!(error instanceof CancelledError)) {
          throw error;
        }
      }
    }
    return () => {
      cancelled = true;
    };
  }, [running]);
}

async function sleep(ms: number) {
  // oxlint-disable-next-line promise/avoid-new -- a timer has no promise form in the browser
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Whether the element is on screen, so demos only play while someone can see them. With `once`
 * it stays true after the first sighting, for moments that play a single time.
 */
export function useInView<T extends Element>(
  ref: RefObject<T | null>,
  { margin = "0px", once = false }: { margin?: string; once?: boolean } = {}
) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = ref.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = entry?.isIntersecting ?? false;
        if (once && !visible) {
          return;
        }
        setInView(visible);
        if (once) {
          observer.disconnect();
        }
      },
      { rootMargin: margin, threshold: 0.25 }
    );
    if (element) {
      observer.observe(element);
    }
    return () => observer.disconnect();
  }, [ref, margin, once]);
  return inView;
}

/**
 * Whether a section's words should play their entrance: once it is a little way on screen, or at
 * once with reduced motion, where an entrance held back would leave the words unseen.
 */
export function useReveal<T extends Element>(ref: RefObject<T | null>) {
  const seen = useInView(ref, { margin: "0px 0px -8% 0px", once: true });
  return useReducedMotion() || seen;
}

const REDUCED = "(prefers-reduced-motion: reduce)";

export function useReducedMotion() {
  return useSyncExternalStore(
    (change) => {
      const query = matchMedia(REDUCED);
      query.addEventListener("change", change);
      return () => query.removeEventListener("change", change);
    },
    () => matchMedia(REDUCED).matches,
    () => false
  );
}

const DARK = "(prefers-color-scheme: dark)";

/**
 * Whether the page is showing dark, from the theme a visitor picked or, on "system", their
 * device. For pictures, which can't follow a light-dark() colour on their own.
 */
export function useDark() {
  const theme = useTheme();
  const system = useSyncExternalStore(
    (change) => {
      const query = matchMedia(DARK);
      query.addEventListener("change", change);
      return () => query.removeEventListener("change", change);
    },
    () => matchMedia(DARK).matches,
    () => false
  );
  return theme === "system" ? system : theme === "dark";
}

export type Point = { x: number; y: number };

/**
 * Where the cursor should land on `[data-target=name]` inside `root`, as fractions of its box.
 * Aimed off the label's centre, so the pointer never covers the words it clicks.
 */
export function pointAt(
  root: HTMLElement | null,
  name: string,
  fx = 0.82,
  fy = 0.62
): Point | null {
  const target = root?.querySelector<HTMLElement>(`[data-target="${name}"]`);
  // A target can be hidden on a narrow screen; the scene then plays without a pointer.
  if (!(root && target && target.offsetParent)) {
    return null;
  }
  const outer = root.getBoundingClientRect();
  const box = target.getBoundingClientRect();
  // The desktop tour draws the window at its design size and scales it to fit; the cursor lives
  // inside that scale, so a measured distance is turned back into the window's own pixels.
  const scale = root.offsetWidth > 0 ? outer.width / root.offsetWidth : 1;
  return {
    x: (box.left - outer.left + box.width * fx) / scale,
    y: (box.top - outer.top + box.height * fy) / scale,
  };
}
