import { useSyncExternalStore } from "react";

const TOUCH = "(hover: none) and (pointer: coarse)";

/** True on a phone or tablet, where keyboard hints in copy are noise. */
export function useTouch() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

function subscribe(onChange: () => void) {
  const query = window.matchMedia(TOUCH);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function snapshot() {
  return window.matchMedia(TOUCH).matches;
}
