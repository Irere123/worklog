import { MagnifyingGlassIcon, PulseIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { q } from "#api/queries";
import { sourceLabel } from "#features/activity/activity-line";
import { DayRibbon } from "#features/activity/day-ribbon";
import { Feed } from "#features/activity/feed";
import { Input, Select } from "#ui/field";
import { PageHeader } from "#ui/layout";

type ActivitySearch = { actor?: string; source?: string };

const SOURCES = [
  "github",
  "gitlab",
  "gitea",
  "slack",
  "discord",
  "worklog",
  "webhook",
  "api",
];

export const Route = createFileRoute("/_app/activity")({
  head: () => ({ meta: [{ title: "Activity · Worklog" }] }),
  validateSearch: (search: Record<string, unknown>): ActivitySearch => ({
    actor: typeof search.actor === "string" ? search.actor : undefined,
    source: typeof search.source === "string" ? search.source : undefined,
  }),
  component: ActivityPage,
});

function ActivityPage() {
  const { actor, source } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const members = useQuery(q.members());
  const [text, setText] = useState("");
  const [term] = useDebouncedValue(text.trim(), { wait: 250 });
  const set = (patch: ActivitySearch) => {
    void navigate({ search: (prev) => ({ ...prev, ...patch }) });
  };

  return (
    <>
      <PageHeader
        title="Activity"
        icon={<PulseIcon size={16} />}
        subtitle="Everything the team and its agents did, newest first."
        actions={
          <>
            <Input
              aria-label="Search activity"
              placeholder="Search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              leading={<MagnifyingGlassIcon size={13} />}
              sx={styles.search}
            />
            <Select
              aria-label="Person"
              value={actor ?? ""}
              onChange={(e) => set({ actor: e.target.value || undefined })}
              sx={styles.select}
            >
              <option value="">Everyone</option>
              {members.data?.map((m) => (
                <option key={m.id} value={m.handle}>
                  {m.name}
                  {m.kind === "agent" ? " (agent)" : ""}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Source"
              value={source ?? ""}
              onChange={(e) => set({ source: e.target.value || undefined })}
              sx={styles.select}
            >
              <option value="">All sources</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {sourceLabel(s)}
                </option>
              ))}
            </Select>
          </>
        }
      />
      <Feed
        filter={{ actor, source, q: term || undefined }}
        header={
          <DayRibbon
            selected={actor}
            onSelect={(handle) => set({ actor: handle })}
          />
        }
      />
    </>
  );
}

const styles = stylex.create({
  search: { width: { default: 200, "@media (max-width: 640px)": "100%" } },
  select: {
    width: { default: 150, "@media (max-width: 640px)": "calc(50% - 4px)" },
  },
});
