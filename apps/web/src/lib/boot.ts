import { store } from "./storage";

type Boot = Partial<Record<string, Promise<Response>>>;

declare global {
  // oxlint-disable-next-line no-var -- a global set by the inline boot script must be a var.
  var __worklogBoot: Boot | undefined;
}

export const SIGNED_IN = "worklog.signedIn";

/**
 * Runs in the page's head, before any of the app's JavaScript arrives. The guard needs the
 * session and the member before anything renders, so they're asked for while the bundle downloads
 * instead of after it runs. It reads the same storage keys as `authHeaders`. The router renders
 * head scripts again when it mounts, so a second run must do nothing.
 *
 * The front page is prerendered HTML that paints before any of that, so it's here, not in its
 * route, that someone signed in is sent on to /home: at once when this browser remembers a
 * session (or holds an API key), else as soon as the session request says so.
 */
export const BOOT_SCRIPT = `try{var f=location.pathname==="/";if(f&&(localStorage.getItem("worklog.apiKey")||localStorage.getItem("${SIGNED_IN}")))location.replace("/home");if(!window.__worklogBoot&&!/^\\/(login|setup)/.test(location.pathname)){var h={},k=localStorage.getItem("worklog.apiKey"),w=localStorage.getItem("worklog.workspace");if(k)h.authorization="Bearer "+k;if(w)h["x-worklog-workspace"]=w;var g=function(p){return fetch(p,{credentials:"include",headers:h})};window.__worklogBoot={"/v1/session":g("/v1/session"),"/v1/me":g("/v1/me")};if(f)window.__worklogBoot["/v1/session"].then(function(r){if(r.ok)location.replace("/home")},function(){})}}catch(e){}`;

/** Whether this browser has a session, as the front page's head script reads it. */
export function rememberSignedIn(signedIn: boolean) {
  store(SIGNED_IN, signedIn ? "1" : null);
}

/**
 * The boot script's response for `path`, once: later calls go to the network, so a refetch
 * never returns the page's first answer again.
 */
export async function takeBootResponse(path: string) {
  const boot = globalThis.__worklogBoot;
  const response = boot?.[path];
  if (!(boot && response)) {
    return null;
  }
  Reflect.deleteProperty(boot, path);
  return await response.catch(() => null);
}
