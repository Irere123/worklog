import { useSyncExternalStore } from "react";

export type Theme = "system" | "light" | "dark";

const KEY = "worklog.theme";
const listeners = new Set<() => void>();

const schemeOf = (theme: Theme) => (theme === "system" ? "light dark" : theme);

// Runs before first paint so a dark-mode reader never sees a white flash.
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");document.documentElement.style.colorScheme=t==="light"||t==="dark"?t:"light dark"}catch(e){}`;

function read(): Theme {
  const stored = localStorage.getItem(KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function setTheme(theme: Theme) {
  localStorage.setItem(KEY, theme);
  document.documentElement.style.colorScheme = schemeOf(theme);
  for (const listener of listeners) {
    listener();
  }
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, read, () => "system");
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
