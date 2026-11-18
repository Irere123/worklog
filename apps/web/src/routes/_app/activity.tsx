import {
  MagnifyingGlassIcon,
  StackIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { preloadActivity } from "#api/preload";
import { q } from "#api/queries";
import { SourceGlyph, sourceLabel } from "#features/activity/activity-line";
import { DayRibbon, useRibbon } from "#features/activity/day-ribbon";
import { Feed } from "#features/activity/feed";
import { Avatar } from "#ui/avatar";
import { Input, Select } from "#ui/field";
import { PageHeader } from "#ui/layout";
import { Logo } from "#ui/logo";

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
  validateSearch: (search: Record<string, unknown>) => {
    const result: ActivitySearch = {
      actor: typeof search.actor === "string" ? search.actor : undefined,
      source: typeof search.source === "string" ? search.source : undefined,
    };
    return result;
  },
  loaderDeps: ({ search }) => ({ actor: search.actor, source: search.source }),
  loader: ({ context, deps }) => preloadActivity(context.queryClient, deps),
  component: ActivityPage,
});

function ActivityPage() {
  const actor = Route.useSearch({ select: (s) => s.actor });
  const source = Route.useSearch({ select: (s) => s.source });
  const navigate = useNavigate({ from: Route.fullPath });
  const members = useQuery(q.members());
  const ribbon = useRibbon();
  const [text, setText] = useState("");
  const [term] = useDebouncedValue(text.trim(), { wait: 250 });
  const set = (patch: ActivitySearch) => {
    void navigate({ search: (prev) => ({ ...prev, ...patch }) });
  };

  return (
    <>
      <PageHeader
        title="Activity"
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
              label="Person"
              value={actor ?? ""}
              onValueChange={(next) => set({ actor: next || undefined })}
              options={[
                {
                  value: "",
                  label: "Everyone",
                  icon: <UsersThreeIcon size={14} />,
                },
                ...(members.data ?? []).map((m) => ({
                  value: m.handle,
                  label: m.kind === "agent" ? `${m.name} · agent` : m.name,
                  icon: <Avatar person={m} size={16} />,
                })),
              ]}
              sx={styles.select}
            />
            <Select
              label="Source"
              value={source ?? ""}
              onValueChange={(next) => set({ source: next || undefined })}
              options={[
                {
                  value: "",
                  label: "All sources",
                  icon: <StackIcon size={14} />,
                },
                ...SOURCES.map((s) => ({
                  value: s,
                  label: sourceLabel(s),
                  icon:
                    s === "worklog" ? (
                      <Logo size={14} />
                    ) : (
                      <SourceGlyph source={s} size={14} />
                    ),
                })),
              ]}
              sx={styles.select}
            />
          </>
        }
      />
      <Feed
        filter={{ actor, source, q: term || undefined }}
        headerPending={ribbon.recent.isPending}
        header={
          <DayRibbon
            ribbon={ribbon}
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
