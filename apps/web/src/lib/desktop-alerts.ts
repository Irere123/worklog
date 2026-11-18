import { useSyncExternalStore } from "react";

/**
 * - `unsupported`: no notifications here, or only from an installed app with a service worker,
 *   as on Android.
 * - `denied`: the browser blocked them for this site; only its site settings can undo that.
 */
export type AlertState = "unsupported" | "denied" | "off" | "on";

const KEY = "worklog.desktopAlerts";
const ICON = "/icon-192.png";
const listeners = new Set<() => void>();
let constructorFails = false;

function read() {
  if (!("Notification" in window) || constructorFails) {
    return "unsupported";
  }
  if (Notification.permission === "denied") {
    return "denied";
  }
  return Notification.permission === "granted" &&
    localStorage.getItem(KEY) === "on"
    ? "on"
    : "off";
}

export function useDesktopAlerts() {
  const state: AlertState = useSyncExternalStore(
    subscribe,
    read,
    () => "unsupported"
  );
  return state;
}

/** Asks for permission and shows a first notification, so people see what they turned on. */
export async function enableDesktopAlerts() {
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    localStorage.setItem(KEY, "on");
    show({
      title: "Notifications are on",
      body: "Pings and briefs will appear here while Worklog is in the background.",
      tag: "worklog-alerts-on",
    });
  }
  emit();
}

export function disableDesktopAlerts() {
  localStorage.setItem(KEY, "off");
  emit();
}

/**
 * Shows what the server sent while the tab is out of sight; in view, the app itself shows it. Every
 * open tab hears the same event, and a shared `tag` makes the system show it once.
 */
export function showDesktopAlert(alert: {
  title: string;
  body?: string;
  tag: string;
  onOpen?: () => void;
}) {
  if (document.visibilityState === "visible" || read() !== "on") {
    return;
  }
  show(alert);
}

function show(alert: {
  title: string;
  body?: string;
  tag: string;
  onOpen?: () => void;
}) {
  try {
    const note = new Notification(alert.title, {
      body: alert.body,
      tag: alert.tag,
      icon: ICON,
    });
    note.addEventListener("click", () => {
      window.focus();
      alert.onOpen?.();
      note.close();
    });
  } catch {
    constructorFails = true;
    emit();
  }
}

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  let status: PermissionStatus | null = null;
  let closed = false;
  void permissionStatus().then((s) => {
    if (s && !closed) {
      status = s;
      s.addEventListener("change", listener);
    }
    return s;
  });
  return () => {
    closed = true;
    listeners.delete(listener);
    status?.removeEventListener("change", listener);
  };
}

async function permissionStatus() {
  try {
    return await navigator.permissions.query({ name: "notifications" });
  } catch {
    return null;
  }
}
