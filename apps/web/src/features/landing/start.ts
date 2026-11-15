import { useQuery } from "@tanstack/react-query";

import { q } from "#api/queries";

/** Whether this server has no workspace yet, so its way in is setting one up. */
export function useSetupOpen() {
  const config = useQuery(q.authConfig());
  return config.data?.setupOpen === true;
}

/** Where "Get started" leads: setting up a fresh server, or signing in to start a workspace. */
export function useStart() {
  return useSetupOpen() ? "/setup" : "/login";
}
