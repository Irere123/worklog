import { useSyncExternalStore } from "react";

import { store } from "./storage";

const KEY = "worklog.sidebar";
const NARROW = "(max-width: 860px)";
const listeners = new Set<() => void>();
let folded: boolean | undefined;

/** Whether the sidebar is folded to a rail of icons; remembered per browser. */
export function useSidebarFolded(): boolean {
  return useSyncExternalStore(subscribe, readFolded, () => false);
}

export function setSidebarFolded(next: boolean) {
  folded = next;
  store(KEY, next ? "folded" : null);
  for (const listener of listeners) {
    listener();
  }
}

/** Below this width the sidebar is a drawer over the page, never a rail. */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const query = matchMedia(NARROW);
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    () => matchMedia(NARROW).matches,
    () => false
  );
}

function readFolded() {
  if (folded === undefined) {
    try {
      folded = localStorage.getItem(KEY) === "folded";
    } catch {
      folded = false;
    }
  }
  return folded;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
