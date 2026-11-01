import { Outlet, createFileRoute } from "@tanstack/react-router";

import { SettingsFrame } from "#features/settings/frame";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings · Worklog" }] }),
  component: () => (
    <SettingsFrame>
      <Outlet />
    </SettingsFrame>
  ),
});
