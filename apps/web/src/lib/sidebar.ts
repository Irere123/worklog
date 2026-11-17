import { useSyncExternalStore } from "react";

const KEY = "worklog.sidebar";
const NARROW = "(max-width: 860px)";
const listeners = new Set<() => void>();
// Storage only seeds the first read: a write it refuses (blocked, or over quota) must still
// take effect for this visit.
let folded: boolean | undefined;

/** Whether the sidebar is folded to a rail of icons; remembered per browser. */
export function useSidebarFolded(): boolean {
  return useSyncExternalStore(subscribe, readFolded, () => false);
}

export function setSidebarFolded(next: boolean) {
  folded = next;
  try {
    if (next) {
      localStorage.setItem(KEY, "folded");
    } else {
      localStorage.removeItem(KEY);
    }
  } catch {
    // Blocked storage only costs remembering it next visit.
  }
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
