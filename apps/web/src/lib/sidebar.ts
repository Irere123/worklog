import { useSyncExternalStore } from "react";

const KEY = "worklog.sidebar";
const NARROW = "(max-width: 860px)";
const listeners = new Set<() => void>();
// Stands in for storage a private window or a policy blocks.
let memory = false;

/** Whether the sidebar is folded to a rail of icons; remembered per browser. */
export function useSidebarFolded(): boolean {
  return useSyncExternalStore(subscribe, readFolded, () => false);
}

export function setSidebarFolded(folded: boolean) {
  try {
    if (folded) {
      localStorage.setItem(KEY, "folded");
    } else {
      localStorage.removeItem(KEY);
    }
  } catch {
    // Blocked storage only costs remembering it; the toggle still works for this visit.
    memory = folded;
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
  try {
    return localStorage.getItem(KEY) === "folded";
  } catch {
    return memory;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
