import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";

import type { Schemas } from "#api/client";
import { auth } from "#api/client";
import { q } from "#api/queries";

export type Me = Schemas["Member"];

/** The signed-in member and their workspace, after the layout's guard has loaded them. */
export function useMe() {
  const { data } = useQuery(q.me());
  return data;
}

export async function signOut(client: QueryClient) {
  auth.setKey(null);
  // Signing out locally must still work when the server can't be reached.
  await fetch("/api/auth/sign-out", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: "{}",
  }).catch(() => null);
  client.clear();
}

export async function requestMagicLink(email: string, next: string) {
  const res = await fetch("/api/auth/sign-in/magic-link", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      callbackURL: new URL(next, location.origin).toString(),
    }),
  });
  if (!res.ok) {
    throw new Error(
      "We couldn’t send the link. Check the address, then try again."
    );
  }
}

export async function socialSignIn(provider: string, next: string) {
  const res = await fetch("/api/auth/sign-in/social", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider,
      callbackURL: new URL(next, location.origin).toString(),
    }),
  });
  const url = redirectUrl(await res.json().catch(() => null));
  if (!url) {
    throw new Error(`Couldn’t start ${provider} sign-in.`);
  }
  location.assign(url);
}

function redirectUrl(body: unknown) {
  return typeof body === "object" &&
    body !== null &&
    "url" in body &&
    typeof body.url === "string"
    ? body.url
    : undefined;
}
