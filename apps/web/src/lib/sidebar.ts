import { useSyncExternalStore } from "react";

import { store } from "./storage";

const KEY = "worklog.sidebar";
const WIDTH_KEY = "worklog.sidebar-width";
const NARROW = "(max-width: 860px)";
const listeners = new Set<() => void>();
let folded: boolean | undefined;
let width: number | undefined;

/** The sidebar's width in pixels, between these bounds. */
export const SIDEBAR_WIDTH = { min: 200, default: 232, max: 420 };

/** Whether the sidebar is folded to a rail of icons; remembered per browser. */
export function useSidebarFolded() {
  return useSyncExternalStore(subscribe, readFolded, () => false);
}

export function setSidebarFolded(next: boolean) {
  folded = next;
  store(KEY, next ? "folded" : null);
  for (const listener of listeners) {
    listener();
  }
}

/** How wide the open sidebar is; remembered per browser once someone drags or nudges it. */
export function useSidebarWidth() {
  return useSyncExternalStore(
    subscribe,
    readWidth,
    () => SIDEBAR_WIDTH.default
  );
}

/** Changes the width at once; `remember` also saves it, which a drag does only when it ends. */
export function setSidebarWidth(next: number, remember = true) {
  width = clampWidth(next);
  if (remember) {
    store(
      WIDTH_KEY,
      width === SIDEBAR_WIDTH.default ? null : String(Math.round(width))
    );
  }
  for (const listener of listeners) {
    listener();
  }
}

/** Below this width the sidebar is a drawer over the page, never a rail. */
export function useNarrow() {
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

function readWidth() {
  if (width === undefined) {
    let saved = Number.NaN;
    try {
      saved = Number(localStorage.getItem(WIDTH_KEY) ?? Number.NaN);
    } catch {
      saved = Number.NaN;
    }
    width = Number.isFinite(saved) ? clampWidth(saved) : SIDEBAR_WIDTH.default;
  }
  return width;
}

function clampWidth(next: number) {
  return Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, next));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
